/** P1 — fix the wrong Bailamos mapping (Ricky Martin María → Enrique Iglesias Bailamos).
 *  Re-resolves strictly, validates, replaces. Writes a rollback JSON. */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { prisma } from '../src/lib/prisma.js';
import { resolveStrict, artistMatches } from './_p1lib.js';

const DRY = process.env.APPLY !== '1';

async function main(): Promise<void> {
  // Cible : les tracks Bailamos dont l'artiste catalogue est Enrique Iglesias mais
  // dont le youtube_id ne correspond pas (ex: vCEvCXuglqo = Ricky Martin María).
  const tracks = await prisma.officialPlaylistTrack.findMany({
    where: {
      title: { contains: 'bailamos', mode: 'insensitive' },
      artist: { contains: 'Enrique' },
    },
    select: {
      id: true,
      title: true,
      artist: true,
      youtube_id: true,
      playlist: { select: { name_fr: true } },
    },
  });

  const resolved = await resolveStrict('Enrique Iglesias', 'Bailamos');
  if (!resolved) {
    console.log('No valid candidate — abort.');
    await prisma.$disconnect();
    return;
  }
  console.log(`Resolved → ${resolved.id} | ${resolved.title} | ${resolved.channel}`);
  if (!artistMatches('Enrique Iglesias', resolved.title, resolved.channel)) {
    console.log('Validation failed (artist not in title) — abort.');
    await prisma.$disconnect();
    return;
  }

  const toFix = tracks.filter((t) => t.youtube_id !== resolved.id);
  console.log(`\n${tracks.length} Bailamos track(s); ${toFix.length} need update:`);
  for (const t of toFix) {
    console.log(`  [${t.playlist.name_fr}] ${t.youtube_id} → ${resolved.id}`);
  }

  if (DRY) {
    console.log('\nDRY RUN (set APPLY=1 to write).');
    await prisma.$disconnect();
    return;
  }

  const rollback = toFix.map((t) => ({ id: t.id, from: t.youtube_id, to: resolved.id }));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `../p1-bailamos-rollback-${stamp}.json`;
  writeFileSync(path, JSON.stringify(rollback, null, 2));
  for (const t of toFix) {
    await prisma.officialPlaylistTrack.update({
      where: { id: t.id },
      data: {
        youtube_id: resolved.id,
        is_playable: true,
        playability_reason: null,
        playability_checked_at: null, // force re-validation en P2
      },
    });
  }
  console.log(`\nApplied ${toFix.length} update(s). Rollback → p1-bailamos-rollback-${stamp}.json`);
  await prisma.$disconnect();
}
void main();
