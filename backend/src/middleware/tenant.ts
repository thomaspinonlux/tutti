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

    req.workspaceId = member.workspace_id;
    next();
  } catch (err: unknown) {
    console.error('[tenant middleware] error:', err);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors de la résolution du workspace' },
    });
  }
};
