/**
 * Middleware d'authentification : extrait le JWT du header Authorization,
 * le valide via Supabase Auth, et injecte `userId` + `userEmail` dans la requête.
 *
 * Utilisation:
 *   router.get('/me', requireAuth, (req, res) => { ... req.userId ... })
 *
 * Renvoie 401 si le token est absent, invalide ou expiré.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { prisma } from '../lib/prisma.js';

export const requireAuth: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Token manquant ou format invalide' },
    });
    return;
  }

  const token = header.substring('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Token vide' },
    });
    return;
  }

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) {
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Token invalide ou expiré' },
      });
      return;
    }
    req.userId = data.user.id;
    req.userEmail = data.user.email ?? undefined;
    // feat/admin-users-and-email-notifications — block check + last_seen
    // bump. Si user bloqué par super-admin → 403 imméd. Sinon update
    // last_seen_at fire-and-forget (pas await pour pas freiner les routes).
    try {
      const member = await prisma.workspaceMember.findFirst({
        where: { user_id: data.user.id },
        select: { id: true, is_blocked: true },
      });
      if (member?.is_blocked) {
        res.status(403).json({
          error: {
            code: 'ACCOUNT_SUSPENDED',
            message: 'Compte suspendu, contactez le support',
          },
        });
        return;
      }
      if (member) {
        // Best-effort, ne bloque pas le request flow.
        void prisma.workspaceMember
          .update({ where: { id: member.id }, data: { last_seen_at: new Date() } })
          .catch(() => {});
      }
    } catch (err) {
      // Sécurité : si la check échoue (DB indispo), on laisse passer
      // pour ne pas locker tous les users sur un incident DB.
      console.warn('[auth middleware] block check failed (non-blocking):', err);
    }
    next();
  } catch (err: unknown) {
    console.error('[auth middleware] error:', err);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors de la validation du token' },
    });
  }
};
