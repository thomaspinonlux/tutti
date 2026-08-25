/**
 * scripts/prefetchLyrics.ts — remplissage hors ligne du cache `track_lyrics`.
 *
 * À lancer AVANT les soirées : le gameplay ne fait aucun appel réseau pour les
 * paroles, il ne lit que ce cache.
 *
 * Usage :
 *   pnpm prefetch:lyrics                 # tout le périmètre Apple, reprend où il s'était arrêté
 *   pnpm prefetch:lyrics --limit=50      # échantillon
 *   pnpm prefetch:lyrics --refresh       # re-vérifie même les ids déjà en cache
 *                                        # (n'écrase JAMAIS un rejet manuel)
 *
 * Env : DATABASE_URL + credentials du developer token Apple
 *       (cf. lib/appleDeveloperToken.ts). Aucune clé LRCLIB (API publique).
 */

import { config } from 'dotenv';
import { prisma } from '../src/lib/prisma.js';
import { runLyricsPrefetch } from '../src/lib/lyrics/prefetchLyrics.js';

config();

function parseArgs(): { limit?: number; refresh: boolean } {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg
    ? Number.parseInt(limitArg.split('=')[1] ?? '', 10) || undefined
    : undefined;
  return { limit, refresh: args.includes('--refresh') };
}

async function main(): Promise<void> {
  const { limit, refresh } = parseArgs();
  console.info(
    `[prefetch:lyrics] start | limit=${limit ?? 'aucune'} | refresh=${refresh} | source=LRCLIB (gratuit)`,
  );

  const result = await runLyricsPrefetch({ limit, refresh });

  console.info('\n[prefetch:lyrics] ═══════════ BILAN ═══════════');
  console.info(`  Traités                 : ${result.processed}/${result.total}`);
  console.info(`  ok (affichables)        : ${result.ok}`);
  console.info(`  inutilisables           : ${result.unusable}`);
  console.info(`  erreurs                 : ${result.errors}`);
  console.info(`  rejets manuels préservés: ${result.skippedRejected}`);
  const reasons = Object.entries(result.byReason).sort((a, b) => b[1] - a[1]);
  if (reasons.length > 0) {
    console.info('  ── détail par raison ──');
    for (const [reason, count] of reasons) {
      console.info(`     ${reason.padEnd(16)} : ${count}`);
    }
  }
  const rate = result.processed > 0 ? ((result.ok / result.processed) * 100).toFixed(1) : '0.0';
  console.info(`  Taux de couverture      : ${rate} %`);
  console.info('[prefetch:lyrics] ════════════════════════════════');
}

main()
  .catch((err) => {
    console.error('[prefetch:lyrics] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
