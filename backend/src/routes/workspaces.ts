/**
 * Routes /api/workspaces — étape 2 (lecture seulement, sans auth pour l'instant).
 *
 * À l'étape 3, on ajoutera le middleware d'auth Supabase qui injectera
 * `req.userId`, et on filtrera les workspaces par membership.
 *
 * Pour l'étape 2, on liste tous les workspaces (mode service-role) afin
 * de valider que la chaîne DB → Prisma → Express → JSON fonctionne.
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.js';

const router: Router = Router();

router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const workspaces = await prisma.workspace.findMany({
      orderBy: { created_at: 'asc' },
      include: {
        establishments: {
          select: {
            id: true,
            name: true,
            default_language: true,
            active_provider: true,
          },
        },
        members: {
          select: {
            id: true,
            user_id: true,
            role: true,
          },
        },
      },
    });

    res.json({ workspaces });
  } catch (err: unknown) {
    console.error('[GET /api/workspaces] error:', err);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur interne lors de la récupération des workspaces',
      },
    });
  }
});

export default router;
