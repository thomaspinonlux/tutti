/**
 * Routes /api/admin/library/* — gestion bibliothèque officielle Tutti.
 *
 *   - GET    /playlists                         : liste official_playlists
 *   - GET    /playlists/:id                     : détail + tracks
 *   - PATCH  /playlists/:id                     : update name/desc/visibility
 *   - POST   /playlists/:id/resync              : re-import depuis JSON source
 *   - POST   /reimport                          : re-import tous les .json
 *
 * Toutes les routes sont gardées par requireAuth + requireSuperAdmin.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireSuperAdmin } from '../middleware/tenant.js';
import {
  DEFAULT_PLAYLISTS_DIR,
  processAllFiles,
  processOneSlug,
} from '../lib/officialLibraryImport.js';

const router: Router = Router();

router.use(requireAuth, requireSuperAdmin);

// ───── GET /playlists — liste avec filtre visibility + recherche ──────────

const listQuery = z.object({
  visibility: z.enum(['public', 'premium_only', 'private']).optional(),
  q: z.string().optional(),
});

router.get('/playlists', async (req: Request, res: Response): Promise<void> => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'INVALID_QUERY', message: parsed.error.message } });
    return;
  }
  const { visibility, q } = parsed.data;
  const where: Record<string, unknown> = {};
  if (visibility) where.visibility = visibility;
  if (q && q.trim()) {
    const term = q.trim();
    where.OR = [
      { name_fr: { contains: term, mode: 'insensitive' } },
      { name_en: { contains: term, mode: 'insensitive' } },
      { theme: { contains: term, mode: 'insensitive' } },
      { slug: { contains: term, mode: 'insensitive' } },
    ];
  }
  const playlists = await prisma.officialPlaylist.findMany({
    where,
    orderBy: { updated_at: 'desc' },
    select: {
      id: true,
      slug: true,
      name_fr: true,
      name_en: true,
      theme: true,
      difficulty: true,
      locale_primary: true,
      visibility: true,
      track_count: true,
      created_at: true,
      updated_at: true,
    },
  });
  res.json({ playlists });
});

// ───── GET /playlists/:id — détail + tracks ──────────────────────────────

router.get('/playlists/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const playlist = await prisma.officialPlaylist.findUnique({
    where: { id: req.params.id },
    include: {
      tracks: { orderBy: { position: 'asc' } },
    },
  });
  if (!playlist) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Playlist introuvable' } });
    return;
  }
  res.json({ playlist });
});

// ───── PATCH /playlists/:id — update name/desc/visibility ────────────────

const patchBody = z.object({
  name_fr: z.string().min(1).max(200).optional(),
  name_en: z.string().min(1).max(200).optional(),
  description_fr: z.string().max(2000).nullable().optional(),
  description_en: z.string().max(2000).nullable().optional(),
  visibility: z.enum(['public', 'premium_only', 'private']).optional(),
});

router.patch(
  '/playlists/:id',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
      return;
    }
    const exists = await prisma.officialPlaylist.findUnique({ where: { id: req.params.id } });
    if (!exists) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Playlist introuvable' } });
      return;
    }
    const playlist = await prisma.officialPlaylist.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    res.json({ playlist });
  },
);

// ───── POST /playlists/:id/resync — re-import depuis JSON source ─────────

router.post(
  '/playlists/:id/resync',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const playlist = await prisma.officialPlaylist.findUnique({
      where: { id: req.params.id },
      select: { slug: true },
    });
    if (!playlist) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Playlist introuvable' } });
      return;
    }
    try {
      const report = await processOneSlug(DEFAULT_PLAYLISTS_DIR, playlist.slug);
      res.json({ report });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      res.status(500).json({ error: { code: 'IMPORT_FAILED', message } });
    }
  },
);

// ───── POST /reimport — re-import toutes les playlists ───────────────────

router.post('/reimport', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await processAllFiles(DEFAULT_PLAYLISTS_DIR);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    res.status(500).json({ error: { code: 'IMPORT_FAILED', message } });
  }
});

export default router;
