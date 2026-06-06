/**
 * scripts/generateAllAliases.ts — feat/ai-aliases-voice-matching
 *
 * Backfill CLI : génère les aliases IA pour TOUTES les tracks sans aliases
 * (ou avec aliases_generated_at NULL). Traite par batch de 10 en parallèle.
 *
 * Usage :
 *   pnpm tsx scripts/generateAllAliases.ts                  # tracks sans aliases uniquement
 *   pnpm tsx scripts/generateAllAliases.ts --all            # toutes les tracks (re-gen)
 *   pnpm tsx scripts/generateAllAliases.ts --limit=50       # cap à 50
 *   pnpm tsx scripts/generateAllAliases.ts --locale=fr      # forcer locale FR
 *   pnpm tsx scripts/generateAllAliases.ts --force-regen    # re-gen toutes les tracks AI
 *                                                          # (override aliases_source='ai')
 *
 * Env :
 *   ANTHROPIC_API_KEY (requis) — sinon génération désactivée
 *   DATABASE_URL (requis) — accès Prisma
 */

import { PrismaClient } from '@prisma/client';
import pLimit from 'p-limit';
import { config } from 'dotenv';
import { estimateCostEur, generateAliases } from '../src/lib/aliasGeneration.js';

config();

const prisma = new PrismaClient();
const CONCURRENCY = 10;

function parseArgs(): {
  all: boolean;
  forceRegen: boolean;
  limit: number | null;
  locale: 'fr' | 'en' | undefined;
} {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const forceRegen = args.includes('--force-regen');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number.parseInt(limitArg.split('=')[1] ?? '', 10) || null : null;
  const localeArg = args.find((a) => a.startsWith('--locale='));
  const localeValue = localeArg ? localeArg.split('=')[1] : undefined;
  const locale = localeValue === 'fr' || localeValue === 'en' ? localeValue : undefined;
  return { all, forceRegen, limit, locale };
}

async function main(): Promise<void> {
  const { all, forceRegen, limit, locale } = parseArgs();
  console.info(
    `[Aliases CLI] start | all=${all} | force-regen=${forceRegen} | limit=${limit ?? 'none'} | locale=${locale ?? 'auto'} | concurrency=${CONCURRENCY}`,
  );

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[Aliases CLI] ANTHROPIC_API_KEY manquant — abort');
    process.exitCode = 1;
    return;
  }

  // --force-regen : re-génère TOUTES les tracks AI (override qualité v1).
  // --all : re-gen toutes les tracks (peu importe source).
  // défaut : seulement les tracks sans aliases ou avec aliases_generated_at null.
  const where = forceRegen
    ? { aliases_source: 'ai' }
    : all
      ? {}
      : { OR: [{ aliases: { equals: [] } }, { aliases_generated_at: null }] };

  const tracks = await prisma.track.findMany({
    where,
    take: limit ?? undefined,
    select: {
      id: true,
      canonical_title: true,
      artist: { select: { canonical_name: true } },
    },
    orderBy: [{ aliases_generated_at: { sort: 'asc', nulls: 'first' } }],
  });

  console.info(`[Aliases CLI] ${tracks.length} tracks à traiter`);
  if (tracks.length === 0) {
    console.info('[Aliases CLI] rien à faire — exit');
    return;
  }

  const startedAt = Date.now();
  const limiter = pLimit(CONCURRENCY);
  let processed = 0;
  let failed = 0;
  let done = 0;

  await Promise.all(
    tracks.map((t) =>
      limiter(async () => {
        done += 1;
        const prefix = `[${done}/${tracks.length}]`;
        console.info(
          `${prefix} Generating for "${t.canonical_title}" by ${t.artist.canonical_name}…`,
        );
        const r = await generateAliases(t.canonical_title, t.artist.canonical_name, locale);
        if (r.aliases.length === 0 || r.error) {
          failed += 1;
          console.warn(`${prefix} FAILED | error=${r.error ?? 'EMPTY_OUTPUT'}`);
          return;
        }
        await prisma.track.update({
          where: { id: t.id },
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
    `[Aliases CLI] DONE | total=${tracks.length} | processed=${processed} | failed=${failed} | elapsed=${elapsedSec}s | estimated_cost=${estimateCostEur(tracks.length)}€`,
  );
}

main()
  .catch((err) => {
    console.error('[Aliases CLI] fatal:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
