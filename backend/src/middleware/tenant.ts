/**
 * Middleware de tenant : récupère le workspace_id du user courant et
 * l'injecte dans la requête.
 *
 * À appliquer APRÈS `requireAuth`. En V1, un user a 1 seul workspace
 * (sa propre instance OWNER), donc on prend le premier trouvé.
 *
 * Renvoie 404 si l'utilisateur n'a pas encore de workspace
 * (cas après signup mais avant /api/auth/initialize).
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { prisma } from '../lib/prisma.js';
import { isSuperAdminEmail } from '../lib/superAdmin.js';

export const requireWorkspace: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Auth requise avant tenant' },
    });
    return;
  }

  try {
    const member = await prisma.workspaceMember.findFirst({
      where: { user_id: req.userId },
      orderBy: { created_at: 'asc' },
    });

    if (!member) {
      res.status(404).json({
        error: {
          code: 'NO_WORKSPACE',
          message: 'Aucun workspace pour cet utilisateur. Appelez /api/auth/initialize.',
        },
      });
      return;
    }

    // Phase 4 — gating Mode C : seuls les membres APPROVED passent.
    // Les super admins bypass (peuvent administrer même sans workspace approuvé).
    if (member.status !== 'APPROVED' && !isSuperAdminEmail(req.userEmail)) {
      const code = member.status === 'PENDING' ? 'ACCOUNT_PENDING' : 'ACCOUNT_REJECTED';
      const message =
        member.status === 'PENDING'
          ? 'Compte en attente de validation par un administrateur.'
          : 'Compte refusé. Contacte un administrateur.';
      res.status(403).json({ error: { code, message } });
      return;
    }

    req.workspaceId = member.workspace_id;
    next();
  } catch (err: unknown) {
    console.error('[tenant middleware] error:', err);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors de la résolution du workspace' },
    });
  }
};

/**
 * Phase 4 — middleware super admin only.
 *
 * À appliquer APRÈS `requireAuth`. Vérifie que l'email du user courant est
 * dans process.env.SUPER_ADMIN_EMAILS. Sinon 403.
 */
export const requireSuperAdmin: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!isSuperAdminEmail(req.userEmail)) {
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Réservé aux super admins.' },
    });
    return;
  }
  next();
};
