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
    next();
  } catch (err: unknown) {
    console.error('[auth middleware] error:', err);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors de la validation du token' },
    });
  }
};
