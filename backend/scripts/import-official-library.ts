/**
 * scripts/import-official-library.ts
 *
 * Importe la bibliothèque officielle Tutti depuis les fichiers JSON sources
 * (backend/data/official-library/playlists/*.json) vers les tables
 * official_playlists + official_playlist_tracks.
 *
 * Pour chaque morceau :
 *   - Si `spotify_id` null  → recherche Spotify Web API (client_credentials)
 *                            avec query `track:"X" artist:"Y" year:YYYY`,
 *                            filtre remix/live/cover/karaoke, prend le meilleur
 *                            match (Levenshtein artiste + titre) dans la
 *                            year_range si import_hints.year_range_strict.
 *   - Si `youtube_id` null → recherche YouTube Data v3 search, priorise les
 *                            chaînes "VEVO" / "Official" / nom artiste, filtre
 *                            remix/live/karaoke dans les titres.
 *
 * Upsert idempotent par slug (relance non-destructrice). Réécrit le JSON source
 * avec les IDs résolus pour cache (pas de réappel API au prochain run).
 *
 * Usage :
 *   pnpm --filter @tutti/backend exec tsx scripts/import-official-library.ts
 *   ou
 *   pnpm --filter @tutti/backend run import:official-library
 *
 * Variables d'env requises :
 *   - DATABASE_URL              (Supabase Postgres pooled)
 *   - DIRECT_URL                (Supabase Postgres direct, pour migrations)
 *   - SPOTIFY_CLIENT_ID         (app credentials, pas user OAuth)
 *   - SPOTIFY_CLIENT_SECRET
 *   - YOUTUBE_API_KEY           (server key Google Cloud, pas OAuth)
 *
 * Si les credentials Spotify/YouTube sont absents, les morceaux concernés sont
 * laissés non-matchés (warning) — l'import continue.
 */

import 'dotenv/config';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// ───── Types JSON source ──────────────────────────────────────────────────

type DifficultyDb = 'EASY' | 'MEDIUM' | 'EXPERT';
type VisibilityDb = 'public' | 'premium_only' | 'private';

/**
 * Format JSON source — flexible pour accepter les 2 conventions :
 *   - convention "id" + difficulty lowercase + year_range_strict [yMin, yMax]
 *     + avoid[] (utilisée par les fichiers curés actuels)
 *   - convention "slug" + difficulty uppercase + year_range_strict boolean
 *     + filter_remix_live_cover_karaoke (legacy template)
 *
 * Les 2 sont normalisés via normalizePlaylist() avant traitement.
 */
interface SourceTrack {
  position: number;
  title: string;
  artist: string;
  year?: number | null;
  difficulty?: string; // "easy" | "medium" | "expert" | "EASY" | "MEDIUM" | "EXPERT"
  spotify_id?: string | null;
  youtube_id?: string | null;
  /** JSONB libre — stocké tel quel en DB (variantes pour reco vocale Whisper). */
  answers_accepted?: Record<string, unknown> | null;
}

interface SourcePlaylist {
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
    /** Boolean legacy — défaut activé. */
    filter_remix_live_cover_karaoke?: boolean;
    /**
     * 2 conventions acceptées :
     *   - boolean : true → utilise year_range_years (default 2)
     *   - [yMin, yMax] : plage explicite, prioritaire
     */
    year_range_strict?: boolean | [number, number];
    year_range_years?: number;
    /** Termes additionnels à filtrer (concat avec FORBIDDEN_TERMS). */
    avoid?: string[];
    /** Préférence éditoriale (informatif, pas utilisé pour le scoring). */
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

// ───── Config + helpers ────────────────────────────────────────────────────

const PLAYLISTS_DIR = join(process.cwd(), 'data', 'official-library', 'playlists');
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

/** Distance de Levenshtein normalisée [0..1], 0 = identique, 1 = totalement différent. */
function levenshtein(a: string, b: string): number {
  const A = lower(a);
  const B = lower(b);
  if (A === B) return 0;
  const m = A.length;
  const n = B.length;
  if (!m) return n ? 1 : 0;
  if (!n) return 1;
  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1, // deletion
        dp[j - 1] + 1, // insertion
        prev + (A[i - 1] === B[j - 1] ? 0 : 1), // substitution
      );
      prev = tmp;
    }
  }
  return dp[n] / Math.max(m, n);
}

// ───── Spotify (client credentials) ────────────────────────────────────────

interface SpotifyToken {
  access_token: string;
  expires_at: number; // ms epoch
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
  album: { name: string; release_date?: string };
  explicit?: boolean;
  is_local?: boolean;
}

async function searchSpotifyTrack(
  track: SourceTrack,
  pl: NormalizedPlaylist,
): Promise<string | null> {
  const token = await getSpotifyAppToken();
  if (!token) return null;

  // Spotify cap : limit max=10 en client_credentials (constaté empiriquement
  // mai 2026 — limit>=20 renvoie 400 "Invalid limit" sur ce flow).
  // Format query : artist + title plain text. Pas de quotes dans les
  // operators (Spotify renvoie 400 avec accents+operators imbriqués).
  // Le ranking compense via Levenshtein post-fetch.
  const cleanArtist = track.artist.replace(/[":]/g, ' ').trim();
  const cleanTitle = track.title.replace(/[":]/g, ' ').trim();
  const baseQ = `${cleanArtist} ${cleanTitle}`;
  // Pass 1 : avec filtre year si strict. Pass 2 fallback : sans year. Spotify
  // utilise souvent la date de l'album/re-release qui peut être hors plage
  // stricte sur les catalogues anciens (italo disco 1980s ressort souvent en
  // 1994/2000+).
  const queries: string[] = [];
  if (track.year && pl.yearStrict) {
    // Plage explicite [yMin, yMax] définie au niveau playlist prioritaire
    // sinon ±yearRange autour de l'année du track.
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
    if (data.tracks.items.length > 0) break; // Pass 1 trouvé → skip Pass 2
  }
  let candidates = allItems.filter((t) => !t.is_local);

  // Filtre remix/live/cover/karaoke + termes additionnels playlist.import_hints.avoid
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

  // Score par distance Levenshtein artiste + titre + bonus année exacte
  const scored = candidates.map((t) => {
    const artistDist = Math.min(...t.artists.map((a) => levenshtein(a.name, track.artist)));
    const titleDist = levenshtein(t.name, track.title);
    let score = artistDist + titleDist;
    const releaseYear = t.album.release_date
      ? parseInt(t.album.release_date.slice(0, 4), 10)
      : null;
    if (track.year && releaseYear) {
      if (releaseYear === track.year)
        score -= 0.15; // bonus année exacte
      else score += Math.min(0.3, Math.abs(releaseYear - track.year) * 0.04);
    }
    return { track: t, score };
  });
  scored.sort((a, b) => a.score - b.score);
  const best = scored[0];
  if (!best) return null;
  // Seuil de qualité : si distance combinée > 0.85, on rejette. Threshold
  // permissif car Spotify renvoie des re-release dates qui pénalisent
  // fortement le score sur les catalogues anciens (italo disco 1980s).
  if (best.score > 0.85) {
    console.warn(
      `[Spotify] no good match for "${track.artist} - ${track.title}" (best score=${best.score.toFixed(2)})`,
    );
    return null;
  }
  return best.track.id;
}

// ───── YouTube Data v3 ─────────────────────────────────────────────────────

interface YouTubeSearchItem {
  id: { videoId?: string };
  snippet: {
    title: string;
    channelTitle: string;
    publishedAt?: string;
  };
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

  // Filtre remix/live/karaoke dans titre + chaîne
  candidates = candidates.filter(
    (it) => !containsForbidden(it.snippet.title) && !containsForbidden(it.snippet.channelTitle),
  );

  // Score : priorise VEVO / Official / Topic / nom artiste dans la chaîne
  const artistLower = lower(track.artist);
  const scored = candidates.map((it) => {
    const channel = lower(it.snippet.channelTitle);
    const title = it.snippet.title;
    const titleDist = levenshtein(title, `${track.artist} - ${track.title}`);
    let score = titleDist;
    if (channel.includes('vevo')) score -= 0.4;
    if (channel.includes('official')) score -= 0.25;
    if (channel.includes(artistLower)) score -= 0.2;
    if (channel.endsWith('- topic')) score -= 0.35; // chaînes auto YouTube Music
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
  // Upsert playlist par slug
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

  // Replace-all stratégie pour les tracks (idempotent et simple).
  // Alternative : upsert par (playlist_id, position) — plus chirurgical mais
  // complique la gestion des suppressions/réordonnancements.
  await prisma.officialPlaylistTrack.deleteMany({ where: { playlist_id: playlist.id } });
  if (resolvedTracks.length > 0) {
    await prisma.officialPlaylistTrack.createMany({
      data: resolvedTracks.map((t) => ({
        playlist_id: playlist.id,
        position: t.position,
        title: t.title,
        artist: t.artist,
        year: t.year ?? null,
        difficulty: normalizeDifficulty(t.difficulty ?? pl.difficulty),
        spotify_id: t.spotify_id ?? null,
        youtube_id: t.youtube_id ?? null,
        answers_accepted: (t.answers_accepted ?? null) as Prisma.InputJsonValue | null,
      })),
    });
  }
}

// ───── Main ────────────────────────────────────────────────────────────────

interface FileReport {
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

async function processFile(filePath: string): Promise<FileReport> {
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

  console.info(`\n[${filename}] processing ${pl.tracks.length} tracks…`);

  const resolvedTracks: SourceTrack[] = [];
  for (const track of pl.tracks) {
    const next: SourceTrack = { ...track };

    // Spotify
    if (next.spotify_id) {
      report.spotifyAlreadyCached += 1;
    } else {
      try {
        const id = await searchSpotifyTrack(track, pl);
        if (id) {
          next.spotify_id = id;
          report.spotifyMatched += 1;
        } else {
          report.spotifyMissed += 1;
        }
      } catch (err) {
        console.warn(`[Spotify] error for "${track.artist} - ${track.title}":`, err);
        report.spotifyMissed += 1;
      }
    }

    // YouTube
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

  // Upsert DB
  await upsertPlaylistInDb(pl, resolvedTracks);

  // Réécrit le JSON avec les IDs résolus (cache pour run suivant). On préserve
  // le format exact de l'auteur (id ou slug, casse difficulty, structure
  // import_hints) — on ne change que les spotify_id/youtube_id résolus.
  const updatedSource: SourcePlaylist = { ...source, tracks: resolvedTracks };
  await writeFile(filePath, JSON.stringify(updatedSource, null, 2) + '\n', 'utf-8');

  return report;
}

async function main(): Promise<void> {
  const startedAt = Date.now();

  // Vérif credentials (warnings only, on continue avec ce qu'on a)
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    console.warn('[WARN] SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET absent → matching Spotify skip');
  }
  if (!process.env.YOUTUBE_API_KEY) {
    console.warn('[WARN] YOUTUBE_API_KEY absent → matching YouTube skip');
  }

  // Liste tous les .json dans playlists/
  let files: string[];
  try {
    files = (await readdir(PLAYLISTS_DIR)).filter((f) => f.endsWith('.json'));
  } catch (err) {
    console.error(`[FATAL] Impossible de lire ${PLAYLISTS_DIR}:`, err);
    process.exit(1);
  }
  if (files.length === 0) {
    console.warn(`[WARN] Aucun fichier JSON dans ${PLAYLISTS_DIR}`);
    return;
  }

  console.info(`[Library] ${files.length} fichier(s) playlists à traiter\n`);

  const reports: FileReport[] = [];
  for (const f of files) {
    try {
      const r = await processFile(join(PLAYLISTS_DIR, f));
      reports.push(r);
    } catch (err) {
      console.error(`[FATAL] ${f} a échoué:`, err);
    }
  }

  // ── Rapport final ────────────────────────────────────────────────────────
  console.info('\n══════════════════════════════════════════════════════════════════════');
  console.info('  RAPPORT FINAL — IMPORT BIBLIOTHÈQUE OFFICIELLE TUTTI');
  console.info('══════════════════════════════════════════════════════════════════════\n');
  let totalTracks = 0;
  let totalSpotMatch = 0;
  let totalSpotCache = 0;
  let totalSpotMiss = 0;
  let totalYtMatch = 0;
  let totalYtCache = 0;
  let totalYtMiss = 0;
  for (const r of reports) {
    totalTracks += r.total;
    totalSpotMatch += r.spotifyMatched;
    totalSpotCache += r.spotifyAlreadyCached;
    totalSpotMiss += r.spotifyMissed;
    totalYtMatch += r.youtubeMatched;
    totalYtCache += r.youtubeAlreadyCached;
    totalYtMiss += r.youtubeMissed;
    console.info(`📁 ${r.filename}  (slug: ${r.slug}, ${r.total} tracks)`);
    console.info(
      `   Spotify : ${r.spotifyMatched} matched, ${r.spotifyAlreadyCached} cached, ${r.spotifyMissed} missed`,
    );
    console.info(
      `   YouTube : ${r.youtubeMatched} matched, ${r.youtubeAlreadyCached} cached, ${r.youtubeMissed} missed`,
    );
    if (r.unmatched.length > 0) {
      console.info(`   ⚠️ Non-matchés (${r.unmatched.length}) :`);
      for (const u of r.unmatched) {
        const tags = [
          u.spotify ? '✅ Spotify' : '❌ Spotify',
          u.youtube ? '✅ YouTube' : '❌ YouTube',
        ].join(' / ');
        console.info(`       #${u.position}  ${u.artist} — ${u.title}    [${tags}]`);
      }
    }
    console.info('');
  }
  console.info('──────────────────────────────────────────────────────────────────────');
  console.info(`  TOTAL  : ${reports.length} playlists, ${totalTracks} tracks`);
  console.info(
    `  Spotify: ${totalSpotMatch} matched cette run, ${totalSpotCache} déjà cachés, ${totalSpotMiss} non-matchés`,
  );
  console.info(
    `  YouTube: ${totalYtMatch} matched cette run, ${totalYtCache} déjà cachés, ${totalYtMiss} non-matchés`,
  );
  console.info(`  Durée : ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  console.info('══════════════════════════════════════════════════════════════════════\n');
}

main()
  .catch((err) => {
    console.error('[FATAL]', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
