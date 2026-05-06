/**
 * scripts/import-official-library.ts
 *
 * CLI thin wrapper sur src/lib/officialLibraryImport.ts. La logique d'import
 * (Spotify search, YouTube search, upsert, JSON cache) vit dans la lib pour
 * être partagée avec les routes admin /api/admin/library/*.
 *
 * Usage :
 *   pnpm --filter @tutti/backend run import:official-library
 *
 * Variables d'env requises :
 *   - DATABASE_URL              (Supabase Postgres pooled)
 *   - DIRECT_URL                (Supabase Postgres direct, pour migrations)
 *   - SPOTIFY_CLIENT_ID         (app credentials, pas user OAuth)
 *   - SPOTIFY_CLIENT_SECRET
 *   - YOUTUBE_API_KEY           (server key Google Cloud, pas OAuth)
 *
 * Lit aussi credentials.env.local à la racine du repo en plus de backend/.env.
 */

import 'dotenv/config';
import * as dotenv from 'dotenv';
import { join } from 'node:path';
import { prisma } from '../src/lib/prisma.js';
import {
  DEFAULT_PLAYLISTS_DIR,
  processAllFiles,
  type FileReport,
} from '../src/lib/officialLibraryImport.js';

dotenv.config({
  path: join(process.cwd(), '..', 'credentials.env.local'),
  override: false,
});

function printReport(reports: FileReport[], durationMs: number): void {
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
  console.info(`  Durée : ${(durationMs / 1000).toFixed(1)}s`);
  console.info('══════════════════════════════════════════════════════════════════════\n');
}

async function main(): Promise<void> {
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    console.warn('[WARN] SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET absent → matching Spotify skip');
  }
  if (!process.env.YOUTUBE_API_KEY) {
    console.warn('[WARN] YOUTUBE_API_KEY absent → matching YouTube skip');
  }
  console.info(`[Library] Lecture des playlists dans ${DEFAULT_PLAYLISTS_DIR}\n`);
  const result = await processAllFiles(DEFAULT_PLAYLISTS_DIR);
  printReport(result.files, result.durationMs);
}

main()
  .catch((err) => {
    console.error('[FATAL]', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
