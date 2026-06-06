/**
 * scripts/generateAllArtistAliases.ts — fix/aliases-quality-v2-and-artists
 *
 * Backfill CLI : génère les aliases IA pour TOUS les artistes sans aliases.
 * Traite par batch de 10 en parallèle via Claude Sonnet 4.5.
 *
 * Usage :
 *   pnpm tsx scripts/generateAllArtistAliases.ts                 # artistes sans aliases
 *   pnpm tsx scripts/generateAllArtistAliases.ts --all           # tous les artistes (re-gen)
 *   pnpm tsx scripts/generateAllArtistAliases.ts --limit=50      # cap à 50
 *   pnpm tsx scripts/generateAllArtistAliases.ts --locale=fr     # forcer locale FR
 *
 * Env :
 *   ANTHROPIC_API_KEY (requis) — sinon génération désactivée
 *   DATABASE_URL (requis) — accès Prisma
 */

import { PrismaClient } from '@prisma/client';
import pLimit from 'p-limit';
import { config } from 'dotenv';
import { estimateArtistCostEur, generateArtistAliases } from '../src/lib/aliasGeneration.js';

config();

const prisma = new PrismaClient();
const CONCURRENCY = 10;

function parseArgs(): { all: boolean; limit: number | null; locale: 'fr' | 'en' | undefined } {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number.parseInt(limitArg.split('=')[1] ?? '', 10) || null : null;
  const localeArg = args.find((a) => a.startsWith('--locale='));
  const localeValue = localeArg ? localeArg.split('=')[1] : undefined;
  const locale = localeValue === 'fr' || localeValue === 'en' ? localeValue : undefined;
  return { all, limit, locale };
}

async function main(): Promise<void> {
  const { all, limit, locale } = parseArgs();
  console.info(
    `[ArtistAliases CLI] start | all=${all} | limit=${limit ?? 'none'} | locale=${locale ?? 'auto'} | concurrency=${CONCURRENCY}`,
  );

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[ArtistAliases CLI] ANTHROPIC_API_KEY manquant — abort');
    process.exitCode = 1;
    return;
  }

  const where = all ? {} : { OR: [{ aliases: { equals: [] } }, { aliases_generated_at: null }] };

  const artists = await prisma.artist.findMany({
    where,
    take: limit ?? undefined,
    select: { id: true, canonical_name: true },
    orderBy: [{ aliases_generated_at: { sort: 'asc', nulls: 'first' } }],
  });

  console.info(`[ArtistAliases CLI] ${artists.length} artistes à traiter`);
  if (artists.length === 0) {
    console.info('[ArtistAliases CLI] rien à faire — exit');
    return;
  }

  const startedAt = Date.now();
  const limiter = pLimit(CONCURRENCY);
  let processed = 0;
  let failed = 0;
  let done = 0;

  await Promise.all(
    artists.map((a) =>
      limiter(async () => {
        done += 1;
        const prefix = `[${done}/${artists.length}]`;
        console.info(`${prefix} Generating for "${a.canonical_name}"…`);
        const r = await generateArtistAliases(a.canonical_name, locale);
        if (r.aliases.length === 0 || r.error) {
          failed += 1;
          console.warn(`${prefix} FAILED | error=${r.error ?? 'EMPTY_OUTPUT'}`);
          return;
        }
        await prisma.artist.update({
          where: { id: a.id },
          data: {
            aliases: r.aliases,
            aliases_generated_at: new Date(),
            aliases_source: 'ai',
          },
        });
        processed += 1;
        console.info(`${prefix} ✓ ${r.aliases.length} aliases | latency=${r.latency_ms}ms`);
      }),
    ),
  );

  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  console.info(
    `[ArtistAliases CLI] DONE | total=${artists.length} | processed=${processed} | failed=${failed} | elapsed=${elapsedSec}s | estimated_cost=${estimateArtistCostEur(artists.length)}€`,
  );
}

main()
  .catch((err) => {
    console.error('[ArtistAliases CLI] fatal:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
