/** P1 scope + Bailamos dry-resolve. Read-only. */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';
import { resolveStrict } from './_p1lib.js';

async function main(): Promise<void> {
  const withYt = await prisma.officialPlaylistTrack.count({ where: { youtube_id: { not: null } } });
  const distinct = await prisma.officialPlaylistTrack.findMany({
    where: { youtube_id: { not: null } },
    distinct: ['youtube_id'],
    select: { youtube_id: true },
  });
  console.log(`Tracks with youtube_id: ${withYt}`);
  console.log(`Distinct youtube_id: ${distinct.length}`);

  console.log('\nDry-resolve "Enrique Iglesias" / "Bailamos":');
  const c = await resolveStrict('Enrique Iglesias', 'Bailamos');
  console.log(c ? `  → ${c.id} | ${c.title} | ${c.channel}` : '  → no valid candidate');

  await prisma.$disconnect();
}
void main();
