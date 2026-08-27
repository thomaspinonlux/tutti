/**
 * Rollback de spotifyWriteIds : remet spotify_id = NULL sur EXACTEMENT les ids
 * écrits (lus depuis le fichier rollback JSON). 1 seule requête updateMany.
 * Usage : pnpm exec tsx scripts/spotifyWriteRollback.ts <fichier-rollback.json>
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: tsx scripts/spotifyWriteRollback.ts <fichier-rollback.json>');
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(file, 'utf8')) as { ids: string[] };
  const ids = data.ids ?? [];
  console.log(`rollback : ${ids.length} ids → spotify_id = NULL`);
  const prisma = new PrismaClient();
  const res = await prisma.officialPlaylistTrack.updateMany({
    where: { id: { in: ids } },
    data: { spotify_id: null },
  });
  console.log(`✅ ${res.count} lignes remises à NULL`);
  await prisma.$disconnect();
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
