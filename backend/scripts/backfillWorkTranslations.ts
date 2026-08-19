/**
 * scripts/backfillWorkTranslations.ts — feat/work-title-bilingual-aliases
 *
 * Enrichit official_playlist_tracks pour les playlists FILM / DESSIN ANIMÉ /
 * SÉRIE / JEUX VIDÉO / COMÉDIE MUSICALE, EN PLUS des alias phonétiques
 * existants (ne les touche pas) :
 *
 *   1. Titre officiel dans l'autre langue (title_aliases, additif) — ex.
 *      "Let It Go" → alias "libérée délivrée" (PAS une traduction littérale,
 *      le vrai titre commercialisé). Rien si aucune version officielle.
 *   2. Nom de l'œuvre dans les DEUX langues (work_aliases, additif) — et
 *      remplit work_title UNIQUEMENT s'il est NULL (jamais écrasé sinon).
 *
 * Périmètre STRICT — ces 18 playlists uniquement (778 tracks) :
 *   Disney en français, Disney — Versions originales, Génériques Disney &
 *   Pixar, Génériques dessins animés & séries enfants, Génériques Club
 *   Dorothée — Dessins animés, Génériques de Séries TV, Génériques films &
 *   séries, Génériques Jeux TV & Émissions FR, Jeux Vidéo, Anime (Openings),
 *   Comédies musicales US, Comédies musicales françaises, Musique de Film
 *   (+ Facile/Moyen/Difficile), Cinéma français — Bandes originales,
 *   James Bond — Génériques.
 *
 * NE MODIFIE PAS aliases_source (champ partagé avec le pipeline phonétique
 * generateAliases — cet enrichissement est un axe distinct, on ne le pollue
 * pas). Ne touche à AUCUN autre champ (title, artist, title_aliases
 * pré-existants, etc.) sauf append.
 *
 * Usage :
 *   pnpm backfill:work-translations                # full run
 *   pnpm backfill:work-translations --dry-run       # coût estimé, pas de write
 *   pnpm backfill:work-translations --dry-run --sample=20   # + appels API réels
 *                                                             sur 20 tracks, affiche
 *                                                             avant/après SANS écrire
 *   pnpm backfill:work-translations --limit=50      # cap tracks traitées
 *   pnpm backfill:work-translations --max-cost=30   # budget € (défaut 30)
 *
 * Env : ANTHROPIC_API_KEY, DATABASE_URL.
 */

import { PrismaClient } from '@prisma/client';
import pLimit from 'p-limit';
import { config } from 'dotenv';
import {
  generateWorkTranslation,
  estimateWorkTranslationCostEur,
} from '../src/lib/aliasGeneration.js';

config();

const prisma = new PrismaClient();
const CONCURRENCY = 10;

const TARGET_PLAYLIST_NAMES = [
  'Disney en français',
  'Disney — Versions originales',
  'Génériques Disney & Pixar',
  'Génériques dessins animés & séries enfants',
  'Génériques Club Dorothée — Dessins animés',
  'Génériques de Séries TV',
  'Génériques films & séries',
  'Génériques Jeux TV & Émissions FR',
  'Jeux Vidéo',
  'Anime (Openings)',
  'Comédies musicales US',
  'Comédies musicales françaises',
  'Musique de Film',
  'Musique de Film — Facile',
  'Musique de Film — Moyen',
  'Musique de Film — Difficile',
  'Cinéma français — Bandes originales',
  'James Bond — Génériques',
];

interface CliArgs {
  dryRun: boolean;
  limit: number | null;
  sample: number | null;
  maxCostEur: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number.parseInt(limitArg.split('=')[1] ?? '', 10) || null : null;
  const sampleArg = args.find((a) => a.startsWith('--sample='));
  const sample = sampleArg ? Number.parseInt(sampleArg.split('=')[1] ?? '', 10) || null : null;
  const costArg = args.find((a) => a.startsWith('--max-cost='));
  const maxCostEur = costArg ? Number.parseFloat(costArg.split('=')[1] ?? '') || 30 : 30;
  return { dryRun, limit, sample, maxCostEur };
}

const PRICE_IN = 3 / 1_000_000;
const PRICE_OUT = 15 / 1_000_000;
const USD_TO_EUR = 0.92;
let cumulativeCostEur = 0;

function addCost(usage: { input_tokens: number; output_tokens: number } | null): void {
  if (!usage) return;
  cumulativeCostEur +=
    (usage.input_tokens * PRICE_IN + usage.output_tokens * PRICE_OUT) * USD_TO_EUR;
}

function dedupeCaseInsensitive(existing: string[], additions: (string | null)[]): string[] {
  const seen = new Set(existing.map((s) => s.toLowerCase()));
  const out = [...existing];
  for (const a of additions) {
    if (!a) continue;
    const key = a.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

async function main(): Promise<void> {
  const { dryRun, limit, sample, maxCostEur } = parseArgs();
  console.info(
    `[WorkTranslations] start | dry-run=${dryRun} | limit=${limit ?? 'none'} | sample=${sample ?? 'none'} | max-cost=${maxCostEur}€`,
  );
  if (!process.env.ANTHROPIC_API_KEY && !dryRun) {
    console.error('[WorkTranslations] ANTHROPIC_API_KEY missing — abort');
    process.exitCode = 1;
    return;
  }

  const playlists = await prisma.officialPlaylist.findMany({
    where: { name_fr: { in: TARGET_PLAYLIST_NAMES } },
    select: { id: true, name_fr: true, locale_primary: true },
  });
  const foundNames = new Set(playlists.map((p) => p.name_fr));
  const missing = TARGET_PLAYLIST_NAMES.filter((n) => !foundNames.has(n));
  if (missing.length > 0) {
    console.error(`[WorkTranslations] Playlists introuvables (abort) : ${missing.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const localeByPlaylist = new Map(
    playlists.map(
      (p) => [p.id, p.locale_primary.toLowerCase().startsWith('fr') ? 'fr' : 'en'] as const,
    ),
  );

  let tracks = await prisma.officialPlaylistTrack.findMany({
    where: { playlist_id: { in: playlists.map((p) => p.id) } },
    select: {
      id: true,
      title: true,
      artist: true,
      work_title: true,
      title_aliases: true,
      work_aliases: true,
      playlist_id: true,
    },
    orderBy: { created_at: 'asc' },
  });
  console.info(`[WorkTranslations] ${tracks.length} tracks dans le périmètre (18 playlists)`);

  if (limit) tracks = tracks.slice(0, limit);

  const estimatedCost = estimateWorkTranslationCostEur(tracks.length);
  console.info(
    `[WorkTranslations] Estimation coût (calculée, PAS mesurée) : ${estimatedCost.toFixed(2)}€ pour ${tracks.length} tracks`,
  );

  // ── Mode dry-run avec échantillon réel (appels API, AUCUNE écriture) ────
  if (dryRun && sample) {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('[WorkTranslations] --sample nécessite ANTHROPIC_API_KEY — abort');
      process.exitCode = 1;
      return;
    }
    const targets = tracks.slice(0, sample);
    console.info(`[WorkTranslations] Échantillon RÉEL (API) sur ${targets.length} tracks…`);
    for (const t of targets) {
      const locale = localeByPlaylist.get(t.playlist_id) ?? 'fr';
      const r = await generateWorkTranslation(t.title, t.artist, t.work_title, locale);
      addCost(r.usage);
      console.info(
        `\n— "${t.title}" (${t.artist}) | work_title actuel="${t.work_title ?? 'NULL'}"\n` +
          `  official_title_other_lang = ${JSON.stringify(r.official_title_other_lang)}\n` +
          `  work_title_fr             = ${JSON.stringify(r.work_title_fr)}\n` +
          `  work_title_en             = ${JSON.stringify(r.work_title_en)}\n` +
          `  tokens=${r.usage ? `${r.usage.input_tokens}+${r.usage.output_tokens}` : 'n/a'} | erreur=${r.error ?? 'aucune'}`,
      );
    }
    console.info(
      `\n[WorkTranslations] Coût RÉEL mesuré sur l'échantillon : ${cumulativeCostEur.toFixed(4)}€ (${targets.length} tracks) → projeté sur ${tracks.length} : ${((cumulativeCostEur / targets.length) * tracks.length).toFixed(2)}€`,
    );
    return;
  }

  if (dryRun) {
    console.info(
      '[WorkTranslations] DRY-RUN sans --sample : coût estimé ci-dessus, aucun appel API, aucune écriture.',
    );
    return;
  }

  // ── Mode réel ─────────────────────────────────────────────────────────
  const limiter = pLimit(CONCURRENCY);
  let updated = 0;
  let failed = 0;
  let budgetExceeded = false;

  await Promise.all(
    tracks.map((t) =>
      limiter(async () => {
        if (budgetExceeded) return;
        const locale = localeByPlaylist.get(t.playlist_id) ?? 'fr';
        const r = await generateWorkTranslation(t.title, t.artist, t.work_title, locale);
        addCost(r.usage);

        if (!r.error) {
          const newTitleAliases = dedupeCaseInsensitive(t.title_aliases, [
            r.official_title_other_lang?.toLowerCase() ?? null,
          ]);
          const newWorkAliases = dedupeCaseInsensitive(t.work_aliases, [
            r.work_title_fr,
            r.work_title_en,
          ]);
          const newWorkTitle =
            t.work_title ??
            (locale === 'fr'
              ? (r.work_title_fr ?? r.work_title_en)
              : (r.work_title_en ?? r.work_title_fr));

          await prisma.officialPlaylistTrack.update({
            where: { id: t.id },
            data: {
              title_aliases: newTitleAliases,
              work_aliases: newWorkAliases,
              work_title: newWorkTitle ?? undefined,
            },
          });
          updated += 1;
        } else {
          failed += 1;
        }

        if (cumulativeCostEur > maxCostEur) {
          budgetExceeded = true;
          console.error(
            `[WorkTranslations] BUDGET DÉPASSÉ (${cumulativeCostEur.toFixed(2)}€ > ${maxCostEur}€) — stop propre, relancer pour continuer`,
          );
        }
        if ((updated + failed) % 100 === 0) {
          console.info(
            `[WorkTranslations] checkpoint : ${updated + failed}/${tracks.length} | coût=${cumulativeCostEur.toFixed(2)}€`,
          );
        }
      }),
    ),
  );

  console.info('\n[WorkTranslations] ═══════════ SUMMARY ═══════════');
  console.info(`  Tracks mises à jour : ${updated}`);
  console.info(`  Échecs génération   : ${failed}`);
  console.info(`  Coût total          : ${cumulativeCostEur.toFixed(2)}€`);
  console.info(
    `  Budget dépassé      : ${budgetExceeded ? 'OUI — relancer pour continuer' : 'non'}`,
  );
  console.info('[WorkTranslations] ════════════════════════════════');
}

main()
  .catch((err) => {
    console.error('[WorkTranslations] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
