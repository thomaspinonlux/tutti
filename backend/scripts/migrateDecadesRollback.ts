/**
 * Undo de migrateDecadesToThematic.ts.
 *   - restaure visibility des slugs masqués (hidden_slugs → prev_visibility)
 *   - supprime les OfficialPlaylistTrack créés (track_ids)
 *   - supprime les playlists thématiques créées (created_playlist_ids)
 *
 * Usage : tsx scripts/migrateDecadesRollback.ts <rollback.json>
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';

const prisma = new PrismaClient();
const path = process.argv[2];
if (!path) {
  console.error('usage: tsx scripts/migrateDecadesRollback.ts <rollback.json>');
  process.exit(1);
}

interface Rollback {
  created_playlist_ids: string[];
  track_ids: string[];
  hidden_slugs: Array<{ slug: string; id: string; prev_visibility: string }>;
}

async function main(): Promise<void> {
  const rb = JSON.parse(readFileSync(path, 'utf8')) as Rollback;
  console.log(
    `[undo] restore ${rb.hidden_slugs.length} slugs · delete ${rb.track_ids.length} tracks · ${rb.created_playlist_ids.length} playlists`,
  );

  for (const h of rb.hidden_slugs) {
    await prisma.officialPlaylist
      .update({ where: { id: h.id }, data: { visibility: h.prev_visibility as never } })
      .catch((e) => console.warn(`  restore ${h.slug} fail:`, e));
  }
  // Les tracks des playlists créées partent en cascade au delete playlist, mais
  // on supprime explicitement par sûreté (idempotent).
  await prisma.officialPlaylistTrack.deleteMany({ where: { id: { in: rb.track_ids } } });
  await prisma.officialPlaylist.deleteMany({ where: { id: { in: rb.created_playlist_ids } } });
  console.log('[undo] done');
}

main()
  .catch((e) => {
    console.error('[undo] fatal:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
