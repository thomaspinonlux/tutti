/**
 * Crée 2 playlists officielles thématiques mono-niveau (EASY) depuis
 * ~/Downloads/tutti-playlists-fun-faciles.csv (playlist,artist,title,level).
 *
 * "Karaoké de Komptoir" : le K est VOLONTAIRE (marque user) — NE PAS corriger.
 *
 * Sémantique dédup (≠ addEasyTracks) :
 *   - morceau déjà au catalogue (artist+title fuzzy) → RÉUTILISE son youtube_id
 *     (+ spotify_id/song_id/cover/aliases), MAIS crée quand même une nouvelle
 *     ligne OfficialPlaylistTrack dans la nouvelle playlist (pas de re-search YT).
 *   - morceau absent → résout un nouveau youtube_id (search → validate videos.list).
 *   Toutes les lignes résolues entrent dans la playlist (curation complète).
 *
 * Réversible : logge playlists créées + chaque track id → rollback supprime
 * les tracks + les playlists créées. Jetable (campagne).
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { classifyYoutubeIds } from '../src/lib/youtubeValidation.js';

const ROOT = '/Users/thomaspinon/Documents/Claude Code/tutti';
const CSV = '/Users/thomaspinon/Downloads/tutti-playlists-fun-faciles.csv';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const ROLLBACK = `${ROOT}/fun-playlists-rollback-${STAMP}.json`;
const THROTTLE_MS = 120;

// nom playlist (col CSV) → métadonnées de création. "Komptoir" avec K : VOULU.
const META: Record<string, { slug: string; name_en: string; sub_fr: string; sub_en: string }> = {
  'Guilty Pleasures': {
    slug: 'official-pl-guilty-pleasures',
    name_en: 'Guilty Pleasures',
    sub_fr: 'La honte assumée',
    sub_en: 'Songs you secretly love',
  },
  'Karaoké de Komptoir': {
    slug: 'official-pl-karaoke-komptoir',
    name_en: 'Komptoir Karaoke',
    sub_fr: 'Anthems internationaux + tubes FR à brailler',
    sub_en: 'Singalong anthems',
  },
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

async function main(): Promise<void> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.error('🛑 YOUTUBE_API_KEY absent → STOP.');
    process.exit(1);
  }
  const prisma = new PrismaClient();

  const rows = readFileSync(CSV, 'utf8')
    .split('\n')
    .slice(1)
    .filter((l) => l.trim())
    .map(parseCsvLine)
    .map((c) => ({
      playlist: (c[0] ?? '').trim(),
      artist: (c[1] ?? '').trim(),
      title: (c[2] ?? '').trim(),
    }))
    .filter((r) => r.playlist && r.artist && r.title && r.playlist in META);

  // index catalogue existant : dedupKey → meilleur track (préfère un avec youtube_id)
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

  // upsert/réutilise les 2 playlists
  const createdPlaylistIds: string[] = [];
  const plIdByName: Record<string, string> = {};
  for (const [name, m] of Object.entries(META)) {
    const found = await prisma.officialPlaylist.findFirst({
      where: { OR: [{ slug: m.slug }, { name_fr: name }] },
      select: { id: true },
    });
    if (found) {
      plIdByName[name] = found.id;
      console.log(`↺ playlist existante réutilisée: "${name}" (${found.id})`);
    } else {
      const pl = await prisma.officialPlaylist.create({
        data: {
          slug: m.slug,
          name_fr: name,
          name_en: m.name_en,
          locale_primary: 'fr-FR',
          theme: m.slug.replace('official-pl-', ''),
          difficulty: 'EASY',
          visibility: 'public',
          category: 'originals',
          subtitle_fr: m.sub_fr,
          subtitle_en: m.sub_en,
          track_count: 0,
        },
        select: { id: true },
      });
      plIdByName[name] = pl.id;
      createdPlaylistIds.push(pl.id);
      console.log(`✚ playlist créée: "${name}" (${pl.id})`);
    }
  }
  const maxPos = new Map<string, number>();
  for (const id of Object.values(plIdByName)) {
    const a = await prisma.officialPlaylistTrack.aggregate({
      where: { playlist_id: id },
      _max: { position: true },
    });
    maxPos.set(id, a._max.position ?? 0);
  }

  // classer : réutilisé (id connu) vs nouveau (search)
  type Row = { playlist: string; artist: string; title: string };
  const reuse: Array<Row & { src: ExTrack }> = [];
  const toSearch: Row[] = [];
  for (const r of rows) {
    const ex = existing.get(dedupKey(r.artist, r.title));
    if (ex && ex.youtube_id) reuse.push({ ...r, src: ex });
    else toSearch.push(r);
  }

  // résoudre les nouveaux
  const counters: Record<string, { nouveaux: number; reutilises: number; ytEchec: number }> = {};
  for (const name of Object.keys(META)) counters[name] = { nouveaux: 0, reutilises: 0, ytEchec: 0 };
  const resolved: Array<Row & { videoId: string; videoTitle: string }> = [];
  for (const r of toSearch) {
    try {
      const hit = await searchYouTube(apiKey, r.artist, r.title);
      if (!hit) {
        counters[r.playlist]!.ytEchec++;
        continue;
      }
      resolved.push({ ...r, ...hit });
    } catch {
      counters[r.playlist]!.ytEchec++;
    }
    await sleep(THROTTLE_MS);
  }
  const verdicts = await classifyYoutubeIds(
    apiKey,
    resolved.map((r) => r.videoId),
  );
  const newPlayable = resolved.filter((r) => {
    if (verdicts.get(r.videoId)?.is_playable) return true;
    counters[r.playlist]!.ytEchec++;
    return false;
  });

  // append (rollback dans finally → réversibilité garantie même sur crash)
  const created: Array<{
    id: string;
    playlist: string;
    artist: string;
    title: string;
    youtube_id: string;
    videoTitle: string | null;
    reused: boolean;
  }> = [];
  const writeRollback = (): void => {
    writeFileSync(
      ROLLBACK,
      JSON.stringify(
        {
          created_at: new Date().toISOString(),
          created_playlist_ids: createdPlaylistIds,
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
      playlist: string,
      artist: string,
      title: string,
      yt: string,
      src: ExTrack | null,
      videoTitle: string | null,
    ): Promise<void> => {
      const plId = plIdByName[playlist]!;
      const pos = (maxPos.get(plId) ?? 0) + 1;
      maxPos.set(plId, pos);
      const t = await prisma.officialPlaylistTrack.create({
        data: {
          playlist_id: plId,
          position: pos,
          title,
          artist,
          difficulty: 'EASY',
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
        playlist,
        artist,
        title,
        youtube_id: yt,
        videoTitle,
        reused: !!src,
      });
    };
    for (const r of reuse) {
      await addTrack(r.playlist, r.artist, r.title, r.src.youtube_id!, r.src, null);
      counters[r.playlist]!.reutilises++;
    }
    for (const r of newPlayable) {
      await addTrack(r.playlist, r.artist, r.title, r.videoId, null, r.videoTitle);
      counters[r.playlist]!.nouveaux++;
    }
  } finally {
    writeRollback();
  }

  // track_count cohérent
  const plInfo: Array<{ id: string; name: string; n: number }> = [];
  for (const [name, id] of Object.entries(plIdByName)) {
    const n = await prisma.officialPlaylistTrack.count({ where: { playlist_id: id } });
    await prisma.officialPlaylist.update({ where: { id }, data: { track_count: n } });
    plInfo.push({ id, name, n });
  }

  // ───── SORTIE ─────
  console.log('\n=== PLAYLISTS ===');
  for (const p of plInfo) console.log(`  "${p.name}"  id=${p.id}  morceaux=${p.n}`);
  console.log('\n=== COMPTEURS (par playlist) ===');
  for (const [name, c] of Object.entries(counters)) {
    console.log(
      `  "${name}" : ajoutés-nouveaux ${c.nouveaux} · réutilisés-existants ${c.reutilises} · youtube-échec ${c.ytEchec}`,
    );
  }
  console.log(
    '\n=== ÉCHANTILLON 15 (priorité aux NOUVEAUX résolus — repérer un mauvais match) ===',
  );
  const sample = [...created.filter((c) => !c.reused), ...created.filter((c) => c.reused)].slice(
    0,
    15,
  );
  for (const c of sample) {
    const tag = c.reused ? '(réutilisé)' : '(nouveau)';
    console.log(
      `  [${c.playlist === 'Guilty Pleasures' ? 'GP' : 'KK'}] ${tag} ${c.artist} — ${c.title}`,
    );
    console.log(
      `      → ${c.videoTitle ?? '(id réutilisé du catalogue)'}  https://youtu.be/${c.youtube_id}`,
    );
  }
  console.log(`\n📄 ROLLBACK : ${ROLLBACK}`);
  console.log(`   undo = pnpm exec tsx scripts/funPlaylistsRollback.ts "${ROLLBACK}"`);
  await prisma.$disconnect();
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
