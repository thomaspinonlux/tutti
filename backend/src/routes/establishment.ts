/**
 * Routes /api/establishment — l'établissement courant du user (V1 : 1 par workspace).
 *
 * - GET    /api/establishment        : retourne l'establishment courant
 * - PATCH  /api/establishment        : édite name, branding_color, default_language,
 *                                       active_provider, branding_logo URL
 *
 * Tous les champs sont optionnels dans le PATCH (partial update). Le contrôle
 * tenant (workspace_id) passe par requireAuth + requireWorkspace.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireWorkspace } from '../middleware/tenant.js';

const router: Router = Router();

router.use(requireAuth, requireWorkspace);

const patchBodySchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  branding_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/u, { message: 'Format attendu : #RRGGBB' })
    .nullable()
    .optional(),
  branding_logo: z.string().url().nullable().optional(),
  default_language: z.enum(['fr', 'en']).optional(),
  /**
   * Phase 3.5+ — sources musicales actives (multi-select). Au moins une
   * source. Le premier élément sert de provider par défaut pour les routes
   * sans paramètre explicite (ex: TrackSearch quand 1 seule source active).
   */
  active_providers: z
    .array(z.enum(['demo', 'spotify', 'youtube', 'deezer', 'apple_music']))
    .min(1, { message: 'Au moins une source doit être sélectionnée' })
    .max(5)
    .optional(),
});

router.get('/', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'workspaceId manquant' } });
    return;
  }

  try {
    const establishment = await prisma.establishment.findFirst({
      where: { workspace_id: workspaceId },
      orderBy: { created_at: 'asc' },
    });
    if (!establishment) {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Aucun établissement pour ce workspace' },
      });
      return;
    }
    res.json({ establishment });
  } catch (err: unknown) {
    console.error('[GET /api/establishment] error:', err);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: "Erreur lors de la récupération de l'établissement",
      },
    });
  }
});

router.patch('/', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'workspaceId manquant' } });
    return;
  }

  const parsed = patchBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Body invalide',
        details: parsed.error.flatten(),
      },
    });
    return;
  }

  try {
    const existing = await prisma.establishment.findFirst({
      where: { workspace_id: workspaceId },
      orderBy: { created_at: 'asc' },
    });
    if (!existing) {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Aucun établissement à mettre à jour' },
      });
      return;
    }

    const updated = await prisma.establishment.update({
      where: { id: existing.id },
      data: parsed.data,
    });

    res.json({ establishment: updated });
  } catch (err: unknown) {
    console.error('[PATCH /api/establishment] error:', err);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: "Erreur lors de la mise à jour de l'établissement",
      },
    });
  }
});

export default router;
