/**
 * Ajoute des tracks "facile" au catalogue officiel YouTube depuis
 * backend/data/tutti-faciles-tous-styles.csv (genre,artist,title,level).
 *
 * Pipeline (autonome, réversible) :
 *   1. dédup GLOBAL : artist+title normalisés déjà présents dans
 *      official_playlist_tracks → skip (pas de doublon catalogue).
 *   2. map genre → playlist de genre (slug réel). Pas de slug → review.
 *   3. résout youtube_id (méthode éprouvée officialLibraryImport.searchYouTubeVideo :
 *      search.list, scoring VEVO/official/topic, reject >0.7).
 *   4. valide via videos.list batch (classifyYoutubeIds : existe + embeddable +
 *      pas bloqué FR/LU).
 *   5. append : difficulty=EASY, youtube_id, is_playable, position = max+1.
 *   6. rollback : logge chaque track id créé → suppression exacte.
 *
 * Jetable (campagne). Quota YouTube : search.list = 100 u/appel. Dédup+map AVANT
 * search → on ne dépense que sur les nouvelles lignes. 403 → stop search propre,
 * reste flaggé 'quota', resumable (les ajoutés sont dédupliqués au re-run).
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
loadEnv({ path: '/Users/thomaspinon/Documents/Claude Code/tutti/credentials.env.local' });
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { classifyYoutubeIds } from '../src/lib/youtubeValidation.js';

const ROOT = '/Users/thomaspinon/Documents/Claude Code/tutti';
const CSV = `${ROOT}/backend/data/tutti-faciles-tous-styles.csv`;
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const ROLLBACK = `${ROOT}/easy-tracks-rollback-${STAMP}.json`;
const THROTTLE_MS = 120;

// genre CSV → slug playlist de genre réel (null = aucune playlist → review).
const GENRE_SLUG: Record<string, string | null> = {
  rock: null, // pas de playlist Rock international (seul Rock Français) → review
  'soul-rnb': 'official-pl-soul-rnb',
  reggae: 'official-pl-reggae',
  'rap-us': 'official-pl-rap-us',
  'rap-fr': 'official-pl-rap-fr',
  metal: 'official-pl-metal',
  latino: 'official-pl-latino',
  films: 'official-pl-films-easy',
  'electro-edm': 'official-pl-electro-edm',
  'disco-funk': 'official-pl-disco-funk',
  country: 'official-pl-country',
  noel: 'official-pl-noel',
  'french-touch': 'official-pl-french-touch',
  disney: 'official-pl-disney-en', // titres CSV = versions anglaises
  afrobeats: 'official-pl-afrobeats',
};

const FORBIDDEN_TERMS = [
  'remix',
  'live',
  'karaoke',
  'karaoké',
  'cover',
  'instrumental',
  'tribute',
  're-recorded',
  're-record',
  'rerecorded',
  'mashup',
  'parody',
  'parodie',
  'sped up',
  'slowed',
  'reverb',
  'piano version',
  '8-bit',
  'lullaby',
];

function lower(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function containsForbidden(s: string): boolean {
  const l = lower(s);
  return FORBIDDEN_TERMS.some((t) => l.includes(t));
}
function levenshtein(a: string, b: string): number {
  const A = lower(a),
    B = lower(b);
  if (A === B) return 0;
  const m = A.length,
    n = B.length;
  if (!m) return n ? 1 : 0;
  if (!n) return 1;
  const dp = new Array(n + 1).fill(0).map((_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (A[i - 1] === B[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n]! / Math.max(m, n);
}
// Clé de dédup : artist+title agressivement normalisés (accents, ponctuation,
// feat/parenthèses retirés) → exact match = "fuzzy" robuste sans faux-skip.
function dedupKey(artist: string, title: string): string {
  const norm = (s: string) =>
    lower(s)
      .replace(/\(.*?\)|\[.*?\]/g, ' ')
      .replace(/feat\.?|ft\.?/g, ' ')
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  return `${norm(artist)}|${norm(title)}`;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '',
    inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

interface YTItem {
  id: { videoId?: string };
  snippet: { title: string; channelTitle: string };
}

// Méthode éprouvée (officialLibraryImport.searchYouTubeVideo) : renvoie
// { videoId, videoTitle } ou null. Throw 'QUOTA' sur 403 pour stop propre.
async function searchYouTube(
  apiKey: string,
  artist: string,
  title: string,
): Promise<{ videoId: string; videoTitle: string } | null> {
  const q = `${artist} - ${title}`;
  const params = new URLSearchParams({
    part: 'snippet',
    q,
    type: 'video',
    maxResults: '15',
    videoEmbeddable: 'true',
    safeSearch: 'none',
    key: apiKey,
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
  if (res.status === 403) throw new Error('QUOTA');
  if (!res.ok) return null;
  const data = (await res.json()) as { items: YTItem[] };
  let cands = (data.items ?? []).filter((it) => Boolean(it.id.videoId));
  cands = cands.filter(
    (it) => !containsForbidden(it.snippet.title) && !containsForbidden(it.snippet.channelTitle),
  );
  const artistLower = lower(artist);
  const scored = cands.map((it) => {
    const channel = lower(it.snippet.channelTitle);
    let score = levenshtein(it.snippet.title, `${artist} - ${title}`);
    if (channel.includes('vevo')) score -= 0.4;
    if (channel.includes('official')) score -= 0.25;
    if (channel.includes(artistLower)) score -= 0.2;
    if (channel.endsWith('- topic')) score -= 0.35;
    return { it, score };
  });
  scored.sort((a, b) => a.score - b.score);
  const best = scored[0];
  if (!best || !best.it.id.videoId || best.score > 0.7) return null;
  return { videoId: best.it.id.videoId, videoTitle: best.it.snippet.title };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.error('🛑 YOUTUBE_API_KEY absent du .env local → STOP.');
    process.exit(1);
  }
  const prisma = new PrismaClient();

  // 1. CSV
  const rows = readFileSync(CSV, 'utf8')
    .split('\n')
    .slice(1)
    .filter((l) => l.trim())
    .map(parseCsvLine)
    .map((c) => ({
      genre: (c[0] ?? '').trim(),
      artist: (c[1] ?? '').trim(),
      title: (c[2] ?? '').trim(),
    }))
    .filter((r) => r.genre && r.artist && r.title);

  // 2. playlists de genre (résoudre slugs → id, max position)
  const slugs = [...new Set(Object.values(GENRE_SLUG).filter(Boolean))] as string[];
  const pls = await prisma.officialPlaylist.findMany({
    where: { slug: { in: slugs } },
    select: { id: true, slug: true },
  });
  const plBySlug = new Map(pls.map((p) => [p.slug, p.id]));
  const missing = slugs.filter((s) => !plBySlug.has(s));
  if (missing.length) {
    console.error('🛑 slugs introuvables en DB:', missing.join(', '));
    process.exit(1);
  }
  const maxPos = new Map<string, number>();
  for (const id of plBySlug.values()) {
    const agg = await prisma.officialPlaylistTrack.aggregate({
      where: { playlist_id: id },
      _max: { position: true },
    });
    maxPos.set(id, agg._max.position ?? 0);
  }

  // 3. dédup set GLOBAL (tout le catalogue officiel)
  const all = await prisma.officialPlaylistTrack.findMany({
    select: { artist: true, title: true },
  });
  const seen = new Set(all.map((t) => dedupKey(t.artist, t.title)));

  // 4. classer chaque ligne
  const counters = { ajoutes: 0, skipDoublon: 0, ytEchec: 0, pasDePlaylist: 0, quota: 0 };
  const pasDePlaylistByGenre: Record<string, number> = {};
  const toResolve: Array<{ genre: string; artist: string; title: string; slug: string }> = [];
  for (const r of rows) {
    if (!(r.genre in GENRE_SLUG) || GENRE_SLUG[r.genre] === null) {
      counters.pasDePlaylist++;
      pasDePlaylistByGenre[r.genre] = (pasDePlaylistByGenre[r.genre] ?? 0) + 1;
      continue;
    }
    if (seen.has(dedupKey(r.artist, r.title))) {
      counters.skipDoublon++;
      continue;
    }
    toResolve.push({ ...r, slug: GENRE_SLUG[r.genre]! });
  }

  // 5. résolution YouTube (search) — stop propre sur quota
  const resolved: Array<{
    genre: string;
    artist: string;
    title: string;
    slug: string;
    videoId: string;
    videoTitle: string;
  }> = [];
  let quotaHit = false;
  for (const r of toResolve) {
    if (quotaHit) {
      counters.quota++;
      continue;
    }
    try {
      const hit = await searchYouTube(apiKey, r.artist, r.title);
      if (!hit) {
        counters.ytEchec++;
        continue;
      }
      resolved.push({ ...r, ...hit });
    } catch (e) {
      if (e instanceof Error && e.message === 'QUOTA') {
        quotaHit = true;
        counters.quota++;
        console.warn('[yt] QUOTA 403 → stop search, reste flaggé quota');
      } else counters.ytEchec++;
    }
    await sleep(THROTTLE_MS);
  }

  // 6. validation batch videos.list (existe + embeddable + pas bloqué FR/LU)
  const verdicts = await classifyYoutubeIds(
    apiKey,
    resolved.map((r) => r.videoId),
  );
  const playable = resolved.filter((r) => {
    const v = verdicts.get(r.videoId);
    if (v?.is_playable) return true;
    counters.ytEchec++;
    return false;
  });

  // 7. append + log rollback (create() par track pour capturer les ids).
  // Rollback écrit dans un FINALLY → réversibilité garantie même si un create
  // throw en plein milieu (pas de write prod orphelin sans undo).
  const created: Array<{
    id: string;
    slug: string;
    artist: string;
    title: string;
    youtube_id: string;
    videoTitle: string;
  }> = [];
  const writeRollback = (): void => {
    const touched = [...new Set(created.map((c) => plBySlug.get(c.slug)!))];
    writeFileSync(
      ROLLBACK,
      JSON.stringify(
        {
          created_at: new Date().toISOString(),
          count: created.length,
          track_ids: created.map((c) => c.id),
          touched_playlist_ids: touched,
          items: created,
        },
        null,
        2,
      ),
    );
  };
  try {
    for (const r of playable) {
      const plId = plBySlug.get(r.slug)!;
      const pos = (maxPos.get(plId) ?? 0) + 1;
      maxPos.set(plId, pos);
      const t = await prisma.officialPlaylistTrack.create({
        data: {
          playlist_id: plId,
          position: pos,
          title: r.title,
          artist: r.artist,
          difficulty: 'EASY',
          youtube_id: r.videoId,
          is_playable: true,
          playability_reason: null,
          playability_checked_at: new Date(),
          last_refreshed_at: new Date(),
        },
        select: { id: true },
      });
      created.push({
        id: t.id,
        slug: r.slug,
        artist: r.artist,
        title: r.title,
        youtube_id: r.videoId,
        videoTitle: r.videoTitle,
      });
      seen.add(dedupKey(r.artist, r.title));
      counters.ajoutes++;
    }
  } finally {
    writeRollback(); // toujours, même sur crash partiel
  }

  // 8. track_count cohérent sur les playlists touchées
  const touched = [...new Set(created.map((c) => plBySlug.get(c.slug)!))];
  for (const plId of touched) {
    const n = await prisma.officialPlaylistTrack.count({ where: { playlist_id: plId } });
    await prisma.officialPlaylist.update({ where: { id: plId }, data: { track_count: n } });
  }

  // ───── SORTIE ─────
  console.log('\n=== COMPTEURS ===');
  console.log(`ajoutés          : ${counters.ajoutes}`);
  console.log(`skip-doublon     : ${counters.skipDoublon}`);
  console.log(`youtube-échec    : ${counters.ytEchec}`);
  console.log(
    `pas-de-playlist  : ${counters.pasDePlaylist}  ${JSON.stringify(pasDePlaylistByGenre)}`,
  );
  console.log(`quota-bloqué     : ${counters.quota}`);
  console.log('\n=== ÉCHANTILLON 20 AJOUTÉS (artist — title → vidéo YouTube résolue) ===');
  for (const c of created.slice(0, 20)) {
    console.log(
      `  [${c.slug.replace('official-pl-', '')}] ${c.artist} — ${c.title}\n      → ${c.videoTitle}  (https://youtu.be/${c.youtube_id})`,
    );
  }
  console.log(`\n📄 ROLLBACK : ${ROLLBACK}`);
  console.log(`   undo = pnpm exec tsx scripts/addEasyTracksRollback.ts "${ROLLBACK}"`);
  await prisma.$disconnect();
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
