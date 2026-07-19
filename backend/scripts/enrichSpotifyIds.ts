/**
 * scripts/enrichSpotifyIds.ts — feat/spotify-backfill
 *
 * Peuple `spotify_id` (et `cover_url` si absente) sur les tracks du catalogue
 * officiel (`official_playlist_tracks`) en matchant chaque morceau sur l'API
 * Spotify (recherche par artiste + titre, affinée par année).
 *
 * CONTEXTE — Le catalogue officiel a été importé en mode « YouTube-only » :
 * `scripts/import-official-library.ts` force `spotify_id = null` à l'import,
 * donc `spotify_count = 0` sur toutes les playlists → aucune n'est jouable en
 * Spotify. Ce script rebranche le matching Spotify (la logique existait déjà,
 * inutilisée, dans `lib/officialLibraryImport.ts`) pour rendre les playlists
 * « prêtes Spotify ». `spotify_count` est calculé dynamiquement côté requêtes
 * (officialLibraryQueries) = nb de tracks avec spotify_id non-null → dès qu'on
 * peuple spotify_id, les playlists deviennent sélectionnables en Spotify.
 *
 * IDEMPOTENT — par défaut ne touche QUE les tracks sans spotify_id
 * (`--only-missing`, actif par défaut). Re-lançable sans risque.
 *
 * ⚠️ RE-IMPORT — `import:official-library` remet spotify_id à null (pivot
 * YT-only). Après un re-import du catalogue, il faut relancer ce script.
 *
 * ⚠️ LECTURE — avoir spotify_id ≠ jouable pour tout le monde : la lecture
 * Spotify au runtime exige un compte Premium + l'allowlist `spotify_allowlist`.
 * Ce script prépare la DONNÉE ; l'accès lecture reste géré séparément.
 *
 * Usage :
 *   pnpm enrich:spotify-ids                       # tout le catalogue, tracks sans spotify_id
 *   pnpm enrich:spotify-ids --dry-run             # preview, aucun UPDATE
 *   pnpm enrich:spotify-ids --limit=3             # 3 playlists (test)
 *   pnpm enrich:spotify-ids --playlist=official-pl-britpop-90s
 *   pnpm enrich:spotify-ids --all                 # re-matche AUSSI les tracks déjà pourvues
 *   pnpm enrich:spotify-ids --verbose             # log chaque match/miss
 *
 * Env requis : DATABASE_URL, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET.
 */

import { PrismaClient } from '@prisma/client';
import pLimit from 'p-limit';
import { config } from 'dotenv';

config();

const prisma = new PrismaClient();

// ───── Config ────────────────────────────────────────────────────────────────

/** Concurrence des recherches Spotify. Spotify tolère ~10 req/s ; 4 est prudent. */
const SEARCH_CONCURRENCY = 4;
/** Seuil de score au-delà duquel on considère qu'il n'y a pas de bon match.
 *  Identique à lib/officialLibraryImport.ts (searchSpotifyTrack). */
const NO_MATCH_THRESHOLD = 0.85;
/** Pause (ms) après un 429 Spotify avant retry. */
const RATE_LIMIT_BACKOFF_MS = 2_000;

// ───── Args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const hasFlag = (name: string): boolean => args.includes(`--${name}`);
const getOpt = (name: string): string | undefined => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const DRY_RUN = hasFlag('dry-run');
const VERBOSE = hasFlag('verbose');
const MATCH_ALL = hasFlag('all'); // re-matche aussi les tracks déjà pourvues
const PLAYLIST_SLUG = getOpt('playlist');
const LIMIT = getOpt('limit') ? Math.max(1, parseInt(getOpt('limit')!, 10)) : undefined;

// ───── Helpers (mirror lib/officialLibraryImport.ts) ─────────────────────────

function lower(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Distance de Levenshtein normalisée 0..1. */
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

// ───── Spotify app token (client credentials) ────────────────────────────────

let spotifyToken: { access_token: string; expires_at: number } | null = null;

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

// ───── Spotify search + scoring ──────────────────────────────────────────────

interface SpotifySearchTrack {
  id: string;
  name: string;
  artists: Array<{ name: string }>;
  album: {
    name: string;
    release_date?: string;
    images?: Array<{ url: string; width?: number; height?: number }>;
  };
  is_local?: boolean;
}

interface SpotifyMatch {
  id: string;
  cover_url: string | null;
  score: number;
}

async function spotifySearch(q: string): Promise<SpotifySearchTrack[]> {
  const token = await getSpotifyAppToken();
  if (!token) throw new Error('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET manquants');
  const params = new URLSearchParams({ q, type: 'track', limit: '10' });
  const url = `https://api.spotify.com/v1/search?${params.toString()}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After')) || RATE_LIMIT_BACKOFF_MS / 1000;
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(
        `[Spotify] search failed "${q}": ${res.status}${body ? ` ${body.slice(0, 160)}` : ''}`,
      );
      return [];
    }
    const data = (await res.json()) as { tracks?: { items?: SpotifySearchTrack[] } };
    return data.tracks?.items ?? [];
  }
  return [];
}

/**
 * Cherche le meilleur match Spotify pour (artiste, titre, année). Même scoring
 * que lib/officialLibraryImport.ts : distance artiste+titre, bonus/malus année.
 */
async function matchSpotify(
  artist: string,
  title: string,
  year: number | null,
): Promise<SpotifyMatch | null> {
  const cleanArtist = artist.replace(/[":]/g, ' ').trim();
  const cleanTitle = title.replace(/[":]/g, ' ').trim();
  const baseQ = `${cleanArtist} ${cleanTitle}`;
  const queries = year ? [`${baseQ} year:${year - 1}-${year + 1}`, baseQ] : [baseQ];

  let items: SpotifySearchTrack[] = [];
  for (const q of queries) {
    const found = await spotifySearch(q);
    items = items.concat(found);
    if (found.length > 0) break;
  }
  const candidates = items.filter((t) => !t.is_local);
  if (candidates.length === 0) return null;

  const scored = candidates.map((t) => {
    const artistDist = Math.min(...t.artists.map((a) => levenshtein(a.name, artist)));
    const titleDist = levenshtein(t.name, title);
    let score = artistDist + titleDist;
    const releaseYear = t.album.release_date
      ? parseInt(t.album.release_date.slice(0, 4), 10)
      : null;
    if (year && releaseYear) {
      if (releaseYear === year) score -= 0.15;
      else score += Math.min(0.3, Math.abs(releaseYear - year) * 0.04);
    }
    return { track: t, score };
  });
  scored.sort((a, b) => a.score - b.score);
  const best = scored[0];
  if (!best || best.score > NO_MATCH_THRESHOLD) return null;
  return {
    id: best.track.id,
    cover_url: best.track.album.images?.[0]?.url ?? null,
    score: best.score,
  };
}

// ───── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    console.error('❌ SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET manquants dans l’env.');
    process.exit(1);
  }

  const playlists = await prisma.officialPlaylist.findMany({
    where: PLAYLIST_SLUG ? { slug: PLAYLIST_SLUG } : undefined,
    orderBy: { slug: 'asc' },
    ...(LIMIT ? { take: LIMIT } : {}),
    select: { id: true, slug: true, name_fr: true },
  });

  if (playlists.length === 0) {
    console.error(
      `❌ Aucune playlist officielle trouvée${PLAYLIST_SLUG ? ` (slug=${PLAYLIST_SLUG})` : ''}.`,
    );
    process.exit(1);
  }

  console.info(
    `\n🎧 Backfill Spotify — ${playlists.length} playlist(s)${DRY_RUN ? ' [DRY-RUN]' : ''}` +
      `${MATCH_ALL ? ' [--all: re-matche tout]' : ' [tracks sans spotify_id]'}\n`,
  );

  const limiter = pLimit(SEARCH_CONCURRENCY);
  let totalTracks = 0;
  let totalMatched = 0;
  let totalMiss = 0;
  let totalSkipped = 0;
  let totalUpdated = 0;

  for (const pl of playlists) {
    const tracks = await prisma.officialPlaylistTrack.findMany({
      where: {
        playlist_id: pl.id,
        ...(MATCH_ALL ? {} : { spotify_id: null }),
      },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        title: true,
        artist: true,
        year: true,
        spotify_id: true,
        cover_url: true,
      },
    });

    if (tracks.length === 0) {
      if (VERBOSE) console.info(`  ▸ ${pl.slug} — rien à faire`);
      continue;
    }

    let matched = 0;
    let miss = 0;
    let updated = 0;

    await Promise.all(
      tracks.map((tr) =>
        limiter(async () => {
          totalTracks += 1;
          let match: SpotifyMatch | null = null;
          try {
            match = await matchSpotify(tr.artist, tr.title, tr.year);
          } catch (err) {
            console.warn(
              `  [!] erreur match "${tr.artist} - ${tr.title}":`,
              (err as Error).message,
            );
          }
          if (!match) {
            miss += 1;
            totalMiss += 1;
            if (VERBOSE) console.info(`    ✗ ${tr.artist} — ${tr.title}`);
            return;
          }
          matched += 1;
          totalMatched += 1;
          if (VERBOSE) {
            console.info(
              `    ✓ ${tr.artist} — ${tr.title}  →  ${match.id} (score ${match.score.toFixed(2)})`,
            );
          }
          if (DRY_RUN) {
            totalSkipped += 1;
            return;
          }
          await prisma.officialPlaylistTrack.update({
            where: { id: tr.id },
            data: {
              spotify_id: match.id,
              // Ne remplace la cover que si absente (préserve les covers déjà en place).
              ...(tr.cover_url ? {} : match.cover_url ? { cover_url: match.cover_url } : {}),
            },
          });
          updated += 1;
          totalUpdated += 1;
        }),
      ),
    );

    const rate = tracks.length > 0 ? Math.round((matched / tracks.length) * 100) : 0;
    console.info(
      `  ▸ ${pl.slug.padEnd(40)} ${matched}/${tracks.length} matchés (${rate}%)` +
        `${DRY_RUN ? '' : ` · ${updated} MAJ`}${miss ? ` · ${miss} sans match` : ''}`,
    );
  }

  console.info(
    `\n═══ Bilan ═══\n` +
      `  Tracks traitées : ${totalTracks}\n` +
      `  Matchés         : ${totalMatched}` +
      `${totalTracks ? ` (${Math.round((totalMatched / totalTracks) * 100)}%)` : ''}\n` +
      `  Sans match      : ${totalMiss}\n` +
      (DRY_RUN
        ? `  [DRY-RUN] aucune écriture (${totalSkipped} auraient été mises à jour)\n`
        : `  Mises à jour DB : ${totalUpdated}\n`),
  );
}

main()
  .catch((err) => {
    console.error('❌ enrichSpotifyIds a échoué :', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
