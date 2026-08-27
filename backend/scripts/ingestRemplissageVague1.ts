/**
 * Ingest REMPLISSAGE vague 1 — étoffe 5 playlists EXISTANTES (maigres) depuis
 * backend/data/tutti-remplissage-vague1.csv. Colonnes : slug,playlist,artist,title,level.
 *
 * Cibles (par SLUG, préfixé `official-pl-`) :
 *   italo-disco-classics · yeye-60s-fr · rock-fr · hiphop-fr-2020s · italie-classique
 *
 * GARDE-FOU : ne crée JAMAIS de playlist. Si un slug cible n'existe pas → ABORT.
 *
 * Sémantique (identique vague1/lib) :
 *   - track déjà dans la playlist cible (artist+title fuzzy) → SKIP (idempotent).
 *   - track au catalogue ailleurs → RÉUTILISE youtube_id (+ spotify/song/cover/aliases).
 *   - track absente → résout youtube_id (search → classify videos.list, drop invalides).
 *   - difficulty per-track = colonne level (EASY/MEDIUM/HARD→EXPERT).
 *
 * Réversible : rollback JSON compatible funPlaylistsRollback.ts. Jetable.
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
loadEnv({ path: '/Users/thomaspinon/Documents/Claude Code/tutti/credentials.env.local' });
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient, type Level } from '@prisma/client';
import { classifyYoutubeIds } from '../src/lib/youtubeValidation.js';

const ROOT = '/Users/thomaspinon/Documents/Claude Code/tutti';
const CSV = `${ROOT}/backend/data/tutti-remplissage-vague1.csv`;
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const ROLLBACK = `${ROOT}/remplissage-vague1-rollback-${STAMP}.json`;
const THROTTLE_MS = 120;

// Cibles autorisées (slug DB préfixé). Aucune autre playlist ne sera touchée.
const TARGET_SLUGS = [
  'official-pl-italo-disco-classics',
  'official-pl-yeye-60s-fr',
  'official-pl-rock-fr',
  'official-pl-hiphop-fr-2020s',
  'official-pl-italie-classique',
];

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
  const A = lower(a);
  const B = lower(b);
  if (A === B) return 0;
  const m = A.length;
  const n = B.length;
  if (!m) return n ? 1 : 0;
  if (!n) return 1;
  const dp = new Array<number>(n + 1).fill(0).map((_, j) => j);
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
function dedupKey(artist: string, title: string): string {
  const norm = (s: string): string =>
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
  let cur = '';
  let inQ = false;
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
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function levelFromCsv(raw: string): Level {
  const v = raw.trim().toUpperCase();
  if (v === 'EASY') return 'EASY';
  if (v === 'HARD' || v === 'EXPERT') return 'EXPERT';
  return 'MEDIUM';
}

interface YTItem {
  id: { videoId?: string };
  snippet: { title: string; channelTitle: string };
}
async function searchYouTube(
  apiKey: string,
  artist: string,
  title: string,
): Promise<{ videoId: string; videoTitle: string } | null> {
  const params = new URLSearchParams({
    part: 'snippet',
    q: `${artist} - ${title}`,
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

type ExTrack = {
  youtube_id: string | null;
  spotify_id: string | null;
  song_id: string | null;
  cover_url: string | null;
  year: number | null;
  is_playable: boolean;
  artist_aliases: string[];
  title_aliases: string[];
};
type Row = { slug: string; artist: string; title: string; level: Level };

async function main(): Promise<void> {
  const apiKey = process.env.YOUTUBE_API_KEY ?? '';
  if (!apiKey) {
    console.warn(
      '⚠️  YOUTUBE_API_KEY absent — partial run : seuls les tracks déjà au catalogue seront ajoutés. Nouveaux SKIPPÉS (comptés youtube-échec).',
    );
  }
  const prisma = new PrismaClient();

  // ── GARDE-FOU : toutes les playlists cibles doivent EXISTER (zéro create) ──
  const targets = await prisma.officialPlaylist.findMany({
    where: { slug: { in: TARGET_SLUGS } },
    select: { id: true, slug: true, name_fr: true },
  });
  const idBySlug = new Map(targets.map((t) => [t.slug, t.id]));
  const missing = TARGET_SLUGS.filter((s) => !idBySlug.has(s));
  if (missing.length > 0) {
    console.error(`🛑 ABORT — slugs cibles introuvables (aucune création) : ${missing.join(', ')}`);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log('Cibles (existantes, réutilisées) :');
  for (const t of targets) console.log(`  ↺ ${t.slug} — "${t.name_fr}"`);

  // ── Parse CSV 5 colonnes : slug,playlist,artist,title,level ──
  const rawRows = readFileSync(CSV, 'utf8')
    .split('\n')
    .slice(1)
    .filter((l) => l.trim())
    .map(parseCsvLine);
  const rows: Row[] = rawRows
    .map((c) => ({
      slug: `official-pl-${(c[0] ?? '').trim()}`,
      artist: (c[2] ?? '').trim(),
      title: (c[3] ?? '').trim(),
      level: levelFromCsv(c[4] ?? ''),
    }))
    .filter((r) => r.artist && r.title && idBySlug.has(r.slug));

  // ── Index catalogue existant (dédup global) : artist+title → meilleur track ──
  const allTracks = await prisma.officialPlaylistTrack.findMany({
    select: {
      artist: true,
      title: true,
      youtube_id: true,
      spotify_id: true,
      song_id: true,
      cover_url: true,
      year: true,
      is_playable: true,
      artist_aliases: true,
      title_aliases: true,
    },
  });
  const existing = new Map<string, ExTrack>();
  for (const t of allTracks) {
    const k = dedupKey(t.artist, t.title);
    const prev = existing.get(k);
    if (!prev || (!prev.youtube_id && t.youtube_id)) existing.set(k, t);
  }

  // ── Idempotence : tracks déjà présentes par playlist cible ──
  const maxPos = new Map<string, number>();
  const presentBySlug = new Map<string, Set<string>>();
  for (const slug of TARGET_SLUGS) {
    const id = idBySlug.get(slug)!;
    const a = await prisma.officialPlaylistTrack.aggregate({
      where: { playlist_id: id },
      _max: { position: true },
    });
    maxPos.set(id, a._max.position ?? 0);
    const inPl = await prisma.officialPlaylistTrack.findMany({
      where: { playlist_id: id },
      select: { artist: true, title: true },
    });
    const set = new Set<string>();
    for (const t of inPl) set.add(dedupKey(t.artist, t.title));
    presentBySlug.set(slug, set);
  }

  // ── Classer : skip / reuse / search ──
  const reuse: Array<Row & { src: ExTrack }> = [];
  const toSearch: Row[] = [];
  let alreadyInPlaylist = 0;
  for (const r of rows) {
    const k = dedupKey(r.artist, r.title);
    if (presentBySlug.get(r.slug)?.has(k)) {
      alreadyInPlaylist++;
      continue;
    }
    const ex = existing.get(k);
    if (ex && ex.youtube_id) reuse.push({ ...r, src: ex });
    else toSearch.push(r);
  }

  const counters: Record<string, { nouveaux: number; reutilises: number; ytEchec: number }> = {};
  for (const slug of TARGET_SLUGS) counters[slug] = { nouveaux: 0, reutilises: 0, ytEchec: 0 };

  console.log(
    `\n=== DRY-RUN PRE-WRITE [remplissage-vague1] ===\n  CSV lignes valides : ${rows.length}\n  déjà en playlist (skip) : ${alreadyInPlaylist}\n  réutilisés catalogue : ${reuse.length}\n  à résoudre (search YT) : ${toSearch.length}\n`,
  );

  // ── Résolution YouTube des nouveaux ──
  const resolved: Array<Row & { videoId: string; videoTitle: string }> = [];
  if (apiKey && toSearch.length > 0) {
    for (const [i, r] of toSearch.entries()) {
      if (i % 25 === 0) console.log(`  search ${i}/${toSearch.length}…`);
      try {
        const hit = await searchYouTube(apiKey, r.artist, r.title);
        if (!hit) {
          counters[r.slug]!.ytEchec++;
          continue;
        }
        resolved.push({ ...r, ...hit });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'QUOTA') {
          console.warn(`  🚫 quota YouTube atteint après ${i}/${toSearch.length} — stop search`);
          for (const rem of toSearch.slice(i)) counters[rem.slug]!.ytEchec++;
          break;
        }
        counters[r.slug]!.ytEchec++;
      }
      await sleep(THROTTLE_MS);
    }
  } else if (!apiKey && toSearch.length > 0) {
    for (const r of toSearch) counters[r.slug]!.ytEchec++;
  }

  const verdicts = apiKey
    ? await classifyYoutubeIds(
        apiKey,
        resolved.map((r) => r.videoId),
      )
    : new Map<string, { is_playable: boolean }>();
  const newPlayable = resolved.filter((r) => {
    if (verdicts.get(r.videoId)?.is_playable) return true;
    counters[r.slug]!.ytEchec++;
    return false;
  });

  // ── Write (rollback dans finally) ──
  const created: Array<{
    id: string;
    slug: string;
    artist: string;
    title: string;
    youtube_id: string;
    level: Level;
    videoTitle: string | null;
    reused: boolean;
  }> = [];
  const writeRollback = (): void => {
    writeFileSync(
      ROLLBACK,
      JSON.stringify(
        {
          created_at: new Date().toISOString(),
          campaign: 'remplissage-vague1',
          created_playlist_ids: [], // aucune playlist créée
          track_ids: created.map((c) => c.id),
          count: created.length,
          items: created,
        },
        null,
        2,
      ),
    );
  };
  try {
    const addTrack = async (
      r: Row,
      yt: string,
      src: ExTrack | null,
      videoTitle: string | null,
    ): Promise<void> => {
      const plId = idBySlug.get(r.slug)!;
      const pos = (maxPos.get(plId) ?? 0) + 1;
      maxPos.set(plId, pos);
      const t = await prisma.officialPlaylistTrack.create({
        data: {
          playlist_id: plId,
          position: pos,
          title: r.title,
          artist: r.artist,
          difficulty: r.level,
          youtube_id: yt,
          spotify_id: src?.spotify_id ?? null,
          song_id: src?.song_id ?? null,
          cover_url: src?.cover_url ?? null,
          year: src?.year ?? null,
          artist_aliases: src?.artist_aliases ?? [],
          title_aliases: src?.title_aliases ?? [],
          is_playable: src ? src.is_playable : true,
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
        youtube_id: yt,
        level: r.level,
        videoTitle,
        reused: !!src,
      });
    };
    for (const r of reuse) {
      await addTrack(r, r.src.youtube_id!, r.src, null);
      counters[r.slug]!.reutilises++;
    }
    for (const r of newPlayable) {
      await addTrack(r, r.videoId, null, r.videoTitle);
      counters[r.slug]!.nouveaux++;
    }
  } finally {
    writeRollback();
  }

  // ── track_count cohérent + tailles finales ──
  const plInfo: Array<{ slug: string; name: string; n: number }> = [];
  for (const t of targets) {
    const n = await prisma.officialPlaylistTrack.count({ where: { playlist_id: t.id } });
    await prisma.officialPlaylist.update({ where: { id: t.id }, data: { track_count: n } });
    plInfo.push({ slug: t.slug, name: t.name_fr, n });
  }

  console.log('\n=== TAILLES FINALES ===');
  for (const p of plInfo) console.log(`  ${p.slug} — "${p.name}" → ${p.n} tracks`);
  console.log('\n=== COMPTEURS (ajoutés nets par playlist) ===');
  for (const slug of TARGET_SLUGS) {
    const c = counters[slug]!;
    console.log(
      `  ${slug} : nouveaux ${c.nouveaux} · réutilisés ${c.reutilises} · youtube-échec ${c.ytEchec} · (net +${c.nouveaux + c.reutilises})`,
    );
  }
  console.log('\n=== ÉCHANTILLON 15 (nouveaux d’abord) ===');
  const sample = [...created.filter((c) => !c.reused), ...created.filter((c) => c.reused)].slice(
    0,
    15,
  );
  for (const c of sample) {
    const tag = c.reused ? '(réutilisé)' : '(nouveau)';
    console.log(
      `  [${c.slug.replace('official-pl-', '')}] ${tag} [${c.level}] ${c.artist} — ${c.title}`,
    );
    console.log(
      `      → ${c.videoTitle ?? '(id réutilisé du catalogue)'}  https://youtu.be/${c.youtube_id}`,
    );
  }
  const totalAdded = created.length;
  const totalEchec = Object.values(counters).reduce((s, c) => s + c.ytEchec, 0);
  console.log(`\n=== TOTAL : +${totalAdded} tracks ajoutées · ${totalEchec} youtube-échec ===`);
  console.log(`📄 ROLLBACK : ${ROLLBACK}`);
  console.log(`   undo = pnpm exec tsx scripts/funPlaylistsRollback.ts "${ROLLBACK}"`);
  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
