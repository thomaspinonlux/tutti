/**
 * Backfill — regénère les aliases de tous les Artist existants en utilisant
 * la nouvelle logique generateAliases(name, 'artist') qui ajoute :
 *   - dernier mot du nom (nom de famille pour solo)
 *   - premier mot du nom (prénom pour solo)
 *
 * Idempotent : on merge les nouveaux aliases avec les existants (Set), pas
 * d'écrasement. Les aliases ajoutés manuellement par l'utilisateur sont
 * préservés.
 *
 * Usage local :
 *   pnpm --filter @tutti/backend exec tsx scripts/backfill-artist-aliases.ts
 *
 * Usage prod (Railway shell) :
 *   railway run pnpm --filter @tutti/backend exec tsx scripts/backfill-artist-aliases.ts
 */

import { prisma } from '../src/lib/prisma.js';
import { generateAliases } from '../src/lib/aliases.js';

async function main(): Promise<void> {
  const artists = await prisma.artist.findMany({
    select: { id: true, canonical_name: true, aliases: true },
  });
  console.info(`[backfill] ${artists.length} artists trouvés`);

  let updated = 0;
  for (const a of artists) {
    const generated = generateAliases(a.canonical_name, 'artist');
    const merged = [...new Set([...a.aliases, ...generated])];
    if (merged.length === a.aliases.length) continue; // pas de nouveau
    await prisma.artist.update({
      where: { id: a.id },
      data: { aliases: merged },
    });
    updated++;
    console.info(`[backfill] ${a.canonical_name}: ${a.aliases.length} → ${merged.length} aliases`);
  }
  console.info(`[backfill] Done. ${updated} artists updated.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[backfill] error:', err);
  process.exitCode = 1;
});
