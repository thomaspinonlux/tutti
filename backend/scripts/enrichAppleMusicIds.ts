/**
 * scripts/enrichAppleMusicIds.ts — feat/apple-music (étape 2)
 *
 * Peuple `apple_music_id` sur les tracks du catalogue officiel
 * (`official_playlist_tracks`) en matchant chaque morceau sur l'Apple Music API
 * (recherche catalogue storefront FR par artiste+titre, affinée par année).
 *
 * Miroir de `enrichSpotifyIds.ts` (même scoring Levenshtein normalisé).
 *
 * IDEMPOTENT — par défaut ne touche QUE les tracks sans apple_music_id.
 * ROLLBACK — chaque run (non dry) écrit un JSON des valeurs AVANT écriture ;
 * `--rollback=<fichier>` restaure ces valeurs.
 *
 * Usage :
 *   pnpm enrich:apple-music-ids                     # tracks sans apple_music_id
 *   pnpm enrich:apple-music-ids --dry-run           # preview, aucun UPDATE
 *   pnpm enrich:apple-music-ids --all               # re-matche AUSSI les pourvues
 *   pnpm enrich:apple-music-ids --playlist=official-pl-britpop-90s
 *   pnpm enrich:apple-music-ids --limit=3           # 3 playlists (test)
 *   pnpm enrich:apple-music-ids --verbose
 *   pnpm enrich:apple-music-ids --rollback-out=./rb.json   # chemin du rollback
 *   pnpm enrich:apple-music-ids --rollback=./rb.json       # RESTAURE puis exit
 *
 * Env requis : DATABASE_URL, APPLE_TEAM_ID, APPLE_MUSIC_KEY_ID,
 *              APPLE_MUSIC_PRIVATE_KEY.
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import pLimit from 'p-limit';
import { config } from 'dotenv';
import { getAppleDeveloperToken, isAppleMusicConfigured } from '../src/lib/appleDeveloperToken.js';

config();

const prisma = new PrismaClient();

const STOREFRONT = 'fr';
const SEARCH_CONCURRENCY = 4;
const NO_MATCH_THRESHOLD = 0.85; // identique à enrichSpotifyIds
const RATE_LIMIT_BACKOFF_MS = 2_000;

// ───── Args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const hasFlag = (n: string): boolean => args.includes(`--${n}`);
const getOpt = (n: string): string | undefined => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : undefined;
};

const DRY_RUN = hasFlag('dry-run');
const VERBOSE = hasFlag('verbose');
const MATCH_ALL = hasFlag('all');
const PLAYLIST_SLUG = getOpt('playlist');
const LIMIT = getOpt('limit') ? Math.max(1, Number.parseInt(getOpt('limit')!, 10)) : undefined;
const ROLLBACK_IN = getOpt('rollback');
const ROLLBACK_OUT = getOpt('rollback-out') ?? `apple-music-rollback-${nowStamp()}.json`;

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// ───── Helpers (mirror enrichSpotifyIds) ──────────────────────────────────────
function lower(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
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

// ───── Apple Music search + scoring ───────────────────────────────────────────
interface AppleSong {
  id: string;
  attributes?: { name?: string; artistName?: string; releaseDate?: string };
}
interface AppleMatch {
  id: string;
  score: number;
}

async function appleSearch(term: string): Promise<AppleSong[]> {
  const params = new URLSearchParams({ term, types: 'songs', limit: '10' });
  const url = `https://api.music.apple.com/v1/catalog/${STOREFRONT}/search?${params.toString()}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${getAppleDeveloperToken().token}` },
    });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After')) || RATE_LIMIT_BACKOFF_MS / 1000;
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(
        `[Apple] search "${term}": ${res.status}${body ? ` ${body.slice(0, 160)}` : ''}`,
      );
      return [];
    }
    const data = (await res.json()) as { results?: { songs?: { data?: AppleSong[] } } };
    return data.results?.songs?.data ?? [];
  }
  return [];
}

async function matchApple(
  artist: string,
  title: string,
  year: number | null,
): Promise<AppleMatch | null> {
  const cleanArtist = artist.replace(/[":]/g, ' ').trim();
  const cleanTitle = title.replace(/[":]/g, ' ').trim();
  const items = await appleSearch(`${cleanArtist} ${cleanTitle}`);
  if (items.length === 0) return null;

  const scored = items.map((t) => {
    const artistDist = levenshtein(t.attributes?.artistName ?? '', artist);
    const titleDist = levenshtein(t.attributes?.name ?? '', title);
    let score = artistDist + titleDist;
    const releaseYear = t.attributes?.releaseDate
      ? Number.parseInt(t.attributes.releaseDate.slice(0, 4), 10)
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
  return { id: best.track.id, score: best.score };
}

// ───── Rollback mode ──────────────────────────────────────────────────────────
interface RollbackEntry {
  id: string;
  apple_music_id: string | null;
}

async function runRollback(file: string): Promise<void> {
  const entries = JSON.parse(readFileSync(file, 'utf8')) as RollbackEntry[];
  console.info(`\n↩️  Rollback Apple Music — ${entries.length} track(s) depuis ${file}\n`);
  let restored = 0;
  for (const e of entries) {
    await prisma.officialPlaylistTrack.update({
      where: { id: e.id },
      data: { apple_music_id: e.apple_music_id },
    });
    restored += 1;
  }
  console.info(`✓ ${restored} track(s) restaurée(s).`);
}

// ───── Main ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  if (ROLLBACK_IN) {
    await runRollback(ROLLBACK_IN);
    return;
  }

  if (!isAppleMusicConfigured()) {
    console.error('❌ APPLE_TEAM_ID / APPLE_MUSIC_KEY_ID / APPLE_MUSIC_PRIVATE_KEY manquants.');
    process.exit(1);
  }
  // Sanity : le mint du token doit réussir avant de lancer les requêtes.
  try {
    getAppleDeveloperToken();
  } catch (err) {
    console.error('❌ Impossible de générer le developer token Apple :', (err as Error).message);
    process.exit(1);
  }

  const playlists = await prisma.officialPlaylist.findMany({
    where: PLAYLIST_SLUG ? { slug: PLAYLIST_SLUG } : undefined,
    orderBy: { slug: 'asc' },
    ...(LIMIT ? { take: LIMIT } : {}),
    select: { id: true, slug: true },
  });
  if (playlists.length === 0) {
    console.error(
      `❌ Aucune playlist officielle${PLAYLIST_SLUG ? ` (slug=${PLAYLIST_SLUG})` : ''}.`,
    );
    process.exit(1);
  }

  console.info(
    `\n🍎 Backfill Apple Music — ${playlists.length} playlist(s)${DRY_RUN ? ' [DRY-RUN]' : ''}` +
      `${MATCH_ALL ? ' [--all]' : ' [tracks sans apple_music_id]'}\n`,
  );

  const limiter = pLimit(SEARCH_CONCURRENCY);
  const rollback: RollbackEntry[] = [];
  let totalTracks = 0;
  let totalMatched = 0;
  let totalMiss = 0;
  let totalUpdated = 0;

  for (const pl of playlists) {
    const tracks = await prisma.officialPlaylistTrack.findMany({
      where: { playlist_id: pl.id, ...(MATCH_ALL ? {} : { apple_music_id: null }) },
      orderBy: { position: 'asc' },
      select: { id: true, title: true, artist: true, year: true, apple_music_id: true },
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
          let match: AppleMatch | null = null;
          try {
            match = await matchApple(tr.artist, tr.title, tr.year);
          } catch (err) {
            console.warn(`  [!] "${tr.artist} - ${tr.title}":`, (err as Error).message);
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
          if (DRY_RUN) return;
          rollback.push({ id: tr.id, apple_music_id: tr.apple_music_id });
          await prisma.officialPlaylistTrack.update({
            where: { id: tr.id },
            data: { apple_music_id: match.id },
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

  if (!DRY_RUN && rollback.length > 0) {
    writeFileSync(ROLLBACK_OUT, JSON.stringify(rollback, null, 2), 'utf8');
    console.info(`\n💾 Rollback écrit : ${ROLLBACK_OUT} (${rollback.length} entrées)`);
  }

  console.info(
    `\n═══ Bilan ═══\n` +
      `  Tracks traitées : ${totalTracks}\n` +
      `  Matchés         : ${totalMatched}` +
      `${totalTracks ? ` (${Math.round((totalMatched / totalTracks) * 100)}%)` : ''}\n` +
      `  Sans match      : ${totalMiss}\n` +
      (DRY_RUN ? `  [DRY-RUN] aucune écriture\n` : `  Mises à jour DB : ${totalUpdated}\n`),
  );
}

main()
  .catch((err) => {
    console.error('❌ enrichAppleMusicIds a échoué :', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
