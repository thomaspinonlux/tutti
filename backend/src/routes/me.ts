/**
 * GET /api/me — retourne l'utilisateur courant + son workspace + son establishment.
 *
 * Utilisé par le frontend au boot pour bootstrap l'app.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { isSuperAdminEmail } from '../lib/superAdmin.js';
import { isSpotifyAllowlisted } from '../lib/spotifyAllowlist.js';

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
      referral_code: member?.referral_code ?? null,
      hasWorkspace: !!member,
      // Phase 4 — exposer status + isSuperAdmin pour gating frontend
      memberStatus: member?.status ?? null,
      isSuperAdmin: isSuperAdminEmail(req.userEmail),
      // fix/disable-spotify-sdk-non-allowlist — gating chargement Spotify
      // SDK côté frontend. false par défaut → useSpotifyPlayer skip
      // entièrement, aucun script chargé, aucun appel /api/providers/spotify.
      spotify_allowlist: isSpotifyAllowlisted(req.userEmail),
      // feat/granular-tracks-quizz-access — flags par user pour gater
      // l'UI dashboard host. Backend renvoie 403 sur création de session
      // si flag false (defense in depth). Défaut true si pas de member.
      can_use_tracks: member?.can_use_tracks ?? true,
      can_use_quizz: member?.can_use_quizz ?? true,
    });
  } catch (err: unknown) {
    console.error('[GET /api/me] error:', err);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors de la récupération du profil' },
    });
  }
});

/**
 * Phase 4e — POST /api/me/redeem-invitation
 *
 * Permet à un user PENDING (déjà inscrit, pas encore validé) d'utiliser un
 * code invitation pour basculer son membership en APPROVED, sans avoir à
 * tout recréer.
 */
const redeemSchema = z.object({
  invitationCode: z.string().trim().toUpperCase().min(4).max(16),
});

router.post(
  '/redeem-invitation',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    if (!req.userId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'userId manquant' } });
      return;
    }
    const parsed = redeemSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: { code: 'VALIDATION_ERROR', message: 'invitationCode requis' } });
      return;
    }
    const member = await prisma.workspaceMember.findFirst({
      where: { user_id: req.userId },
    });
    if (!member) {
      res.status(404).json({ error: { code: 'NO_WORKSPACE', message: 'Pas de membership' } });
      return;
    }
    if (member.status === 'APPROVED') {
      res.json({ ok: true, alreadyApproved: true });
      return;
    }
    const code = await prisma.invitationCode.findUnique({
      where: { code: parsed.data.invitationCode },
    });
    if (
      !code ||
      (code.expires_at && code.expires_at <= new Date()) ||
      (code.max_uses && code.uses_count >= code.max_uses)
    ) {
      res
        .status(400)
        .json({ error: { code: 'INVALID_CODE', message: 'Code invitation invalide ou expiré' } });
      return;
    }
    // Approuver le membre + consommer le code (transaction)
    await prisma.$transaction([
      prisma.workspaceMember.update({
        where: { id: member.id },
        data: {
          status: 'APPROVED',
          approved_at: new Date(),
          invitation_code_used: code.code,
        },
      }),
      prisma.invitationCode.update({
        where: { id: code.id },
        data: {
          uses_count: { increment: 1 },
          first_used_at: code.first_used_at ?? new Date(),
        },
      }),
    ]);
    res.json({ ok: true });
  },
);

export default router;
