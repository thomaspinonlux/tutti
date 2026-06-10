/**
 * scripts/backfillCatalogAliases.ts — fix/catalog-level-aliases
 *
 * Remplit official_playlist_tracks.title_aliases + artist_aliases au niveau
 * CATALOGUE. Avant ce script, les aliases vivaient uniquement sur les tables
 * workspace (tracks/artists) → chaque clone-on-launch naissait sans aliases
 * et il aurait fallu regénérer par venue (coût ×N).
 *
 * Le clone-on-launch (library.ts) merge déjà official_title_aliases +
 * official_artist_aliases dans Track.aliases / Artist.aliases — il suffit
 * que le catalogue soit rempli pour que tout futur clone hérite.
 *
 * Deux phases, idempotentes (skip si cardinality > 0) :
 *   1. MIGRATION : copie les aliases workspace existants vers le catalogue.
 *      Match par youtube_id (provider_track_id) puis fallback titre+artiste
 *      normalisés.
 *   2. GÉNÉRATION : pour les tracks restantes sans title_aliases →
 *      generateAliases(title, artist). Pour les artistes sans aliases →
 *      generateArtistAliases UNE FOIS par artiste (cache), appliqué à toutes
 *      ses tracks.
 *
 * Budget guard : --max-cost=60 (€). Le script s'arrête proprement au-delà
 * (relance idempotente pour continuer).
 *
 * Usage :
 *   pnpm backfill:catalog-aliases                # full run
 *   pnpm backfill:catalog-aliases --dry-run      # phase 1+2 sans write
 *   pnpm backfill:catalog-aliases --limit=50     # cap tracks générées
 *   pnpm backfill:catalog-aliases --max-cost=60  # budget € (défaut 60)
 *
 * Env : ANTHROPIC_API_KEY, DATABASE_URL.
 */

import { PrismaClient } from '@prisma/client';
import pLimit from 'p-limit';
import { config } from 'dotenv';
import { generateAliases, generateArtistAliases } from '../src/lib/aliasGeneration.js';

config();

const prisma = new PrismaClient();
const CONCURRENCY = 10;

interface CliArgs {
  dryRun: boolean;
  limit: number | null;
  maxCostEur: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number.parseInt(limitArg.split('=')[1] ?? '', 10) || null : null;
  const costArg = args.find((a) => a.startsWith('--max-cost='));
  const maxCostEur = costArg ? Number.parseFloat(costArg.split('=')[1] ?? '') || 60 : 60;
  return { dryRun, limit, maxCostEur };
}

function lower(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function slugKey(artist: string, title: string): string {
  return `${lower(artist).replace(/\s+/g, '')}|${lower(title).replace(/\s+/g, '')}`;
}

// Pricing Sonnet 4.5 pour suivi coût cumulé (les helpers loggent les tokens).
const PRICE_IN = 3 / 1_000_000;
const PRICE_OUT = 15 / 1_000_000;
const USD_TO_EUR = 0.92;
let cumulativeCostEur = 0;

function addCost(usage: { input_tokens: number; output_tokens: number } | null): void {
  if (!usage) return;
  cumulativeCostEur +=
    (usage.input_tokens * PRICE_IN + usage.output_tokens * PRICE_OUT) * USD_TO_EUR;
}

async function main(): Promise<void> {
  const { dryRun, limit, maxCostEur } = parseArgs();
  console.info(
    `[CatalogAliases] start | dry-run=${dryRun} | limit=${limit ?? 'none'} | max-cost=${maxCostEur}€`,
  );
  if (!process.env.ANTHROPIC_API_KEY && !dryRun) {
    console.error('[CatalogAliases] ANTHROPIC_API_KEY missing — abort');
    process.exitCode = 1;
    return;
  }

  // ── Phase 1 : MIGRATION workspace → catalogue ─────────────────────────
  console.info('[CatalogAliases] Phase 1 — migration aliases workspace → catalogue');

  const wsTracks = await prisma.track.findMany({
    where: { provider: 'youtube' },
    select: {
      provider_track_id: true,
      canonical_title: true,
      aliases: true,
      artist: { select: { canonical_name: true, aliases: true } },
    },
  });
  const byVideoId = new Map(wsTracks.map((t) => [t.provider_track_id, t]));
  const bySlug = new Map(
    wsTracks.map((t) => [slugKey(t.artist.canonical_name, t.canonical_title), t]),
  );

  const catalogEmpty = await prisma.officialPlaylistTrack.findMany({
    where: { title_aliases: { isEmpty: true } },
    select: { id: true, title: true, artist: true, youtube_id: true },
  });
  console.info(`[CatalogAliases] ${catalogEmpty.length} tracks catalogue sans aliases`);

  let migrated = 0;
  const stillEmpty: typeof catalogEmpty = [];
  for (const ct of catalogEmpty) {
    const ws =
      (ct.youtube_id ? byVideoId.get(ct.youtube_id) : undefined) ??
      bySlug.get(slugKey(ct.artist, ct.title));
    if (ws && (ws.aliases.length > 0 || ws.artist.aliases.length > 0)) {
      if (!dryRun) {
        await prisma.officialPlaylistTrack.update({
          where: { id: ct.id },
          data: {
            title_aliases: ws.aliases,
            artist_aliases: ws.artist.aliases,
          },
        });
      }
      migrated += 1;
    } else {
      stillEmpty.push(ct);
    }
  }
  console.info(
    `[CatalogAliases] Phase 1 done — ${migrated} migrées depuis workspace, ${stillEmpty.length} restantes à générer`,
  );

  // ── Phase 2 : GÉNÉRATION (titres par track, artistes 1× par artiste) ──
  console.info('[CatalogAliases] Phase 2 — génération IA');
  const targets = limit ? stillEmpty.slice(0, limit) : stillEmpty;

  // 2a. Artistes uniques d'abord (cache → 1 appel par artiste).
  const artistNames = Array.from(new Set(targets.map((t) => t.artist)));
  // Réutilise les aliases artistes déjà connus côté workspace.
  const knownArtistAliases = new Map<string, string[]>();
  for (const ws of wsTracks) {
    if (ws.artist.aliases.length > 0) {
      knownArtistAliases.set(lower(ws.artist.canonical_name), ws.artist.aliases);
    }
  }
  const artistsToGen = artistNames.filter((a) => !knownArtistAliases.has(lower(a)));
  console.info(
    `[CatalogAliases] ${artistNames.length} artistes uniques | ${artistsToGen.length} à générer (reste depuis cache workspace)`,
  );

  const limiter = pLimit(CONCURRENCY);
  let artistsGenerated = 0;
  let budgetExceeded = false;

  if (!dryRun) {
    await Promise.all(
      artistsToGen.map((name) =>
        limiter(async () => {
          if (budgetExceeded) return;
          const r = await generateArtistAliases(name);
          addCost(r.usage);
          if (r.aliases.length > 0) {
            knownArtistAliases.set(lower(name), r.aliases);
            artistsGenerated += 1;
          }
          if (cumulativeCostEur > maxCostEur) {
            budgetExceeded = true;
            console.error(
              `[CatalogAliases] BUDGET DÉPASSÉ (${cumulativeCostEur.toFixed(2)}€ > ${maxCostEur}€) — stop propre, relancer pour continuer`,
            );
          }
          if (artistsGenerated % 100 === 0) {
            console.info(
              `[CatalogAliases] checkpoint artistes : ${artistsGenerated}/${artistsToGen.length} | coût=${cumulativeCostEur.toFixed(2)}€`,
            );
          }
        }),
      ),
    );
  }
  console.info(
    `[CatalogAliases] artistes générés=${artistsGenerated} | coût cumulé=${cumulativeCostEur.toFixed(2)}€`,
  );

  // 2b. Titres par track + write title_aliases + artist_aliases (cache).
  let tracksGenerated = 0;
  let failed = 0;
  if (!dryRun && !budgetExceeded) {
    await Promise.all(
      targets.map((ct) =>
        limiter(async () => {
          if (budgetExceeded) return;
          const r = await generateAliases(ct.title, ct.artist);
          addCost(r.usage);
          if (r.error || r.aliases.length === 0) {
            failed += 1;
            return;
          }
          const artistAliases = knownArtistAliases.get(lower(ct.artist)) ?? [];
          await prisma.officialPlaylistTrack.update({
            where: { id: ct.id },
            data: { title_aliases: r.aliases, artist_aliases: artistAliases },
          });
          tracksGenerated += 1;
          if (cumulativeCostEur > maxCostEur) {
            budgetExceeded = true;
            console.error(
              `[CatalogAliases] BUDGET DÉPASSÉ (${cumulativeCostEur.toFixed(2)}€ > ${maxCostEur}€) — stop propre, relancer pour continuer`,
            );
          }
          if (tracksGenerated % 200 === 0) {
            console.info(
              `[CatalogAliases] checkpoint tracks : ${tracksGenerated}/${targets.length} | coût=${cumulativeCostEur.toFixed(2)}€`,
            );
          }
        }),
      ),
    );
  }

  console.info('\n[CatalogAliases] ═══════════ SUMMARY ═══════════');
  console.info(`  Migrées depuis workspace : ${migrated}${dryRun ? ' (DRY)' : ''}`);
  console.info(`  Artistes générés (IA)    : ${artistsGenerated}`);
  console.info(`  Tracks générées (IA)     : ${tracksGenerated}`);
  console.info(`  Échecs génération        : ${failed}`);
  console.info(`  Coût total               : ${cumulativeCostEur.toFixed(2)}€`);
  console.info(
    `  Budget dépassé           : ${budgetExceeded ? 'OUI — relancer pour continuer' : 'non'}`,
  );
  console.info('[CatalogAliases] ════════════════════════════════');
}

main()
  .catch((err) => {
    console.error('[CatalogAliases] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
