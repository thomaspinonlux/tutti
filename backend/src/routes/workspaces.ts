/**
 * Routes /api/workspaces — lecture des workspaces du user courant.
 *
 * Filtré par user_id via le middleware d'auth ; un user ne voit que
 * ses propres workspaces (V1 : un seul, V2+ : potentiellement plusieurs).
 */

import { Router, type Request, type Response } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
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
                active_providers: true,
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

// ── GET /api/workspaces/current/members ──────────────────────────────────
// Liste les membres du workspace de l'utilisateur courant (avec email Supabase
// résolu côté serveur via supabaseAdmin pour ne pas exposer les user_id).

router.get('/current/members', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'userId manquant' } });
    return;
  }
  try {
    const me = await prisma.workspaceMember.findFirst({
      where: { user_id: userId },
      select: { workspace_id: true },
    });
    if (!me) {
      res.json({ members: [] });
      return;
    }
    const members = await prisma.workspaceMember.findMany({
      where: { workspace_id: me.workspace_id },
      orderBy: { created_at: 'asc' },
    });
    // Résolution emails via Supabase Auth admin
    const enriched = await Promise.all(
      members.map(async (m) => {
        let email: string | null = null;
        try {
          const { data } = await supabaseAdmin.auth.admin.getUserById(m.user_id);
          email = data.user?.email ?? null;
        } catch {
          /* ignore */
        }
        return {
          id: m.id,
          role: m.role,
          email,
          created_at: m.created_at,
          is_me: m.user_id === userId,
        };
      }),
    );
    res.json({ members: enriched });
  } catch (err: unknown) {
    console.error('[GET /api/workspaces/current/members] error:', err);
    res
      .status(500)
      .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur récupération membres' } });
  }
});

export default router;
