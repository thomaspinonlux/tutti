/**
 * Rollback de addEasyTracks.ts : supprime EXACTEMENT les track ids loggés dans
 * le fichier rollback, puis recalcule track_count sur les playlists touchées.
 * Usage : pnpm exec tsx scripts/addEasyTracksRollback.ts <fichier-rollback.json>
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: addEasyTracksRollback.ts <rollback.json>');
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(file, 'utf8')) as {
    track_ids: string[];
    touched_playlist_ids: string[];
  };
  const prisma = new PrismaClient();
  const del = await prisma.officialPlaylistTrack.deleteMany({
    where: { id: { in: data.track_ids } },
  });
  console.log(`supprimés : ${del.count} / ${data.track_ids.length} attendus`);
  for (const plId of data.touched_playlist_ids ?? []) {
    const n = await prisma.officialPlaylistTrack.count({ where: { playlist_id: plId } });
    await prisma.officialPlaylist.update({ where: { id: plId }, data: { track_count: n } });
  }
  console.log(`track_count recalculé sur ${(data.touched_playlist_ids ?? []).length} playlists`);
  await prisma.$disconnect();
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
