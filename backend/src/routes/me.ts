/**
 * GET /api/me — retourne l'utilisateur courant + son workspace + son establishment.
 *
 * Utilisé par le frontend au boot pour bootstrap l'app.
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
    const member = await prisma.workspaceMember.findFirst({
      where: { user_id: userId },
      include: {
        workspace: {
          include: {
            establishments: {
              orderBy: { created_at: 'asc' },
            },
          },
        },
      },
    });

    res.json({
      user: {
        id: userId,
        email: req.userEmail ?? null,
      },
      workspace: member?.workspace ?? null,
      role: member?.role ?? null,
      hasWorkspace: !!member,
    });
  } catch (err: unknown) {
    console.error('[GET /api/me] error:', err);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors de la récupération du profil' },
    });
  }
});

export default router;
