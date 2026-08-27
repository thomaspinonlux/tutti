/**
 * Ingestion vague 1 — 6 playlists thématiques multi-niveaux depuis
 * backend/data/tutti-playlists-vague1.csv (playlist,artist,title,level).
 *
 * Playlists (créées si absentes, réutilisées sinon) :
 *   - Un seul tube              · official-pl-un-seul-tube
 *   - Eurodance 90s             · official-pl-eurodance-90s
 *   - Boys & Girls Bands        · official-pl-boys-girls-bands
 *   - Latino Fiesta             · official-pl-latino-fiesta
 *   - Pop Divas                 · official-pl-pop-divas
 *   - Chanson française culte   · official-pl-chanson-francaise-culte
 *
 * Sémantique dédup (même que createFunPlaylists) :
 *   - track déjà au catalogue (artist+title fuzzy) → RÉUTILISE son youtube_id
 *     (+ spotify_id / song_id / cover / aliases) MAIS crée quand même une
 *     nouvelle ligne OfficialPlaylistTrack dans la nouvelle playlist
 *     (curation complète, pas de re-search YT).
 *   - track absente → résout un nouveau youtube_id (search → validate
 *     videos.list, reject si invalide).
 *   - difficulty per-track = colonne CSV : EASY/MEDIUM/HARD → enum DB
 *     EASY/MEDIUM/EXPERT (HARD = EXPERT).
 *
 * Réversible : logge playlists créées + chaque track id → rollback supprime
 * les tracks + les playlists créées. Jetable (campagne).
 *
 * Tirage random vérifié : `gameplayCore.pickRandomTrackIdsForRound`
 * (Fisher-Yates + anti-doublon session via SessionPlayedTrack) → une partie
 * pioche 15 tracks au hasard dans le pool, jamais les 15 premières. Les 80
 * tracks sont donc réutilisables d'une partie à l'autre.
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
loadEnv({ path: '/Users/thomaspinon/Documents/Claude Code/tutti/credentials.env.local' });
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient, type Level } from '@prisma/client';
import { classifyYoutubeIds } from '../src/lib/youtubeValidation.js';

const ROOT = '/Users/thomaspinon/Documents/Claude Code/tutti';
const CSV = `${ROOT}/backend/data/tutti-playlists-vague1.csv`;
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const ROLLBACK = `${ROOT}/vague1-rollback-${STAMP}.json`;
const THROTTLE_MS = 120;

const META: Record<
  string,
  { slug: string; name_en: string; sub_fr: string; sub_en: string; category: string }
> = {
  'Un seul tube': {
    slug: 'official-pl-un-seul-tube',
    name_en: 'One-Hit Wonders',
    sub_fr: 'Le tube que tout le monde connaît + un seul album',
    sub_en: 'The single hit everyone remembers',
    category: 'originals',
  },
  'Eurodance 90s': {
    slug: 'official-pl-eurodance-90s',
    name_en: 'Eurodance 90s',
    sub_fr: 'BPM 130 et tubes synthétiques de l’Europe entière',
    sub_en: 'BPM 130 + synth anthems from across Europe',
    category: 'genres',
  },
  'Boys & Girls Bands': {
    slug: 'official-pl-boys-girls-bands',
    name_en: 'Boys & Girls Bands',
    sub_fr: 'Posters dans la chambre, refrains immortels',
    sub_en: 'Bedroom posters, immortal choruses',
    category: 'originals',
  },
  'Latino Fiesta': {
    slug: 'official-pl-latino-fiesta',
    name_en: 'Latino Fiesta',
    sub_fr: 'Salsa, reggaetón, kuduro — ça danse',
    sub_en: 'Salsa, reggaetón, kuduro — ¡fiesta!',
    category: 'genres',
  },
  'Pop Divas': {
    slug: 'official-pl-pop-divas',
    name_en: 'Pop Divas',
    sub_fr: 'De Madonna à Billie Eilish, le règne des reines pop',
    sub_en: 'From Madonna to Billie, the pop queens dynasty',
    category: 'originals',
  },
  'Chanson française culte': {
    slug: 'official-pl-chanson-francaise-culte',
    name_en: 'Iconic French Songs',
    sub_fr: 'Goldman, Cabrel, Téléphone — le répertoire FR culte',
    sub_en: 'Goldman, Cabrel, Téléphone — the iconic FR canon',
    category: 'originals',
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
  if (v === 'HARD') return 'EXPERT';
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

type Row = { playlist: string; artist: string; title: string; level: Level };

async function main(): Promise<void> {
  // YOUTUBE_API_KEY est OPTIONNEL : si absent, on ingère uniquement les
  // tracks déjà au catalogue (réutilisation des youtube_id existants), on
  // skip la résolution des nouveaux. Permet un partial run quand le quota
  // YT est cap ou que la clé n'est pas dispo localement.
  const apiKey = process.env.YOUTUBE_API_KEY ?? '';
  if (!apiKey) {
    console.warn(
      '⚠️  YOUTUBE_API_KEY absent — partial run : seuls les tracks déjà au catalogue seront ajoutés. Les nouveaux seront SKIPPÉS (comptés en youtube-échec). Set YOUTUBE_API_KEY dans backend/.env pour le run complet.',
    );
  }
  const prisma = new PrismaClient();

  const rawRows = readFileSync(CSV, 'utf8')
    .split('\n')
    .slice(1)
    .filter((l) => l.trim())
    .map(parseCsvLine);
  const rows: Row[] = rawRows
    .map((c) => ({
      playlist: (c[0] ?? '').trim(),
      artist: (c[1] ?? '').trim(),
      title: (c[2] ?? '').trim(),
      level: levelFromCsv(c[3] ?? ''),
    }))
    .filter((r) => r.playlist && r.artist && r.title && r.playlist in META);

  // index catalogue existant : dedupKey → meilleur track (préfère youtube_id valide).
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

  // upsert / réutilise les 6 playlists.
  const createdPlaylistIds: string[] = [];
  const plIdByName: Record<string, string> = {};
  for (const [name, m] of Object.entries(META)) {
    const found = await prisma.officialPlaylist.findFirst({
      where: { OR: [{ slug: m.slug }, { name_fr: name }] },
      select: { id: true },
    });
    if (found) {
      plIdByName[name] = found.id;
      console.log(`↺ playlist existante réutilisée : "${name}" (${found.id})`);
    } else {
      const pl = await prisma.officialPlaylist.create({
        data: {
          slug: m.slug,
          name_fr: name,
          name_en: m.name_en,
          locale_primary: 'fr-FR',
          theme: m.slug.replace('official-pl-', ''),
          difficulty: 'MEDIUM', // mix — différentes par track
          visibility: 'public',
          category: m.category,
          subtitle_fr: m.sub_fr,
          subtitle_en: m.sub_en,
          track_count: 0,
        },
        select: { id: true },
      });
      plIdByName[name] = pl.id;
      createdPlaylistIds.push(pl.id);
      console.log(`✚ playlist créée : "${name}" (${pl.id})`);
    }
  }
  const maxPos = new Map<string, number>();
  // Idempotence : pour chaque playlist cible, on indexe les tracks déjà
  // présentes (par artist+title dédupliqué) → un re-run ne double pas les
  // entrées. Permet `partial run` (sans YT key) puis `retry` (avec key).
  const presentByPlaylist = new Map<string, Set<string>>();
  for (const [name, id] of Object.entries(plIdByName)) {
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
    presentByPlaylist.set(name, set);
  }

  // classer : déjà dans la playlist (skip), réutilisé du catalogue, ou nouveau.
  const reuse: Array<Row & { src: ExTrack }> = [];
  const toSearch: Row[] = [];
  let alreadyInPlaylist = 0;
  for (const r of rows) {
    const k = dedupKey(r.artist, r.title);
    if (presentByPlaylist.get(r.playlist)?.has(k)) {
      alreadyInPlaylist++;
      continue; // idempotence : re-run safe.
    }
    const ex = existing.get(k);
    if (ex && ex.youtube_id) reuse.push({ ...r, src: ex });
    else toSearch.push(r);
  }
  if (alreadyInPlaylist > 0) {
    console.log(
      `  idempotence : ${alreadyInPlaylist} tracks déjà présentes dans leur playlist → skip`,
    );
  }

  console.log(
    `\n=== DRY-RUN PRE-WRITE ===\n  total CSV  : ${rows.length}\n  réutilisé : ${reuse.length}\n  à résoudre : ${toSearch.length}\n`,
  );

  const counters: Record<string, { nouveaux: number; reutilises: number; ytEchec: number }> = {};
  for (const name of Object.keys(META)) counters[name] = { nouveaux: 0, reutilises: 0, ytEchec: 0 };

  // résoudre les nouveaux (search + classify batch). Skip si pas d'API key.
  const resolved: Array<Row & { videoId: string; videoTitle: string }> = [];
  if (apiKey && toSearch.length > 0) {
    for (const [i, r] of toSearch.entries()) {
      if (i % 25 === 0) console.log(`  search ${i}/${toSearch.length}…`);
      try {
        const hit = await searchYouTube(apiKey, r.artist, r.title);
        if (!hit) {
          counters[r.playlist]!.ytEchec++;
          continue;
        }
        resolved.push({ ...r, ...hit });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'QUOTA') {
          console.warn(
            `  🚫 quota YouTube atteint après ${i}/${toSearch.length} — stop search propre`,
          );
          for (const rem of toSearch.slice(i)) counters[rem.playlist]!.ytEchec++;
          break;
        }
        counters[r.playlist]!.ytEchec++;
      }
      await sleep(THROTTLE_MS);
    }
  } else if (!apiKey && toSearch.length > 0) {
    // Pas de clé : tous les "à résoudre" sont skip — comptés ytEchec.
    for (const r of toSearch) counters[r.playlist]!.ytEchec++;
  }

  const verdicts = apiKey
    ? await classifyYoutubeIds(
        apiKey,
        resolved.map((r) => r.videoId),
      )
    : new Map<string, { is_playable: boolean }>();
  const newPlayable = resolved.filter((r) => {
    if (verdicts.get(r.videoId)?.is_playable) return true;
    counters[r.playlist]!.ytEchec++;
    return false;
  });

  // append (rollback dans finally → réversibilité même sur crash).
  const created: Array<{
    id: string;
    playlist: string;
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
      r: Row,
      yt: string,
      src: ExTrack | null,
      videoTitle: string | null,
    ): Promise<void> => {
      const plId = plIdByName[r.playlist]!;
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
        playlist: r.playlist,
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
      counters[r.playlist]!.reutilises++;
    }
    for (const r of newPlayable) {
      await addTrack(r, r.videoId, null, r.videoTitle);
      counters[r.playlist]!.nouveaux++;
    }
  } finally {
    writeRollback();
  }

  // track_count cohérent.
  const plInfo: Array<{ id: string; name: string; n: number }> = [];
  for (const [name, id] of Object.entries(plIdByName)) {
    const n = await prisma.officialPlaylistTrack.count({ where: { playlist_id: id } });
    await prisma.officialPlaylist.update({ where: { id }, data: { track_count: n } });
    plInfo.push({ id, name, n });
  }

  console.log('\n=== PLAYLISTS ===');
  for (const p of plInfo) console.log(`  "${p.name}"  id=${p.id}  morceaux=${p.n}`);
  console.log('\n=== COMPTEURS (par playlist) ===');
  for (const [name, c] of Object.entries(counters)) {
    console.log(
      `  "${name}" : ajoutés-nouveaux ${c.nouveaux} · réutilisés-existants ${c.reutilises} · youtube-échec ${c.ytEchec}`,
    );
  }
  console.log('\n=== ÉCHANTILLON 15 (priorité aux NOUVEAUX résolus) ===');
  const sample = [...created.filter((c) => !c.reused), ...created.filter((c) => c.reused)].slice(
    0,
    15,
  );
  for (const c of sample) {
    const tag = c.reused ? '(réutilisé)' : '(nouveau)';
    console.log(`  [${c.playlist}] ${tag} [${c.level}] ${c.artist} — ${c.title}`);
    console.log(
      `      → ${c.videoTitle ?? '(id réutilisé du catalogue)'}  https://youtu.be/${c.youtube_id}`,
    );
  }
  console.log(`\n📄 ROLLBACK : ${ROLLBACK}`);
  console.log(
    `   undo = pnpm exec tsx scripts/funPlaylistsRollback.ts "${ROLLBACK}"  (même format que fun-playlists)`,
  );
  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
