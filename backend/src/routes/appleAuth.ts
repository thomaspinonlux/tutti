/**
 * Routes /api/auth/apple/* — connexion Apple Music (MusicKit).
 *
 * Modèle différent de Spotify : PAS de redirect OAuth serveur. Le "Music User
 * Token" est obtenu CÔTÉ NAVIGATEUR via MusicKit.authorize() (le host se logue
 * avec son Apple ID abonné), puis POSTé ici pour persistance.
 *
 *   GET    /developer-token        (auth) → { token, expires_at }
 *       JWT app-level pour initialiser MusicKit JS + appeler l'Apple Music API.
 *   GET    /status                 (auth) → { connected, expires_at, connected_at }
 *   POST   /connect                (auth) → persiste le Music User Token
 *   DELETE /disconnect             (auth) → supprime les credentials
 *   GET    /token-public/:wsId     (public, gated session active) → tokens pour la TV
 *
 * Étape 3 : token + login + persistance. La LECTURE (MusicKit JS) = étape 4.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import {
  AppleTokenError,
  getAppleDeveloperToken,
  isAppleMusicConfigured,
} from '../lib/appleDeveloperToken.js';
import { requireAuth } from '../middleware/auth.js';
import { requireWorkspace } from '../middleware/tenant.js';

const router: Router = Router();

/** Durée de validité présumée d'un Music User Token (~6 mois). Au-delà, on
 *  demande à l'utilisateur de reconnecter (pas de refresh chez Apple). */
const USER_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 180;

function developerTokenResponse(res: Response): void {
  try {
    const { token, expiresAt } = getAppleDeveloperToken();
    res.set('Cache-Control', 'no-store');
    res.json({ token, expires_at: expiresAt.toISOString() });
  } catch (err: unknown) {
    if (err instanceof AppleTokenError) {
      res.status(503).json({ error: { code: err.code, message: err.message } });
      return;
    }
    console.error('[apple developer-token] error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur token Apple' } });
  }
}

// ───── GET /developer-token ────────────────────────────────────────────────
router.get('/developer-token', requireAuth, requireWorkspace, (_req: Request, res: Response) => {
  developerTokenResponse(res);
});

// ───── GET /status ─────────────────────────────────────────────────────────
router.get(
  '/status',
  requireAuth,
  requireWorkspace,
  async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth requise' } });
      return;
    }
    try {
      const cred = await prisma.musicProviderCredential.findUnique({
        where: { workspace_id_provider: { workspace_id: workspaceId, provider: 'apple_music' } },
        select: { expires_at: true, created_at: true, account_email: true },
      });
      const expired = cred?.expires_at ? cred.expires_at.getTime() < Date.now() : false;
      res.json({
        connected: !!cred && !expired,
        configured: isAppleMusicConfigured(),
        account_email: cred?.account_email ?? null,
        expires_at: cred?.expires_at ?? null,
        connected_at: cred?.created_at ?? null,
      });
    } catch (err: unknown) {
      console.error('[apple status] error:', err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur statut Apple' } });
    }
  },
);

// ───── POST /connect ───────────────────────────────────────────────────────
const connectSchema = z.object({ music_user_token: z.string().trim().min(10).max(8192) });

router.post(
  '/connect',
  requireAuth,
  requireWorkspace,
  async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth requise' } });
      return;
    }
    const parsed = connectSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: { code: 'VALIDATION_ERROR', message: 'music_user_token invalide' } });
      return;
    }
    try {
      const expiresAt = new Date(Date.now() + USER_TOKEN_TTL_MS);
      await prisma.musicProviderCredential.upsert({
        where: { workspace_id_provider: { workspace_id: workspaceId, provider: 'apple_music' } },
        create: {
          workspace_id: workspaceId,
          provider: 'apple_music',
          // Apple : le Music User Token joue le rôle d'access_token ; pas de
          // refresh_token (on re-authorize côté client à l'expiration).
          access_token: parsed.data.music_user_token,
          refresh_token: null,
          expires_at: expiresAt,
          account_email: null,
        },
        update: {
          access_token: parsed.data.music_user_token,
          refresh_token: null,
          expires_at: expiresAt,
        },
      });
      res.json({ ok: true, expires_at: expiresAt.toISOString() });
    } catch (err: unknown) {
      console.error('[apple connect] error:', err);
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur connexion Apple' } });
    }
  },
);

// ───── DELETE /disconnect ──────────────────────────────────────────────────
router.delete(
  '/disconnect',
  requireAuth,
  requireWorkspace,
  async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth requise' } });
      return;
    }
    try {
      await prisma.musicProviderCredential.deleteMany({
        where: { workspace_id: workspaceId, provider: 'apple_music' },
      });
      const ests = await prisma.establishment.findMany({
        where: { workspace_id: workspaceId },
        select: { id: true, active_providers: true },
      });
      for (const e of ests) {
        const without = e.active_providers.filter((p) => p !== 'apple_music');
        const next = without.length > 0 ? without : ['demo'];
        await prisma.establishment.update({
          where: { id: e.id },
          data: { active_providers: next },
        });
      }
      res.json({ ok: true });
    } catch (err: unknown) {
      console.error('[apple disconnect] error:', err);
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur déconnexion Apple' } });
    }
  },
);

// ───── GET /token-public/:workspaceId ──────────────────────────────────────
// Pour la TV ouverte via tv_code (sans cookies admin). Gate : session active
// dans le workspace (même modèle que Spotify token-public). Renvoie developer
// token + music user token pour que MusicKit JS lise sur la TV.
router.get(
  '/token-public/:workspaceId',
  async (req: Request<{ workspaceId: string }>, res: Response): Promise<void> => {
    const workspaceId = req.params.workspaceId;
    try {
      const session = await prisma.session.findFirst({
        where: {
          establishment: { workspace_id: workspaceId },
          status: { in: ['WAITING', 'PLAYING'] },
        },
        select: { id: true },
      });
      if (!session) {
        res
          .status(404)
          .json({ error: { code: 'NO_ACTIVE_SESSION', message: 'Aucune session active' } });
        return;
      }
      const cred = await prisma.musicProviderCredential.findUnique({
        where: { workspace_id_provider: { workspace_id: workspaceId, provider: 'apple_music' } },
        select: { access_token: true, expires_at: true },
      });
      if (!cred) {
        res
          .status(409)
          .json({ error: { code: 'NOT_CONNECTED', message: 'Apple Music non connecté' } });
        return;
      }
      const { token, expiresAt } = getAppleDeveloperToken();
      res.set('Cache-Control', 'no-store');
      res.json({
        developer_token: token,
        developer_token_expires_at: expiresAt.toISOString(),
        music_user_token: cred.access_token,
        music_user_token_expires_at: cred.expires_at?.toISOString() ?? null,
      });
    } catch (err: unknown) {
      if (err instanceof AppleTokenError) {
        res.status(503).json({ error: { code: err.code, message: err.message } });
        return;
      }
      console.error('[apple token-public] error:', err);
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur token Apple (TV)' } });
    }
  },
);

export default router;
