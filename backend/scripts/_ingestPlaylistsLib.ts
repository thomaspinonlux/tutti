/**
 * _ingestPlaylistsLib.ts — moteur d'ingestion catalogue partagé entre les
 * scripts de campagne (vague1, vague2, latino-italie, etc.).
 *
 * CSV format : playlist,artist,title,level (level = EASY/MEDIUM/HARD).
 *
 * Sémantique :
 *   - upsert / réutilise les playlists (slug ou name_fr matchant).
 *   - track déjà dans la playlist cible (artist+title fuzzy) → SKIP
 *     (idempotence : re-run safe).
 *   - track au catalogue mais pas dans la playlist → RÉUTILISE son
 *     youtube_id (+ spotify_id / song_id / cover / aliases), nouvelle ligne
 *     OfficialPlaylistTrack avec le level de la ligne CSV.
 *   - track absente du catalogue → résout un nouveau youtube_id (search →
 *     classify), drop si invalide.
 *   - difficulty per-track : EASY / MEDIUM (default) / EXPERT (=HARD CSV).
 *   - YOUTUBE_API_KEY optionnel : si absent, on n'ingère que les réutilisés.
 *
 * Réversible : rollback JSON compatible `funPlaylistsRollback.ts`.
 *
 * Tirage random vérifié : `gameplayCore.pickRandomTrackIdsForRound`
 * (Fisher-Yates + anti-doublon session via SessionPlayedTrack).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pLimit from 'p-limit';
import { PrismaClient, type Level } from '@prisma/client';
import { classifyYoutubeIds } from '../src/lib/youtubeValidation.js';

// feat/ytdlp-fallback — yt-dlp en secours quand l'API search ne trouve aucun
// candidat embeddable. Binaire standalone gardé dans le scratchpad (pas
// d'install système). N=5 process concurrents. Désactivé proprement si absent.
const pexec = promisify(execFile);
const YTDLP_BIN =
  process.env.YTDLP_BIN ??
  '/private/tmp/claude-501/-Users-thomaspinon-Documents-Claude-Code/a9f75dfd-8016-4626-91ce-ab632973c807/scratchpad/yt-dlp';
const YTDLP_OK = existsSync(YTDLP_BIN);
const YTDLP_CONCURRENCY = 5;
async function ytdlpResolve(
  artist: string,
  title: string,
): Promise<{ id: string; title: string; duration: number } | null> {
  try {
    const { stdout } = await pexec(
      YTDLP_BIN,
      [
        '--skip-download',
        '--no-warnings',
        '--no-playlist',
        '--print',
        '%(id)s|%(duration)s|%(title)s',
        `ytsearch1:${artist} ${title}`,
      ],
      { timeout: 90000, maxBuffer: 4 * 1024 * 1024 },
    );
    const parts = String(stdout).trim().split('|');
    const id = parts[0];
    if (!id) return null;
    return { id, duration: Number(parts[1]) || 0, title: parts.slice(2).join('|') };
  } catch {
    return null;
  }
}

export interface PlaylistMeta {
  slug: string;
  name_en: string;
  sub_fr: string;
  sub_en: string;
  category: string;
}
export interface IngestOptions {
  csvPath: string;
  rollbackPath: string;
  meta: Record<string, PlaylistMeta>;
  /** Étiquette de campagne pour les logs (ex: "vague1"). */
  campaign: string;
}

const THROTTLE_MS = 120;
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
// feat/relaxed-youtube-match — n'écarte un terme interdit (live/remix/cover…)
// QUE s'il est absent du TITRE SOURCE. Un titre légitime "Live Forever" ou
// "Cover Me" ne doit pas faire chuter tous les résultats.
function forbiddenHit(text: string, source: string): boolean {
  const l = lower(text);
  const src = lower(source);
  return FORBIDDEN_TERMS.some((t) => l.includes(t) && !src.includes(t));
}
// Normalisation pour la comparaison de similarité : minuscule + strip
// parenthèses/crochets/feat/ponctuation → compare "artiste titre" épuré.
function normCmp(s: string): string {
  return lower(s)
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/feat\.?|ft\.?/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
// feat/relaxed-youtube-match — retourne les candidats CLASSÉS (meilleur d'abord)
// au lieu d'un seul, pour que l'appelant essaie le suivant si le 1er est
// non-embeddable. Assouplissements : (1) score = distance sur "artiste titre"
// NORMALISÉ (strip parenthèses/feat/ponctuation) → les vrais matches scorent
// bas malgré le bruit du titre vidéo ; (2) seuil 0.5 sur cette distance
// normalisée (plus permissif que 0.7 sur brut) ; (3) FORBIDDEN_TERMS appliqués
// seulement si absents du titre source.
const MATCH_THRESHOLD = 0.5;
const MAX_CANDIDATES = 5;
async function searchYouTube(
  apiKey: string,
  artist: string,
  title: string,
): Promise<Array<{ videoId: string; videoTitle: string }>> {
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
  if (!res.ok) return [];
  const data = (await res.json()) as { items: YTItem[] };
  const source = `${artist} ${title}`;
  const target = normCmp(source);
  let cands = (data.items ?? []).filter((it) => Boolean(it.id.videoId));
  // Termes interdits : seulement s'ils ne sont PAS dans le titre source.
  cands = cands.filter(
    (it) =>
      !forbiddenHit(it.snippet.title, source) && !forbiddenHit(it.snippet.channelTitle, source),
  );
  const artistLower = lower(artist);
  const scored = cands.map((it) => {
    const channel = lower(it.snippet.channelTitle);
    let score = levenshtein(normCmp(it.snippet.title), target); // comparaison normalisée
    if (channel.includes('vevo')) score -= 0.4;
    if (channel.includes('official')) score -= 0.25;
    if (channel.includes(artistLower)) score -= 0.2;
    if (channel.endsWith('- topic')) score -= 0.35;
    return { it, score };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored
    .filter((s) => s.score <= MATCH_THRESHOLD && s.it.id.videoId)
    .slice(0, MAX_CANDIDATES)
    .map((s) => ({ videoId: s.it.id.videoId!, videoTitle: s.it.snippet.title }));
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

export async function ingestPlaylists(opts: IngestOptions): Promise<void> {
  const apiKey = process.env.YOUTUBE_API_KEY ?? '';
  if (!apiKey) {
    console.warn(
      `⚠️  [${opts.campaign}] YOUTUBE_API_KEY absent — partial run : seuls les tracks déjà au catalogue seront ajoutés. Les nouveaux seront SKIPPÉS.`,
    );
  }
  const prisma = new PrismaClient();

  const rawRows = readFileSync(opts.csvPath, 'utf8')
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
    .filter((r) => r.playlist && r.artist && r.title && r.playlist in opts.meta);

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

  const createdPlaylistIds: string[] = [];
  const plIdByName: Record<string, string> = {};
  for (const [name, m] of Object.entries(opts.meta)) {
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
          difficulty: 'MEDIUM',
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

  const reuse: Array<Row & { src: ExTrack }> = [];
  const toSearch: Row[] = [];
  let alreadyInPlaylist = 0;
  for (const r of rows) {
    const k = dedupKey(r.artist, r.title);
    if (presentByPlaylist.get(r.playlist)?.has(k)) {
      alreadyInPlaylist++;
      continue;
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
    `\n=== DRY-RUN PRE-WRITE [${opts.campaign}] ===\n  CSV total  : ${rows.length}\n  réutilisé  : ${reuse.length}\n  à résoudre : ${toSearch.length}\n`,
  );

  const counters: Record<string, { nouveaux: number; reutilises: number; ytEchec: number }> = {};
  for (const name of Object.keys(opts.meta)) {
    counters[name] = { nouveaux: 0, reutilises: 0, ytEchec: 0 };
  }

  // feat/relaxed-youtube-match — 1) collecte les candidats CLASSÉS par track
  // (search assoupli) ; 2) classify TOUS les candidats en batch ; 3) par track,
  // retient le 1er candidat EMBEDDABLE (try-next si le meilleur est bloqué).
  const candPerRow: Array<{ r: Row; cands: Array<{ videoId: string; videoTitle: string }> }> = [];
  if (apiKey && toSearch.length > 0) {
    for (const [i, r] of toSearch.entries()) {
      if (i % 25 === 0) console.log(`  search ${i}/${toSearch.length}…`);
      try {
        const cands = await searchYouTube(apiKey, r.artist, r.title);
        candPerRow.push({ r, cands });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'QUOTA') {
          console.warn(`  🚫 quota YouTube atteint après ${i}/${toSearch.length} — stop search`);
          for (const rem of toSearch.slice(i)) counters[rem.playlist]!.ytEchec++;
          break;
        }
        candPerRow.push({ r, cands: [] });
      }
      await sleep(THROTTLE_MS);
    }
  } else if (!apiKey && toSearch.length > 0) {
    for (const r of toSearch) counters[r.playlist]!.ytEchec++;
  }

  const allCandIds = [...new Set(candPerRow.flatMap((c) => c.cands.map((x) => x.videoId)))];
  const verdicts =
    apiKey && allCandIds.length > 0
      ? await classifyYoutubeIds(apiKey, allCandIds)
      : new Map<string, { is_playable: boolean }>();
  // Par track : 1er candidat (ordre de pertinence) qui est jouable/embeddable.
  const newPlayable: Array<Row & { videoId: string; videoTitle: string }> = [];
  const apiFailed: Row[] = [];
  for (const { r, cands } of candPerRow) {
    const pick = cands.find((x) => verdicts.get(x.videoId)?.is_playable);
    if (pick) newPlayable.push({ ...r, ...pick });
    else apiFailed.push(r);
  }

  // feat/ytdlp-fallback — secours yt-dlp sur les tracks droppées par l'API
  // (ytsearch1 = ranking natif YouTube, pas de gate Levenshtein). Embeddable
  // re-validé via classifyYoutubeIds. Garde-fou pertinence léger : artiste OU
  // titre présent dans le titre vidéo, OU durée plausible (30s–10min) — laisse
  // passer les dubs régionaux, drop le hors-sujet flagrant.
  if (YTDLP_OK && apiKey && apiFailed.length > 0) {
    console.log(
      `  [yt-dlp] fallback sur ${apiFailed.length} droppées (concurrence ${YTDLP_CONCURRENCY})…`,
    );
    const limit = pLimit(YTDLP_CONCURRENCY);
    const ytResolved = await Promise.all(
      apiFailed.map((r) => limit(async () => ({ r, hit: await ytdlpResolve(r.artist, r.title) }))),
    );
    const ytIds = [...new Set(ytResolved.map((x) => x.hit?.id).filter((x): x is string => !!x))];
    const ytVerdicts = ytIds.length
      ? await classifyYoutubeIds(apiKey, ytIds)
      : new Map<string, { is_playable: boolean }>();
    let recovered = 0;
    for (const { r, hit } of ytResolved) {
      const vt = hit ? normCmp(hit.title) : '';
      const a = normCmp(r.artist);
      const t = normCmp(r.title);
      const relevant =
        !!hit &&
        ((a.length >= 3 && vt.includes(a)) ||
          (t.length >= 3 && vt.includes(t)) ||
          (hit.duration >= 30 && hit.duration <= 600));
      if (hit && ytVerdicts.get(hit.id)?.is_playable && relevant) {
        newPlayable.push({ ...r, videoId: hit.id, videoTitle: hit.title });
        recovered++;
      } else {
        counters[r.playlist]!.ytEchec++;
      }
    }
    console.log(`  [yt-dlp] récupérées ${recovered}/${apiFailed.length}`);
  } else {
    for (const r of apiFailed) counters[r.playlist]!.ytEchec++;
  }

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
      opts.rollbackPath,
      JSON.stringify(
        {
          created_at: new Date().toISOString(),
          campaign: opts.campaign,
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

  const plInfo: Array<{ id: string; name: string; n: number }> = [];
  for (const [name, id] of Object.entries(plIdByName)) {
    const n = await prisma.officialPlaylistTrack.count({ where: { playlist_id: id } });
    await prisma.officialPlaylist.update({ where: { id }, data: { track_count: n } });
    plInfo.push({ id, name, n });
  }

  console.log(`\n=== PLAYLISTS [${opts.campaign}] ===`);
  for (const p of plInfo) console.log(`  "${p.name}"  id=${p.id}  morceaux=${p.n}`);
  console.log(`\n=== COMPTEURS [${opts.campaign}] (par playlist) ===`);
  for (const [name, c] of Object.entries(counters)) {
    console.log(
      `  "${name}" : ajoutés-nouveaux ${c.nouveaux} · réutilisés-existants ${c.reutilises} · youtube-échec ${c.ytEchec}`,
    );
  }
  console.log(`\n=== ÉCHANTILLON 15 [${opts.campaign}] (NOUVEAUX puis réutilisés) ===`);
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
  console.log(`\n📄 ROLLBACK : ${opts.rollbackPath}`);
  console.log(
    `   undo = pnpm exec tsx scripts/funPlaylistsRollback.ts "${opts.rollbackPath}"  (format compatible)`,
  );
  await prisma.$disconnect();
}
