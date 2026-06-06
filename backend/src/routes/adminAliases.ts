/**
 * Routes /api/admin/aliases/* — feat/ai-aliases-voice-matching
 *
 * Gestion des aliases de prononciation pour le matching vocal :
 *   - POST   /generate          { trackIds?: string[], all?: boolean, missingOnly?: boolean, limit?: number }
 *   - GET    /                  { hasAliases?: boolean, page?: number, pageSize?: number }
 *   - PATCH  /:trackId          { aliases: string[] } — édition manuelle
 *   - POST   /:trackId/regenerate — re-génération IA pour une track spécifique
 *
 * Toutes les routes sont gardées par requireAuth + requireSuperAdmin.
 *
 * Batch 10 tracks en parallèle via p-limit (déjà dep). Persiste aliases +
 * aliases_generated_at + aliases_source à chaque succès.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import pLimit from 'p-limit';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireSuperAdmin } from '../middleware/tenant.js';
import {
  estimateArtistCostEur,
  estimateCostEur,
  generateAliases,
  generateArtistAliases,
} from '../lib/aliasGeneration.js';

const router: Router = Router();
router.use(requireAuth, requireSuperAdmin);

const BATCH_CONCURRENCY = 10;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const generateBodySchema = z
  .object({
    trackIds: z.array(z.string().uuid()).optional(),
    all: z.boolean().optional(),
    missingOnly: z.boolean().optional(),
    limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
    locale: z.enum(['fr', 'en']).optional(),
  })
  .refine((v) => v.trackIds || v.all || v.missingOnly, {
    message: 'Au moins un de trackIds, all, missingOnly est requis',
  });

// ── POST /generate — batch generation ─────────────────────────────────────
router.post('/generate', async (req: Request, res: Response): Promise<void> => {
  const parsed = generateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    return;
  }
  const { trackIds, missingOnly, limit = DEFAULT_LIMIT, locale } = parsed.data;

  // Build the where clause based on input flags.
  const where: Record<string, unknown> = {};
  if (trackIds && trackIds.length > 0) {
    where.id = { in: trackIds };
  } else if (missingOnly) {
    where.OR = [{ aliases: { equals: [] } }, { aliases_generated_at: null }];
  }
  // `all=true` with no other filter → take = limit cap

  const tracks = await prisma.track.findMany({
    where,
    take: limit,
    select: {
      id: true,
      canonical_title: true,
      artist: { select: { canonical_name: true } },
    },
  });

  if (tracks.length === 0) {
    res.json({
      total: 0,
      processed: 0,
      failed: 0,
      cost_estimate_eur: 0,
      results: [],
    });
    return;
  }

  console.info(
    `[Aliases] POST /generate | tracks=${tracks.length} | concurrency=${BATCH_CONCURRENCY} | locale=${locale ?? 'auto'}`,
  );

  const limiter = pLimit(BATCH_CONCURRENCY);
  let processed = 0;
  let failed = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const results = await Promise.all(
    tracks.map((t) =>
      limiter(async () => {
        const r = await generateAliases(t.canonical_title, t.artist.canonical_name, locale);
        if (r.aliases.length === 0 || r.error) {
          failed += 1;
          return {
            track_id: t.id,
            title: t.canonical_title,
            artist: t.artist.canonical_name,
            aliases: [],
            success: false,
            error: r.error ?? 'EMPTY_OUTPUT',
          };
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
        if (r.usage) {
          totalInputTokens += r.usage.input_tokens;
          totalOutputTokens += r.usage.output_tokens;
        }
        return {
          track_id: t.id,
          title: t.canonical_title,
          artist: t.artist.canonical_name,
          aliases: r.aliases,
          success: true,
          error: null,
        };
      }),
    ),
  );

  res.json({
    total: tracks.length,
    processed,
    failed,
    cost_estimate_eur: estimateCostEur(tracks.length),
    tokens: { input: totalInputTokens, output: totalOutputTokens },
    results,
  });
});

// ── GET / — paginated list ───────────────────────────────────────────────
const listQuerySchema = z.object({
  hasAliases: z
    .string()
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
  page: z
    .string()
    .optional()
    .transform((v) => Math.max(1, Number.parseInt(v ?? '1', 10) || 1)),
  pageSize: z
    .string()
    .optional()
    .transform((v) =>
      Math.min(
        MAX_LIMIT,
        Math.max(1, Number.parseInt(v ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
      ),
    ),
});

router.get('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    return;
  }
  const { hasAliases, page, pageSize } = parsed.data;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};
  if (hasAliases === true) {
    where.aliases = { not: { equals: [] } };
  } else if (hasAliases === false) {
    where.OR = [{ aliases: { equals: [] } }, { aliases_generated_at: null }];
  }

  const [tracks, total] = await Promise.all([
    prisma.track.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: [{ aliases_generated_at: { sort: 'asc', nulls: 'first' } }],
      select: {
        id: true,
        canonical_title: true,
        aliases: true,
        aliases_generated_at: true,
        aliases_source: true,
        artist: { select: { canonical_name: true } },
      },
    }),
    prisma.track.count({ where }),
  ]);

  res.json({
    page,
    pageSize,
    total,
    tracks: tracks.map((t) => ({
      track_id: t.id,
      title: t.canonical_title,
      artist: t.artist.canonical_name,
      aliases: t.aliases,
      aliases_generated_at: t.aliases_generated_at,
      aliases_source: t.aliases_source,
    })),
  });
});

// ── PATCH /:trackId — manual edit ─────────────────────────────────────────
const patchBodySchema = z.object({
  aliases: z.array(z.string().min(1).max(120)).max(50),
});

router.patch(
  '/:trackId',
  async (req: Request<{ trackId: string }>, res: Response): Promise<void> => {
    const parsed = patchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
      return;
    }
    const normalized = Array.from(
      new Set(parsed.data.aliases.map((a) => a.toLowerCase().trim()).filter((a) => a.length >= 2)),
    );
    try {
      const track = await prisma.track.update({
        where: { id: req.params.trackId },
        data: {
          aliases: normalized,
          aliases_generated_at: new Date(),
          aliases_source: 'manual',
        },
        select: {
          id: true,
          canonical_title: true,
          aliases: true,
          aliases_generated_at: true,
          aliases_source: true,
          artist: { select: { canonical_name: true } },
        },
      });
      res.json({
        track_id: track.id,
        title: track.canonical_title,
        artist: track.artist.canonical_name,
        aliases: track.aliases,
        aliases_generated_at: track.aliases_generated_at,
        aliases_source: track.aliases_source,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('No record')) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Track introuvable' } });
        return;
      }
      console.error('[Aliases] PATCH error:', err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: msg } });
    }
  },
);

// ── POST /:trackId/regenerate — single track AI re-gen ────────────────────
router.post(
  '/:trackId/regenerate',
  async (req: Request<{ trackId: string }>, res: Response): Promise<void> => {
    const localeQuery = String(req.query.locale ?? '');
    const locale = localeQuery === 'fr' || localeQuery === 'en' ? localeQuery : undefined;

    const track = await prisma.track.findUnique({
      where: { id: req.params.trackId },
      select: {
        id: true,
        canonical_title: true,
        artist: { select: { canonical_name: true } },
      },
    });
    if (!track) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Track introuvable' } });
      return;
    }

    const r = await generateAliases(track.canonical_title, track.artist.canonical_name, locale);
    if (r.aliases.length === 0 || r.error) {
      res
        .status(502)
        .json({ error: { code: 'GENERATION_FAILED', message: r.error ?? 'EMPTY_OUTPUT' } });
      return;
    }
    const updated = await prisma.track.update({
      where: { id: track.id },
      data: {
        aliases: r.aliases,
        aliases_generated_at: new Date(),
        aliases_source: 'ai',
      },
      select: {
        id: true,
        canonical_title: true,
        aliases: true,
        aliases_generated_at: true,
        aliases_source: true,
        artist: { select: { canonical_name: true } },
      },
    });
    res.json({
      track_id: updated.id,
      title: updated.canonical_title,
      artist: updated.artist.canonical_name,
      aliases: updated.aliases,
      aliases_generated_at: updated.aliases_generated_at,
      aliases_source: updated.aliases_source,
      latency_ms: r.latency_ms,
      tokens: r.usage,
    });
  },
);

// ══════════════════════════════════════════════════════════════════════════
// fix/aliases-quality-v2-and-artists — routes pour aliases d'artistes.
// Permet à un joueur de buzz juste "Green Day" et matcher tous les morceaux
// de Green Day (matchAnswer itère track.artist.aliases côté cascade).
// ══════════════════════════════════════════════════════════════════════════

const generateArtistsBodySchema = z
  .object({
    artistIds: z.array(z.string().uuid()).optional(),
    all: z.boolean().optional(),
    missingOnly: z.boolean().optional(),
    limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
    locale: z.enum(['fr', 'en']).optional(),
  })
  .refine((v) => v.artistIds || v.all || v.missingOnly, {
    message: 'Au moins un de artistIds, all, missingOnly est requis',
  });

// ── POST /generate-artists — batch generation for artists ────────────────
router.post('/generate-artists', async (req: Request, res: Response): Promise<void> => {
  const parsed = generateArtistsBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    return;
  }
  const { artistIds, missingOnly, limit = DEFAULT_LIMIT, locale } = parsed.data;

  const where: Record<string, unknown> = {};
  if (artistIds && artistIds.length > 0) {
    where.id = { in: artistIds };
  } else if (missingOnly) {
    where.OR = [{ aliases: { equals: [] } }, { aliases_generated_at: null }];
  }

  const artists = await prisma.artist.findMany({
    where,
    take: limit,
    select: { id: true, canonical_name: true },
  });

  if (artists.length === 0) {
    res.json({ total: 0, processed: 0, failed: 0, cost_estimate_eur: 0, results: [] });
    return;
  }

  console.info(
    `[Aliases] POST /generate-artists | artists=${artists.length} | locale=${locale ?? 'auto'}`,
  );

  const limiter = pLimit(BATCH_CONCURRENCY);
  let processed = 0;
  let failed = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const results = await Promise.all(
    artists.map((a) =>
      limiter(async () => {
        const r = await generateArtistAliases(a.canonical_name, locale);
        if (r.aliases.length === 0 || r.error) {
          failed += 1;
          return {
            artist_id: a.id,
            name: a.canonical_name,
            aliases: [],
            success: false,
            error: r.error ?? 'EMPTY_OUTPUT',
          };
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
        if (r.usage) {
          totalInputTokens += r.usage.input_tokens;
          totalOutputTokens += r.usage.output_tokens;
        }
        return {
          artist_id: a.id,
          name: a.canonical_name,
          aliases: r.aliases,
          success: true,
          error: null,
        };
      }),
    ),
  );

  res.json({
    total: artists.length,
    processed,
    failed,
    cost_estimate_eur: estimateArtistCostEur(artists.length),
    tokens: { input: totalInputTokens, output: totalOutputTokens },
    results,
  });
});

// ── GET /artists — paginated list ────────────────────────────────────────
const listArtistsQuerySchema = z.object({
  hasAliases: z
    .string()
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
  page: z
    .string()
    .optional()
    .transform((v) => Math.max(1, Number.parseInt(v ?? '1', 10) || 1)),
  pageSize: z
    .string()
    .optional()
    .transform((v) =>
      Math.min(
        MAX_LIMIT,
        Math.max(1, Number.parseInt(v ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
      ),
    ),
});

router.get('/artists', async (req: Request, res: Response): Promise<void> => {
  const parsed = listArtistsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    return;
  }
  const { hasAliases, page, pageSize } = parsed.data;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};
  if (hasAliases === true) {
    where.aliases = { not: { equals: [] } };
  } else if (hasAliases === false) {
    where.OR = [{ aliases: { equals: [] } }, { aliases_generated_at: null }];
  }

  const [artists, total] = await Promise.all([
    prisma.artist.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: [{ aliases_generated_at: { sort: 'asc', nulls: 'first' } }],
      select: {
        id: true,
        canonical_name: true,
        aliases: true,
        aliases_generated_at: true,
        aliases_source: true,
      },
    }),
    prisma.artist.count({ where }),
  ]);

  res.json({
    page,
    pageSize,
    total,
    artists: artists.map((a) => ({
      artist_id: a.id,
      name: a.canonical_name,
      aliases: a.aliases,
      aliases_generated_at: a.aliases_generated_at,
      aliases_source: a.aliases_source,
    })),
  });
});

// ── PATCH /artists/:artistId — manual edit ───────────────────────────────
router.patch(
  '/artists/:artistId',
  async (req: Request<{ artistId: string }>, res: Response): Promise<void> => {
    const parsed = patchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
      return;
    }
    const normalized = Array.from(
      new Set(parsed.data.aliases.map((a) => a.toLowerCase().trim()).filter((a) => a.length >= 2)),
    );
    try {
      const artist = await prisma.artist.update({
        where: { id: req.params.artistId },
        data: {
          aliases: normalized,
          aliases_generated_at: new Date(),
          aliases_source: 'manual',
        },
        select: {
          id: true,
          canonical_name: true,
          aliases: true,
          aliases_generated_at: true,
          aliases_source: true,
        },
      });
      res.json({
        artist_id: artist.id,
        name: artist.canonical_name,
        aliases: artist.aliases,
        aliases_generated_at: artist.aliases_generated_at,
        aliases_source: artist.aliases_source,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('No record')) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Artiste introuvable' } });
        return;
      }
      console.error('[Aliases] PATCH artist error:', err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: msg } });
    }
  },
);

// ── POST /artists/:artistId/regenerate ───────────────────────────────────
router.post(
  '/artists/:artistId/regenerate',
  async (req: Request<{ artistId: string }>, res: Response): Promise<void> => {
    const localeQuery = String(req.query.locale ?? '');
    const locale = localeQuery === 'fr' || localeQuery === 'en' ? localeQuery : undefined;

    const artist = await prisma.artist.findUnique({
      where: { id: req.params.artistId },
      select: { id: true, canonical_name: true },
    });
    if (!artist) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Artiste introuvable' } });
      return;
    }

    const r = await generateArtistAliases(artist.canonical_name, locale);
    if (r.aliases.length === 0 || r.error) {
      res
        .status(502)
        .json({ error: { code: 'GENERATION_FAILED', message: r.error ?? 'EMPTY_OUTPUT' } });
      return;
    }
    const updated = await prisma.artist.update({
      where: { id: artist.id },
      data: {
        aliases: r.aliases,
        aliases_generated_at: new Date(),
        aliases_source: 'ai',
      },
      select: {
        id: true,
        canonical_name: true,
        aliases: true,
        aliases_generated_at: true,
        aliases_source: true,
      },
    });
    res.json({
      artist_id: updated.id,
      name: updated.canonical_name,
      aliases: updated.aliases,
      aliases_generated_at: updated.aliases_generated_at,
      aliases_source: updated.aliases_source,
      latency_ms: r.latency_ms,
      tokens: r.usage,
    });
  },
);

export default router;
