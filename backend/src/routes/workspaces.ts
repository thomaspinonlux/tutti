/**
 * Routes /api/workspaces — lecture des workspaces du user courant.
 *
 * Filtré par user_id via le middleware d'auth ; un user ne voit que
 * ses propres workspaces (V1 : un seul, V2+ : potentiellement plusieurs).
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router: Router = Router();

router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'userId manquant' } });
    return;
  }

  try {
    const memberships = await prisma.workspaceMember.findMany({
      where: { user_id: userId },
      include: {
        workspace: {
          include: {
            establishments: {
              select: {
                id: true,
                name: true,
                default_language: true,
                active_provider: true,
              },
            },
          },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    const workspaces = memberships.map((m) => ({
      ...m.workspace,
      role: m.role,
    }));

    res.json({ workspaces });
  } catch (err: unknown) {
    console.error('[GET /api/workspaces] error:', err);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors de la récupération des workspaces' },
    });
  }
});

export default router;
