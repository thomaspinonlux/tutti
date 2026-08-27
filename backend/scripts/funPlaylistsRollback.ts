/**
 * Rollback de createFunPlaylists.ts : supprime les tracks ajoutés puis les
 * playlists CRÉÉES (pas celles réutilisées). Usage :
 *   pnpm exec tsx scripts/funPlaylistsRollback.ts <fichier-rollback.json>
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: funPlaylistsRollback.ts <rollback.json>');
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(file, 'utf8')) as {
    track_ids: string[];
    created_playlist_ids: string[];
  };
  const prisma = new PrismaClient();
  const delT = await prisma.officialPlaylistTrack.deleteMany({
    where: { id: { in: data.track_ids } },
  });
  console.log(`tracks supprimés : ${delT.count} / ${data.track_ids.length}`);
  if (data.created_playlist_ids?.length) {
    const delP = await prisma.officialPlaylist.deleteMany({
      where: { id: { in: data.created_playlist_ids } },
    });
    console.log(
      `playlists créées supprimées : ${delP.count} / ${data.created_playlist_ids.length}`,
    );
  } else {
    console.log('aucune playlist créée à supprimer (toutes réutilisées)');
  }
  await prisma.$disconnect();
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
