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
import { isSuperAdminEmail } from '../lib/superAdmin.js';
import { reserverCompteApple, ParcCompletError } from '../lib/parcComptesApple.js';
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
// fix/jeton-apple-expose — CETTE ROUTE EXIGE DÉSORMAIS UNE AUTHENTIFICATION.
// Elle renvoie le Music User Token du compte Apple Music du patron, valable
// 180 jours et non révocable côté serveur. Elle était ouverte : il suffisait de
// lire le code TV affiché sur les tables du bar pour obtenir l'identifiant du
// workspace (route /api/tv/:code, publique), puis le jeton. Le seul appelant
// est la console de l'animateur, qui est authentifiée — le nom « public » est
// resté pour ne pas casser l'adresse, mais la porte est fermée.
router.get(
  '/token-public/:workspaceId',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ workspaceId: string }>, res: Response): Promise<void> => {
    const workspaceId = req.params.workspaceId;
    // Un compte authentifié ne peut lire que le jeton de SON espace.
    if (req.workspaceId !== workspaceId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Espace non autorisé' } });
      return;
    }
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
      // feat/parc-comptes-apple — LE PARC PASSE D'ABORD.
      //
      // Un abonnement Apple Music ne porte qu'un flux : si un parc de comptes
      // partagés existe, la session en réserve un pour elle seule, ce qui permet
      // N soirées en parallèle. Sans parc (ou parc vide), on retombe sur le
      // compte connecté à l'espace, comportement d'origine inchangé.
      let musicUserToken: string | null = null;
      let expireLe: Date | null = null;
      try {
        // feat/reservation-de-creneaux — une partie CLIENT ne prend jamais le
        // dernier compte libre : il reste à la brasserie.
        const membre = await prisma.workspaceMember.findFirst({
          where: { user_id: req.userId, workspace_id: workspaceId },
          select: { role: true },
        });
        const estClient = membre?.role === 'CLIENT' && !isSuperAdminEmail(req.userEmail);
        const compte = await reserverCompteApple(session.id, { garderUnPourLeProprietaire: estClient });
        musicUserToken = compte.music_user_token;
        console.info(
          `[Apple] session=${session.id} → compte du parc « ${compte.libelle} » réservé`,
        );
      } catch (err: unknown) {
        if (err instanceof ParcCompletError) {
          // Parc existant mais saturé : on refuse clairement plutôt que de
          // couper le son d'une partie déjà en cours.
          if (err.comptesTotal > 0 || err.gardePourProprietaire) {
            res.status(409).json({ error: { code: err.code, message: err.message } });
            return;
          }
          // comptesTotal === 0 → aucun parc configuré : repli historique.
        } else {
          throw err;
        }
      }
      if (!musicUserToken) {
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
        musicUserToken = cred.access_token;
        expireLe = cred.expires_at;
      }
      const { token, expiresAt } = getAppleDeveloperToken();
      res.set('Cache-Control', 'no-store');
      res.json({
        developer_token: token,
        developer_token_expires_at: expiresAt.toISOString(),
        music_user_token: musicUserToken,
        music_user_token_expires_at: expireLe?.toISOString() ?? null,
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
