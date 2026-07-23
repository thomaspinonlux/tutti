/**
 * lib/officialLibraryImport.ts — moteur d'import bibliothèque officielle.
 *
 * Logique partagée entre :
 *   - le script CLI scripts/import-official-library.ts (orchestre + logs)
 *   - les routes admin /api/admin/library/* (déclenchement manuel UI)
 *
 * Pour chaque track :
 *   - Spotify Web API client_credentials avec query "artist title" + year:Y-Y
 *     filtrage 2-pass. Levenshtein ranking, threshold permissif 0.85.
 *   - YouTube Data v3 search avec priorisation VEVO/Official/Topic/nom artiste.
 *   - Filtre remix/live/cover/karaoke + termes additionnels avoid[].
 *
 * Upsert idempotent par slug. Réécrit le JSON source avec les IDs résolus
 * (cache pour run suivant).
 *
 * Variables d'env requises :
 *   - SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET (sinon Spotify skipped)
 *   - YOUTUBE_API_KEY (sinon YouTube skipped)
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { Prisma } from '@prisma/client';
import pLimit from 'p-limit';
import { prisma } from './prisma.js';
// fix/official-import-canonical — rattache chaque track officiel à sa chanson
// canonique (song_id) + pose un socle d'alias dès l'import. On RÉUTILISE la
// logique de matching (findOrCreateSong/songKey) — identique à celle de
// migrate:canonical-songs — pour ne pas dupliquer le normalisateur.
import { findOrCreateSong, songKey } from './songCatalog.js';
import { generateAliases } from './aliases.js';

// ───── Types JSON source ──────────────────────────────────────────────────

type DifficultyDb = 'EASY' | 'MEDIUM' | 'EXPERT';
type VisibilityDb = 'public' | 'premium_only' | 'private';

export interface SourceTrack {
  position: number;
  title: string;
  artist: string;
  year?: number | null;
  difficulty?: string;
  spotify_id?: string | null;
  youtube_id?: string | null;
  /** URL cover album/track. Récupérée auto via Spotify lors de l'import.
   *  Fallback YouTube thumbnail si Spotify indispo. */
  cover_url?: string | null;
  answers_accepted?: Record<string, unknown> | null;
}

export interface SourcePlaylist {
  /** Slug stable. Lu depuis "slug" OU "id" (legacy curated format). */
  id?: string;
  slug?: string;
  name_fr: string;
  name_en: string;
  description_fr?: string | null;
  description_en?: string | null;
  locale_primary: string;
  theme?: string | null;
  difficulty?: string;
  visibility?: VisibilityDb;
  track_count?: number;
  import_hints?: {
    filter_remix_live_cover_karaoke?: boolean;
    year_range_strict?: boolean | [number, number];
    year_range_years?: number;
    avoid?: string[];
    preferred_version?: string;
  } | null;
  tracks: SourceTrack[];
}

interface NormalizedPlaylist {
  slug: string;
  name_fr: string;
  name_en: string;
  description_fr: string | null;
  description_en: string | null;
  locale_primary: string;
  theme: string | null;
  difficulty: DifficultyDb;
  visibility: VisibilityDb;
  yearMin: number | null;
  yearMax: number | null;
  yearStrict: boolean;
  yearRange: number;
  filterForbidden: boolean;
  extraForbidden: string[];
  tracks: SourceTrack[];
}

export interface FileReport {
  filename: string;
  slug: string;
  total: number;
  spotifyMatched: number;
  spotifyAlreadyCached: number;
  spotifyMissed: number;
  youtubeMatched: number;
  youtubeAlreadyCached: number;
  youtubeMissed: number;
  unmatched: Array<{
    position: number;
    artist: string;
    title: string;
    spotify: boolean;
    youtube: boolean;
  }>;
}

export interface ImportResult {
  files: FileReport[];
  durationMs: number;
  spotifyAvailable: boolean;
  youtubeAvailable: boolean;
}

// ───── Helpers ────────────────────────────────────────────────────────────

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
  return FORBIDDEN_TERMS.some((term) => l.includes(term));
}

function levenshtein(a: string, b: string): number {
  const A = lower(a);
  const B = lower(b);
  if (A === B) return 0;
  const m = A.length;
  const n = B.length;
  if (!m) return n ? 1 : 0;
  if (!n) return 1;
  const dp: number[] = new Array(n + 1).fill(0);
  for (let j = 0; j <= n; j++) dp[j] = j;
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

function normalizeDifficulty(d: string | undefined): DifficultyDb {
  if (!d) return 'MEDIUM';
  const u = d.toUpperCase();
  if (u === 'EASY' || u === 'MEDIUM' || u === 'EXPERT') return u;
  return 'MEDIUM';
}

function normalizePlaylist(src: SourcePlaylist): NormalizedPlaylist {
  const slug = src.slug ?? src.id ?? '';
  const yearStrictRaw = src.import_hints?.year_range_strict;
  let yearMin: number | null = null;
  let yearMax: number | null = null;
  let yearStrict = false;
  if (Array.isArray(yearStrictRaw) && yearStrictRaw.length === 2) {
    yearMin = yearStrictRaw[0];
    yearMax = yearStrictRaw[1];
    yearStrict = true;
  } else if (yearStrictRaw === true) {
    yearStrict = true;
  }
  const yearRange = src.import_hints?.year_range_years ?? (yearStrict ? 2 : 5);
  return {
    slug,
    name_fr: src.name_fr,
    name_en: src.name_en,
    description_fr: src.description_fr ?? null,
    description_en: src.description_en ?? null,
    locale_primary: src.locale_primary,
    theme: src.theme ?? null,
    difficulty: normalizeDifficulty(src.difficulty),
    visibility: src.visibility ?? 'public',
    yearMin,
    yearMax,
    yearStrict,
    yearRange,
    filterForbidden: src.import_hints?.filter_remix_live_cover_karaoke !== false,
    extraForbidden: (src.import_hints?.avoid ?? []).map((s) => s.toLowerCase()),
    tracks: src.tracks,
  };
}

// ───── Spotify (client credentials) ────────────────────────────────────────

interface SpotifyToken {
  access_token: string;
  expires_at: number;
}

let spotifyToken: SpotifyToken | null = null;

async function getSpotifyAppToken(): Promise<string | null> {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (spotifyToken && spotifyToken.expires_at > Date.now() + 60_000) {
    return spotifyToken.access_token;
  }
  const auth = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    console.warn(`[Spotify] token request failed: ${res.status} ${await res.text()}`);
    return null;
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  spotifyToken = {
    access_token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  return spotifyToken.access_token;
}

interface SpotifySearchTrack {
  id: string;
  name: string;
  artists: Array<{ name: string }>;
  album: {
    name: string;
    release_date?: string;
    images?: Array<{ url: string; width?: number; height?: number }>;
  };
  explicit?: boolean;
  is_local?: boolean;
}

/**
 * Résultat de la recherche Spotify : id + cover URL extraite de
 * album.images[0] (la plus grande, ~640x640).
 */
interface SpotifyMatch {
  id: string;
  cover_url: string | null;
}

async function searchSpotifyTrack(
  track: SourceTrack,
  pl: NormalizedPlaylist,
): Promise<SpotifyMatch | null> {
  const token = await getSpotifyAppToken();
  if (!token) return null;
  const cleanArtist = track.artist.replace(/[":]/g, ' ').trim();
  const cleanTitle = track.title.replace(/[":]/g, ' ').trim();
  const baseQ = `${cleanArtist} ${cleanTitle}`;
  const queries: string[] = [];
  if (track.year && pl.yearStrict) {
    const yMin = pl.yearMin ?? track.year - pl.yearRange;
    const yMax = pl.yearMax ?? track.year + pl.yearRange;
    queries.push(`${baseQ} year:${yMin}-${yMax}`);
  }
  queries.push(baseQ);

  let allItems: SpotifySearchTrack[] = [];
  for (const q of queries) {
    const params = new URLSearchParams({ q, type: 'track', limit: '10' });
    const url = `https://api.spotify.com/v1/search?${params.toString()}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(
        `[Spotify] search failed for "${track.artist} - ${track.title}": ${res.status}${body ? ` ${body.slice(0, 200)}` : ''}`,
      );
      continue;
    }
    const data = (await res.json()) as { tracks: { items: SpotifySearchTrack[] } };
    allItems = allItems.concat(data.tracks.items);
    if (data.tracks.items.length > 0) break;
  }
  let candidates = allItems.filter((t) => !t.is_local);

  if (pl.filterForbidden) {
    candidates = candidates.filter((t) => {
      const combined = `${t.name} ${t.album.name}`;
      if (containsForbidden(combined)) return false;
      const lc = lower(combined);
      for (const term of pl.extraForbidden) {
        if (lc.includes(term)) return false;
      }
      return true;
    });
  }

  const scored = candidates.map((t) => {
    const artistDist = Math.min(...t.artists.map((a) => levenshtein(a.name, track.artist)));
    const titleDist = levenshtein(t.name, track.title);
    let score = artistDist + titleDist;
    const releaseYear = t.album.release_date
      ? parseInt(t.album.release_date.slice(0, 4), 10)
      : null;
    if (track.year && releaseYear) {
      if (releaseYear === track.year) score -= 0.15;
      else score += Math.min(0.3, Math.abs(releaseYear - track.year) * 0.04);
    }
    return { track: t, score };
  });
  scored.sort((a, b) => a.score - b.score);
  const best = scored[0];
  if (!best) return null;
  if (best.score > 0.85) {
    console.warn(
      `[Spotify] no good match for "${track.artist} - ${track.title}" (best score=${best.score.toFixed(2)})`,
    );
    return null;
  }
  // Extrait cover URL : album.images[0] est la plus grande (~640x640).
  const coverUrl = best.track.album.images?.[0]?.url ?? null;
  return { id: best.track.id, cover_url: coverUrl };
}

/**
 * Récupère cover_url pour un spotify_id déjà connu (cas re-import après
 * ajout du champ cover_url : les tracks ont déjà spotify_id mais pas de cover).
 * GET /v1/tracks/:id retourne album.images[0].url. Null si fail.
 */
async function fetchSpotifyTrackCover(spotifyId: string): Promise<string | null> {
  const token = await getSpotifyAppToken();
  if (!token) return null;
  const res = await fetch(`https://api.spotify.com/v1/tracks/${encodeURIComponent(spotifyId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as SpotifySearchTrack;
  return data.album?.images?.[0]?.url ?? null;
}

// ───── YouTube Data v3 ─────────────────────────────────────────────────────

interface YouTubeSearchItem {
  id: { videoId?: string };
  snippet: { title: string; channelTitle: string; publishedAt?: string };
}

async function searchYouTubeVideo(track: SourceTrack): Promise<string | null> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return null;
  const q = `${track.artist} - ${track.title}${track.year ? ` ${track.year}` : ''}`;
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
  if (!res.ok) {
    console.warn(
      `[YouTube] search failed for "${track.artist} - ${track.title}": ${res.status} ${await res.text()}`,
    );
    return null;
  }
  const data = (await res.json()) as { items: YouTubeSearchItem[] };
  let candidates = data.items.filter((it) => Boolean(it.id.videoId));
  candidates = candidates.filter(
    (it) => !containsForbidden(it.snippet.title) && !containsForbidden(it.snippet.channelTitle),
  );

  const artistLower = lower(track.artist);
  const scored = candidates.map((it) => {
    const channel = lower(it.snippet.channelTitle);
    const title = it.snippet.title;
    const titleDist = levenshtein(title, `${track.artist} - ${track.title}`);
    let score = titleDist;
    if (channel.includes('vevo')) score -= 0.4;
    if (channel.includes('official')) score -= 0.25;
    if (channel.includes(artistLower)) score -= 0.2;
    if (channel.endsWith('- topic')) score -= 0.35;
    return { item: it, score };
  });
  scored.sort((a, b) => a.score - b.score);
  const best = scored[0];
  if (!best || !best.item.id.videoId) return null;
  if (best.score > 0.7) {
    console.warn(
      `[YouTube] no good match for "${track.artist} - ${track.title}" (best score=${best.score.toFixed(2)})`,
    );
    return null;
  }
  return best.item.id.videoId;
}

// ───── Upsert DB ───────────────────────────────────────────────────────────

async function upsertPlaylistInDb(
  pl: NormalizedPlaylist,
  resolvedTracks: SourceTrack[],
): Promise<void> {
  const data = {
    name_fr: pl.name_fr,
    name_en: pl.name_en,
    description_fr: pl.description_fr,
    description_en: pl.description_en,
    locale_primary: pl.locale_primary,
    theme: pl.theme,
    difficulty: pl.difficulty,
    visibility: pl.visibility,
    track_count: resolvedTracks.length,
  };
  const playlist = await prisma.officialPlaylist.upsert({
    where: { slug: pl.slug },
    create: { slug: pl.slug, ...data },
    update: data,
  });

  // fix/official-import-canonical — SNAPSHOT avant le delete+recreate destructif :
  // les title_aliases/artist_aliases enrichis (IA/catalog) vivent dans ces
  // colonnes et seraient perdus au réimport. On les indexe par clé canonique
  // (songKey, position-indépendant → survit aux réordonnancements) pour les
  // reporter et NE JAMAIS dégrader un alias IA en heuristique.
  const priorRows = await prisma.officialPlaylistTrack.findMany({
    where: { playlist_id: playlist.id },
    select: {
      title: true,
      artist: true,
      title_aliases: true,
      artist_aliases: true,
      aliases_source: true,
      song_id: true,
    },
  });
  const snapshot = new Map<string, (typeof priorRows)[number]>();
  for (const r of priorRows) {
    const k = songKey(r.artist, r.title);
    if (!snapshot.has(k)) snapshot.set(k, r);
  }

  await prisma.officialPlaylistTrack.deleteMany({ where: { playlist_id: playlist.id } });
  if (resolvedTracks.length === 0) return;

  // Enrichissement par track (concurrence modérée). findOrCreateSong est
  // idempotent (clé normalized_key) → même chanson à chaque réimport, song_id
  // stable. On NE génère PAS d'IA ici (reste au backfill) : socle heuristique.
  const limiter = pLimit(6);
  const rows = await Promise.all(
    resolvedTracks.map((t) =>
      limiter(async () => {
        const key = songKey(t.artist, t.title);
        const prior = snapshot.get(key);

        let songId: string | null = prior?.song_id ?? null;
        let canonTitle: string[] = [];
        let canonArtist: string[] = [];
        try {
          const s = await findOrCreateSong({
            title: t.title,
            artist: t.artist,
            videoId: t.youtube_id ?? null,
          });
          songId = s.songId;
          canonTitle = s.titleAliases;
          canonArtist = s.artistAliases;
        } catch (err) {
          // Non-bloquant : la track reste importée avec un socle heuristique.
          console.error(
            `[OfficialImport] findOrCreateSong ÉCHEC "${t.artist} - ${t.title}" ` +
              `(playlist ${pl.slug}) : ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        // TITRE — priorité anti-dégradation :
        //   prior enrichi (ai/catalog) > canonique > prior autre > heuristique.
        const priorEnriched =
          !!prior &&
          prior.title_aliases.length > 0 &&
          (prior.aliases_source === 'ai' || prior.aliases_source === 'catalog');
        let titleAliases: string[];
        let aliasesSource: string;
        if (priorEnriched) {
          titleAliases = prior!.title_aliases;
          aliasesSource = prior!.aliases_source!;
        } else if (canonTitle.length > 0) {
          titleAliases = canonTitle;
          aliasesSource = 'catalog';
        } else if (prior && prior.title_aliases.length > 0) {
          titleAliases = prior.title_aliases;
          aliasesSource = prior.aliases_source ?? 'heuristic';
        } else {
          titleAliases = generateAliases(t.title, 'title');
          aliasesSource = 'heuristic';
        }

        // ARTISTE — Artist.aliases (canonique, jamais supprimé au réimport) fait
        // autorité ; sinon prior ; sinon socle heuristique.
        const artistAliases =
          canonArtist.length > 0
            ? canonArtist
            : prior && prior.artist_aliases.length > 0
              ? prior.artist_aliases
              : generateAliases(t.artist, 'artist');

        return {
          playlist_id: playlist.id,
          position: t.position,
          title: t.title,
          artist: t.artist,
          year: t.year ?? null,
          difficulty: normalizeDifficulty(t.difficulty ?? pl.difficulty),
          spotify_id: t.spotify_id ?? null,
          youtube_id: t.youtube_id ?? null,
          cover_url: t.cover_url ?? null,
          song_id: songId,
          title_aliases: titleAliases,
          artist_aliases: artistAliases,
          aliases_source: aliasesSource,
          // Prisma JSONB nullable : Prisma.JsonNull pour null explicite.
          answers_accepted: t.answers_accepted
            ? (t.answers_accepted as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        };
      }),
    ),
  );
  await prisma.officialPlaylistTrack.createMany({ data: rows });
}

// ───── Process file ────────────────────────────────────────────────────────

export async function processFile(filePath: string): Promise<FileReport> {
  const filename = basename(filePath);
  const raw = await readFile(filePath, 'utf-8');
  const source = JSON.parse(raw) as SourcePlaylist;
  const slug = source.slug ?? source.id ?? '';
  if (!slug || !Array.isArray(source.tracks)) {
    throw new Error(`${filename}: format invalide (slug/id ou tracks manquant)`);
  }
  const pl = normalizePlaylist(source);

  const report: FileReport = {
    filename,
    slug: pl.slug,
    total: pl.tracks.length,
    spotifyMatched: 0,
    spotifyAlreadyCached: 0,
    spotifyMissed: 0,
    youtubeMatched: 0,
    youtubeAlreadyCached: 0,
    youtubeMissed: 0,
    unmatched: [],
  };

  const resolvedTracks: SourceTrack[] = [];
  for (const track of pl.tracks) {
    const next: SourceTrack = { ...track };

    if (next.spotify_id) {
      report.spotifyAlreadyCached += 1;
      // Backfill cover_url pour les tracks dont spotify_id est cached mais
      // cover_url manque (cas re-import après ajout du champ cover_url).
      if (!next.cover_url) {
        try {
          const cover = await fetchSpotifyTrackCover(next.spotify_id);
          if (cover) next.cover_url = cover;
        } catch (err) {
          console.warn(`[Spotify] cover fetch failed for ${next.spotify_id}:`, err);
        }
      }
    } else {
      try {
        const match = await searchSpotifyTrack(track, pl);
        if (match) {
          next.spotify_id = match.id;
          // Stocke la cover Spotify si dispo (priorité sur fallback YouTube)
          if (match.cover_url && !next.cover_url) {
            next.cover_url = match.cover_url;
          }
          report.spotifyMatched += 1;
        } else {
          report.spotifyMissed += 1;
        }
      } catch (err) {
        console.warn(`[Spotify] error for "${track.artist} - ${track.title}":`, err);
        report.spotifyMissed += 1;
      }
    }

    if (next.youtube_id) {
      report.youtubeAlreadyCached += 1;
    } else {
      try {
        const id = await searchYouTubeVideo(track);
        if (id) {
          next.youtube_id = id;
          report.youtubeMatched += 1;
        } else {
          report.youtubeMissed += 1;
        }
      } catch (err) {
        console.warn(`[YouTube] error for "${track.artist} - ${track.title}":`, err);
        report.youtubeMissed += 1;
      }
    }

    // Fallback cover : si pas de Spotify cover (Spotify miss ou album sans
    // images) mais youtube_id résolu, on prend la thumbnail YouTube hqdefault.
    if (!next.cover_url && next.youtube_id) {
      next.cover_url = `https://img.youtube.com/vi/${next.youtube_id}/hqdefault.jpg`;
    }

    if (!next.spotify_id || !next.youtube_id) {
      report.unmatched.push({
        position: next.position,
        artist: next.artist,
        title: next.title,
        spotify: Boolean(next.spotify_id),
        youtube: Boolean(next.youtube_id),
      });
    }

    resolvedTracks.push(next);
  }

  await upsertPlaylistInDb(pl, resolvedTracks);

  // Réécrit le JSON avec les IDs résolus (cache pour run suivant). Préserve
  // le format exact de l'auteur — on ne change que spotify_id/youtube_id.
  const updatedSource: SourcePlaylist = { ...source, tracks: resolvedTracks };
  await writeFile(filePath, JSON.stringify(updatedSource, null, 2) + '\n', 'utf-8');

  return report;
}

// ───── Orchestration ──────────────────────────────────────────────────────

/** Default playlists dir, relative to backend cwd. */
export const DEFAULT_PLAYLISTS_DIR = join(process.cwd(), 'data', 'official-library', 'playlists');

/** Liste tous les .json playlists d'un dossier. */
export async function listPlaylistFiles(playlistsDir: string): Promise<string[]> {
  return (await readdir(playlistsDir)).filter((f) => f.endsWith('.json'));
}

/** Process tous les .json du dossier. Logs vers console. */
export async function processAllFiles(playlistsDir: string): Promise<ImportResult> {
  const startedAt = Date.now();
  const spotifyAvailable = Boolean(
    process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET,
  );
  const youtubeAvailable = Boolean(process.env.YOUTUBE_API_KEY);

  const files = await listPlaylistFiles(playlistsDir);
  const reports: FileReport[] = [];
  for (const f of files) {
    try {
      const r = await processFile(join(playlistsDir, f));
      reports.push(r);
    } catch (err) {
      console.error(`[FATAL] ${f} a échoué:`, err);
    }
  }

  return {
    files: reports,
    durationMs: Date.now() - startedAt,
    spotifyAvailable,
    youtubeAvailable,
  };
}

/**
 * Re-process un seul fichier identifié par son slug (ou id legacy).
 * Cherche le .json correspondant dans playlistsDir et l'importe.
 */
export async function processOneSlug(playlistsDir: string, slug: string): Promise<FileReport> {
  const files = await listPlaylistFiles(playlistsDir);
  for (const f of files) {
    const filePath = join(playlistsDir, f);
    const raw = await readFile(filePath, 'utf-8');
    const source = JSON.parse(raw) as SourcePlaylist;
    const fileSlug = source.slug ?? source.id ?? '';
    if (fileSlug === slug) {
      return processFile(filePath);
    }
  }
  throw new Error(`Aucun fichier JSON trouvé pour le slug "${slug}"`);
}
