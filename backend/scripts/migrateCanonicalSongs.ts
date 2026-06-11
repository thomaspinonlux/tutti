/**
 * scripts/migrateCanonicalSongs.ts — feat/canonical-song-catalog (ÉTAPE 5)
 *
 * Dédoublonne le catalogue existant en chansons canoniques :
 *   1. Scanne official_playlist_tracks + tracks (workspace), groupe par
 *      songKey(artist, title) — fusionne les entrées qui sont la même chanson
 *      sous des videoIds différents.
 *   2. Crée une Song par clé, UNION des title_aliases de toutes les variantes.
 *      Artist : réutilise la table artists (upsert canonical_name), merge des
 *      artist_aliases catalogue dans Artist.aliases.
 *   3. Backfill song_id sur official_playlist_tracks ET tracks.
 *
 * Idempotent : upsert par normalized_key, set song_id même si déjà set
 * (recalcul stable), aliases en union (jamais de perte).
 *
 * Usage :
 *   pnpm migrate:canonical-songs            # full run
 *   pnpm migrate:canonical-songs --dry-run  # stats sans write
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { songKey } from '../src/lib/songCatalog.js';

config();
const prisma = new PrismaClient();

const dryRun = process.argv.includes('--dry-run');

interface Bucket {
  key: string;
  /** Variante retenue comme canonique (la plus fréquente / la première). */
  title: string;
  artist: string;
  titleAliases: Set<string>;
  artistAliases: Set<string>;
  catalogIds: string[];
  workspaceTrackIds: string[];
  videoIds: Set<string>;
}

async function main(): Promise<void> {
  console.info(`[MigrateSongs] start | dry-run=${dryRun}`);

  const catalogRows = await prisma.officialPlaylistTrack.findMany({
    select: {
      id: true,
      title: true,
      artist: true,
      youtube_id: true,
      title_aliases: true,
      artist_aliases: true,
    },
  });
  const wsRows = await prisma.track.findMany({
    where: { provider: 'youtube' },
    select: {
      id: true,
      canonical_title: true,
      provider_track_id: true,
      aliases: true,
      artist: { select: { canonical_name: true, aliases: true } },
    },
  });
  console.info(
    `[MigrateSongs] ${catalogRows.length} rows catalogue + ${wsRows.length} rows workspace`,
  );

  // ── Groupement par clé canonique ────────────────────────────────────────
  const buckets = new Map<string, Bucket>();

  const getBucket = (key: string, title: string, artist: string): Bucket => {
    let b = buckets.get(key);
    if (!b) {
      b = {
        key,
        title,
        artist,
        titleAliases: new Set(),
        artistAliases: new Set(),
        catalogIds: [],
        workspaceTrackIds: [],
        videoIds: new Set(),
      };
      buckets.set(key, b);
    }
    return b;
  };

  for (const r of catalogRows) {
    const key = songKey(r.artist, r.title);
    const b = getBucket(key, r.title, r.artist);
    b.catalogIds.push(r.id);
    if (r.youtube_id) b.videoIds.add(r.youtube_id);
    r.title_aliases.forEach((a) => b.titleAliases.add(a));
    r.artist_aliases.forEach((a) => b.artistAliases.add(a));
  }
  for (const r of wsRows) {
    const key = songKey(r.artist.canonical_name, r.canonical_title);
    const b = getBucket(key, r.canonical_title, r.artist.canonical_name);
    b.workspaceTrackIds.push(r.id);
    b.videoIds.add(r.provider_track_id);
    r.aliases.forEach((a) => b.titleAliases.add(a));
    r.artist.aliases.forEach((a) => b.artistAliases.add(a));
  }

  const multiVideo = [...buckets.values()].filter((b) => b.videoIds.size > 1).length;
  console.info(
    `[MigrateSongs] ${buckets.size} chansons canoniques distinctes | ${multiVideo} avec plusieurs videoIds (fusionnées)`,
  );

  if (dryRun) {
    console.info('[MigrateSongs] DRY-RUN — aucun write. Sample fusions multi-videoId :');
    [...buckets.values()]
      .filter((b) => b.videoIds.size > 1)
      .slice(0, 5)
      .forEach((b) =>
        console.info(
          `  - "${b.artist} — ${b.title}" : ${b.videoIds.size} videoIds, ${b.titleAliases.size} aliases fusionnés`,
        ),
      );
    return;
  }

  // ── Upsert songs + backfill pointeurs ───────────────────────────────────
  let created = 0;
  let updated = 0;
  let catalogLinked = 0;
  let wsLinked = 0;

  for (const b of buckets.values()) {
    // Artist : upsert + merge artist aliases (P2002-safe).
    let artist: { id: string; aliases: string[] };
    try {
      artist = await prisma.artist.upsert({
        where: { canonical_name: b.artist },
        create: { canonical_name: b.artist, aliases: [...b.artistAliases] },
        update: {},
        select: { id: true, aliases: true },
      });
    } catch (err) {
      if ((err as { code?: string })?.code !== 'P2002') throw err;
      const found = await prisma.artist.findUnique({
        where: { canonical_name: b.artist },
        select: { id: true, aliases: true },
      });
      if (!found) throw err;
      artist = found;
    }
    const mergedArtistAliases = Array.from(new Set([...artist.aliases, ...b.artistAliases]));
    if (mergedArtistAliases.length !== artist.aliases.length) {
      await prisma.artist.update({
        where: { id: artist.id },
        data: { aliases: mergedArtistAliases },
      });
    }

    // Song : upsert par normalized_key, union des aliases.
    const existing = await prisma.song.findUnique({
      where: { normalized_key: b.key },
      select: { id: true, title_aliases: true },
    });
    let songId: string;
    if (existing) {
      const merged = Array.from(new Set([...existing.title_aliases, ...b.titleAliases]));
      if (merged.length !== existing.title_aliases.length) {
        await prisma.song.update({
          where: { id: existing.id },
          data: { title_aliases: merged },
        });
      }
      songId = existing.id;
      updated += 1;
    } else {
      const song = await prisma.song.create({
        data: {
          artist_id: artist.id,
          canonical_title: b.title,
          normalized_key: b.key,
          title_aliases: [...b.titleAliases],
          aliases_source: b.titleAliases.size > 0 ? 'ai' : null,
        },
        select: { id: true },
      });
      songId = song.id;
      created += 1;
    }

    // Backfill pointeurs.
    if (b.catalogIds.length > 0) {
      const r = await prisma.officialPlaylistTrack.updateMany({
        where: { id: { in: b.catalogIds } },
        data: { song_id: songId },
      });
      catalogLinked += r.count;
    }
    if (b.workspaceTrackIds.length > 0) {
      const r = await prisma.track.updateMany({
        where: { id: { in: b.workspaceTrackIds } },
        data: { song_id: songId },
      });
      wsLinked += r.count;
    }
  }

  console.info('\n[MigrateSongs] ═══════════ SUMMARY ═══════════');
  console.info(`  Songs créées            : ${created}`);
  console.info(`  Songs déjà existantes   : ${updated}`);
  console.info(`  Catalog rows liées      : ${catalogLinked}`);
  console.info(`  Workspace tracks liées  : ${wsLinked}`);
  console.info('[MigrateSongs] ════════════════════════════════');
}

main()
  .catch((err) => {
    console.error('[MigrateSongs] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
