/**
 * Middleware d'authentification "master participant".
 *
 * Lit `token` dans le body (pattern cohérent avec /buzz et /answer), vérifie
 * le JWT participant, vérifie qu'il correspond à la session URL ET que ce
 * participant a bien `is_master = true`. Place le contexte sur `req.master`.
 */

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { ParticipantRole } from '@tutti/shared';
import { isAnimatorRole } from '@tutti/shared';
import { verifyParticipantToken } from '../lib/participantToken.js';
import { prisma } from '../lib/prisma.js';

export interface MasterContext {
  participantId: string;
  sessionId: string;
  pseudo: string;
  teamId: string | null;
  /** feat/multi-animator-roles — rôle animateur du pilote (FULL ou PLAYING). */
  role: ParticipantRole;
}

// L'augmentation de Express.Request est faite globalement dans
// src/types/express.d.ts pour rester cohérente avec userId / workspaceId.

const tokenSchema = z.object({ token: z.string() });

export async function requireMasterParticipant(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = tokenSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'token requis dans le body' } });
    return;
  }
  let payload: { participant_id: string; session_id: string };
  try {
    payload = verifyParticipantToken(parsed.data.token);
  } catch {
    res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Token invalide' } });
    return;
  }
  if (payload.session_id !== req.params.id) {
    res.status(403).json({
      error: { code: 'WRONG_SESSION', message: 'Token / session ne correspond pas' },
    });
    return;
  }
  const participant = await prisma.participant.findUnique({
    where: { id: payload.participant_id },
    select: {
      id: true,
      pseudo: true,
      team_id: true,
      session_id: true,
      is_kicked: true,
      is_master: true,
      role: true,
    },
  });
  if (!participant || participant.is_kicked || participant.session_id !== req.params.id) {
    res
      .status(403)
      .json({ error: { code: 'PARTICIPANT_INVALID', message: 'Participant invalide' } });
    return;
  }
  // feat/multi-animator-roles — ouvert à tout rôle animateur (FULL ou PLAYING),
  // plus is_master pour rétro-compat (masters promus avant la migration rôle).
  const isAnimator = isAnimatorRole(participant.role) || participant.is_master;
  if (!isAnimator) {
    res.status(403).json({
      error: { code: 'NOT_MASTER', message: "Tu n'es pas l'animateur de cette session" },
    });
    return;
  }
  req.master = {
    participantId: participant.id,
    sessionId: req.params.id,
    pseudo: participant.pseudo,
    teamId: participant.team_id,
    // Si is_master sans rôle animateur (legacy), on le traite en ANIMATOR_PLAYING
    // (comportement historique = pilote qui joue). role reste la source de vérité.
    role: isAnimatorRole(participant.role) ? participant.role : 'ANIMATOR_PLAYING',
  };
  next();
}
