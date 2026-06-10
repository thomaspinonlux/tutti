/**
 * scripts/syncWorkspacePlaylists.ts — feat/enrich-95-playlists-full-run
 *
 * Propage les enrichissements du catalogue (`official_playlists` /
 * `official_playlist_tracks`) vers les copies workspace (`playlists` /
 * `playlist_tracks`) qui ont été clonées AVANT l'enrichissement.
 *
 * Contexte : `enrich:official-playlists` ajoute des tracks au catalogue
 * source, mais les copies workspace (cf. POST /library/playlists/:id/launch)
 * gardent les 15 tracks d'origine. Sans sync, les hosts qui ont déjà cloné
 * une playlist officielle ne voient pas les nouveaux morceaux.
 *
 * Workflow par playlist workspace (is_official_tutti=true) :
 *   1. Match avec official_playlists par name (FR ou EN).
 *   2. Récupère toutes les official_playlist_tracks du catalogue source.
 *   3. Récupère les tracks existantes dans la copie workspace.
 *   4. Pour chaque track catalogue NOT déjà présent (par provider_track_id
 *      ou par slug(artist+title)) :
 *        a. Upsert Artist (canonical_name).
 *        b. Upsert Track (provider='youtube', provider_track_id=youtube_id).
 *        c. INSERT PlaylistTrack avec position incrémentale.
 *   5. UPDATE playlist.default_session_size depuis le catalogue.
 *
 * Usage :
 *   pnpm sync:workspace-playlists                       # tous workspaces
 *   pnpm sync:workspace-playlists --workspace=ID        # un workspace
 *   pnpm sync:workspace-playlists --playlist-slug=slug  # un slug catalogue
 *   pnpm sync:workspace-playlists --dry-run             # preview sans write
 *   pnpm sync:workspace-playlists --no-session-size     # skip default_session_size update
 */

import { PrismaClient } from '@prisma/client';
import pLimit from 'p-limit';
import { config } from 'dotenv';

config();

const prisma = new PrismaClient();

const SYNC_CONCURRENCY = 4;

interface CliArgs {
  workspaceId: string | null;
  playlistSlug: string | null;
  dryRun: boolean;
  syncSessionSize: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const wsArg = args.find((a) => a.startsWith('--workspace='));
  const workspaceId = wsArg ? (wsArg.split('=')[1] ?? null) : null;
  const slugArg = args.find((a) => a.startsWith('--playlist-slug='));
  const playlistSlug = slugArg ? (slugArg.split('=')[1] ?? null) : null;
  const dryRun = args.includes('--dry-run');
  const syncSessionSize = !args.includes('--no-session-size');
  return { workspaceId, playlistSlug, dryRun, syncSessionSize };
}

function lower(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function slugifyKey(artist: string, title: string): string {
  return `${lower(artist).replace(/\s+/g, '')}|${lower(title).replace(/\s+/g, '')}`;
}

interface SyncResult {
  workspacePlaylistId: string;
  workspaceName: string;
  catalogSlug: string | null;
  existingTracks: number;
  catalogTracks: number;
  inserted: number;
  skippedDuplicates: number;
  sessionSizeBefore: number;
  sessionSizeAfter: number;
  error?: string;
}

async function syncOnePlaylist(
  workspacePl: {
    id: string;
    name: string;
    establishment_id: string;
    default_session_size: number;
  },
  dryRun: boolean,
  syncSessionSize: boolean,
): Promise<SyncResult> {
  const base: SyncResult = {
    workspacePlaylistId: workspacePl.id,
    workspaceName: workspacePl.name,
    catalogSlug: null,
    existingTracks: 0,
    catalogTracks: 0,
    inserted: 0,
    skippedDuplicates: 0,
    sessionSizeBefore: workspacePl.default_session_size,
    sessionSizeAfter: workspacePl.default_session_size,
  };

  // 1. Match catalog par name_fr OR name_en. Note : OfficialPlaylist n'a
  //    PAS de default_session_size — c'est un champ workspace uniquement
  //    (default 15 sur création). On ne propage donc pas ce champ.
  const catalog = await prisma.officialPlaylist.findFirst({
    where: { OR: [{ name_fr: workspacePl.name }, { name_en: workspacePl.name }] },
    select: { id: true, slug: true, name_fr: true },
  });
  if (!catalog) {
    base.error = 'no_catalog_match';
    return base;
  }
  base.catalogSlug = catalog.slug;

  // 2. Catalog tracks
  const catalogTracks = await prisma.officialPlaylistTrack.findMany({
    where: { playlist_id: catalog.id },
    select: {
      title: true,
      artist: true,
      year: true,
      youtube_id: true,
      spotify_id: true,
      cover_url: true,
      difficulty: true,
      // fix/catalog-level-aliases — propage les aliases catalogue vers les
      // Track/Artist workspace créés par le sync (symétrie avec le
      // clone-on-launch de library.ts).
      title_aliases: true,
      artist_aliases: true,
    },
    orderBy: { position: 'asc' },
  });
  base.catalogTracks = catalogTracks.length;

  // 3. Existing workspace tracks
  const existing = await prisma.playlistTrack.findMany({
    where: { playlist_id: workspacePl.id },
    select: {
      track: {
        select: {
          canonical_title: true,
          provider_track_id: true,
          artist: { select: { canonical_name: true } },
        },
      },
    },
  });
  base.existingTracks = existing.length;

  const existingProviderIds = new Set(existing.map((e) => e.track.provider_track_id));
  const existingSlugKeys = new Set(
    existing.map((e) => slugifyKey(e.track.artist.canonical_name, e.track.canonical_title)),
  );

  // 4. Diff catalog \ existing
  const toAdd = catalogTracks.filter((c) => {
    const providerId = c.youtube_id ?? c.spotify_id;
    if (providerId && existingProviderIds.has(providerId)) return false;
    if (existingSlugKeys.has(slugifyKey(c.artist, c.title))) return false;
    return true;
  });
  base.skippedDuplicates = catalogTracks.length - toAdd.length;

  if (toAdd.length === 0) {
    return base;
  }

  if (dryRun) {
    console.info(
      `[DRY] "${workspacePl.name}" (ws=${workspacePl.id.slice(0, 8)}) ← ${catalog.slug} | existing=${existing.length} catalog=${catalogTracks.length} → would add ${toAdd.length}, skip ${base.skippedDuplicates} duplicates`,
    );
    return base;
  }

  // 5. Insert tracks
  let nextPosition = existing.length + 1;
  for (const c of toAdd) {
    const providerId = c.youtube_id ?? c.spotify_id;
    if (!providerId) continue;
    const provider = c.youtube_id ? 'youtube' : 'spotify';

    // Upsert Artist — fix/catalog-level-aliases : merge les aliases catalogue
    // dans Artist.aliases (même pattern que le clone-on-launch library.ts).
    const existingArtist = await prisma.artist.findUnique({
      where: { canonical_name: c.artist },
      select: { id: true, aliases: true },
    });
    let artistId: string;
    if (existingArtist) {
      const mergedArtist = Array.from(new Set([...existingArtist.aliases, ...c.artist_aliases]));
      if (mergedArtist.length !== existingArtist.aliases.length) {
        await prisma.artist.update({
          where: { id: existingArtist.id },
          data: { aliases: mergedArtist },
        });
      }
      artistId = existingArtist.id;
    } else {
      const created = await prisma.artist.create({
        data: { canonical_name: c.artist, aliases: c.artist_aliases },
        select: { id: true },
      });
      artistId = created.id;
    }

    // Upsert Track : look up by (provider, provider_track_id).
    // fix/catalog-level-aliases : aliases catalogue copiés au create + mergés
    // si la track existe déjà sans aliases.
    let track = await prisma.track.findFirst({
      where: { provider, provider_track_id: providerId },
      select: { id: true, aliases: true },
    });
    if (!track) {
      track = await prisma.track.create({
        data: {
          artist_id: artistId,
          canonical_title: c.title,
          year: c.year,
          provider,
          provider_track_id: providerId,
          cover_url: c.cover_url,
          aliases: c.title_aliases,
        },
        select: { id: true, aliases: true },
      });
    } else if (c.title_aliases.length > 0) {
      const mergedTitle = Array.from(new Set([...track.aliases, ...c.title_aliases]));
      if (mergedTitle.length !== track.aliases.length) {
        await prisma.track.update({
          where: { id: track.id },
          data: { aliases: mergedTitle },
        });
      }
    }

    // Create PlaylistTrack (unique pair playlist+track on existing DB constraint
    // may apply — skipDuplicates protects).
    await prisma.playlistTrack
      .create({
        data: {
          playlist_id: workspacePl.id,
          track_id: track.id,
          position: nextPosition++,
        },
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('Unique constraint')) throw err;
        base.skippedDuplicates += 1;
      });
    base.inserted += 1;
  }

  // 6. (Removed) default_session_size sync — OfficialPlaylist n'a pas ce
  //    champ. Le workspace garde son default 15.
  void syncSessionSize;

  console.info(
    `[Sync] "${workspacePl.name}" (ws=${workspacePl.id.slice(0, 8)}) ← ${catalog.slug} | ${existing.length} → ${existing.length + base.inserted} (${base.inserted} added, ${base.skippedDuplicates} dup skipped)`,
  );
  return base;
}

async function main(): Promise<void> {
  const { workspaceId, playlistSlug, dryRun, syncSessionSize } = parseArgs();
  console.info(
    `[SyncCLI] start | workspace=${workspaceId ?? 'all'} | catalog-slug=${playlistSlug ?? 'all'} | dry-run=${dryRun} | sync-session-size=${syncSessionSize}`,
  );

  // Sélectionne les workspace playlists is_official_tutti=true.
  // Optionnel : filtre par workspace via establishment.workspace_id.
  const where: Record<string, unknown> = { is_official_tutti: true };
  if (workspaceId) {
    where.establishment = { workspace_id: workspaceId };
  }
  if (playlistSlug) {
    // Filtre indirect : on cherche le catalog playlist par slug puis matche name.
    const catalog = await prisma.officialPlaylist.findUnique({
      where: { slug: playlistSlug },
      select: { name_fr: true, name_en: true },
    });
    if (!catalog) {
      console.error(`[SyncCLI] catalog slug ${playlistSlug} introuvable — abort`);
      process.exitCode = 1;
      return;
    }
    where.name = { in: [catalog.name_fr, catalog.name_en] };
  }

  const workspacePlaylists = await prisma.playlist.findMany({
    where,
    select: {
      id: true,
      name: true,
      establishment_id: true,
      default_session_size: true,
    },
    orderBy: { name: 'asc' },
  });
  if (workspacePlaylists.length === 0) {
    console.error('[SyncCLI] aucune playlist workspace matchée — abort');
    process.exitCode = 1;
    return;
  }
  console.info(`[SyncCLI] processing ${workspacePlaylists.length} workspace playlists`);

  const limit = pLimit(SYNC_CONCURRENCY);
  const results = await Promise.all(
    workspacePlaylists.map((p) => limit(() => syncOnePlaylist(p, dryRun, syncSessionSize))),
  );

  const totalInserted = results.reduce((s, r) => s + r.inserted, 0);
  const totalDups = results.reduce((s, r) => s + r.skippedDuplicates, 0);
  const totalSessionSizeUpdates = results.filter(
    (r) => r.sessionSizeBefore !== r.sessionSizeAfter,
  ).length;
  const noMatch = results.filter((r) => r.error === 'no_catalog_match');
  const errored = results.filter((r) => r.error && r.error !== 'no_catalog_match');

  console.info('\n[SyncCLI] ══════════════ SUMMARY ══════════════');
  console.info(`  Workspace playlists processed   : ${results.length}`);
  console.info(`  Total tracks INSÉRÉS            : ${totalInserted}${dryRun ? ' (DRY-RUN)' : ''}`);
  console.info(`  Total tracks skipped (dup)      : ${totalDups}`);
  console.info(`  default_session_size updated    : ${totalSessionSizeUpdates}`);
  console.info(`  No catalog match (name diff)    : ${noMatch.length}`);
  if (errored.length > 0) {
    console.info(`  Errored playlists               : ${errored.length}`);
    for (const e of errored) {
      console.info(`    - ${e.workspaceName} : ${e.error}`);
    }
  }
  if (noMatch.length > 0) {
    console.info('  Workspaces sans match catalogue :');
    for (const r of noMatch.slice(0, 10)) {
      console.info(`    - "${r.workspaceName}" (ws=${r.workspacePlaylistId.slice(0, 8)})`);
    }
    if (noMatch.length > 10) console.info(`    ... +${noMatch.length - 10} autres`);
  }
  console.info('[SyncCLI] ═════════════════════════════════════');
}

main()
  .catch((err) => {
    console.error('[SyncCLI] fatal :', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
