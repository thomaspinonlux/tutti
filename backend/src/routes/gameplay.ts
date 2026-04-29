/**
 * Routes /api/sessions/:id/rounds/:roundId/* — boucle de jeu (étape 10, Phase A).
 *
 *   POST /play-track       (host)         : démarre le track à current_track_index
 *   POST /next-track       (host)         : incrémente l'index, démarre le suivant
 *                                            (auto-end du round si plus de tracks)
 *   POST /buzz             (joueur)       : enregistre un buzz (1ᵉʳ arrivé seul autorisé)
 *   POST /answer           (joueur)       : valide la réponse (Phase A : simulation)
 *
 * Phase A = pas de Whisper, le joueur tape "Artiste seul" / "Artiste + titre" /
 * "Pas trouvé" sur son téléphone et c'est lui qui auto-déclare.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ScoreEventType } from '@prisma/client';
import type { BuzzResult } from '@tutti/shared';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireWorkspace } from '../middleware/tenant.js';
import { verifyParticipantToken } from '../lib/participantToken.js';
import { broadcastToSession } from '../socket/index.js';
import { getActiveTrack, setCooldown, tryBuzz } from '../lib/gameState.js';
import { computeBuzzPoints } from '../lib/gameScoring.js';
import {
  advanceToNextOrEndRound,
  buildAndBroadcastTrack,
  findRoundForWorkspace,
} from '../lib/gameplayCore.js';

const router: Router = Router({ mergeParams: true });

// ── POST /play-track (host) ───────────────────────────────────────────────

router.post(
  '/play-track',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string; roundId: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const round = await findRoundForWorkspace(req.params.roundId, req.params.id, workspaceId);
    if (!round) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Round introuvable' } });
      return;
    }
    if (round.status !== 'PLAYING') {
      res.status(409).json({ error: { code: 'INVALID_STATUS', message: 'Round pas en PLAYING' } });
      return;
    }
    const state = await buildAndBroadcastTrack(req.params.id, round, round.current_track_index);
    if (!state) {
      res.status(404).json({ error: { code: 'NO_TRACKS', message: 'Plus aucun track à jouer' } });
      return;
    }
    res.json({ state });
  },
);

// ── POST /next-track (host) ───────────────────────────────────────────────

router.post(
  '/next-track',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string; roundId: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const round = await findRoundForWorkspace(req.params.roundId, req.params.id, workspaceId);
    if (!round) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Round introuvable' } });
      return;
    }
    const result = await advanceToNextOrEndRound(req.params.id, round);
    res.json(result);
  },
);

// ── POST /buzz (joueur, auth via JWT participant) ─────────────────────────

const buzzSchema = z.object({ token: z.string() });

router.post(
  '/buzz',
  async (req: Request<{ id: string; roundId: string }>, res: Response): Promise<void> => {
    const parsed = buzzSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'token requis' } });
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
      res
        .status(403)
        .json({ error: { code: 'WRONG_SESSION', message: 'Token / session ne correspond pas' } });
      return;
    }

    // Vérifier que le participant existe et n'est pas kické
    const participant = await prisma.participant.findUnique({
      where: { id: payload.participant_id },
      select: { id: true, pseudo: true, is_kicked: true, session_id: true },
    });
    if (!participant || participant.is_kicked || participant.session_id !== req.params.id) {
      res
        .status(403)
        .json({ error: { code: 'PARTICIPANT_INVALID', message: 'Participant invalide' } });
      return;
    }

    const updated = tryBuzz(req.params.roundId, payload.participant_id);
    if (!updated) {
      res.status(409).json({
        error: { code: 'BUZZ_REJECTED', message: 'Quelqu’un a déjà buzzé ou phase incorrecte' },
      });
      return;
    }

    // Broadcast à tous : phase change pour 'buzzed'
    broadcastToSession(req.params.id, 'buzz:received', {
      round_id: updated.round_id,
      track_index: updated.track_index,
      participant_id: payload.participant_id,
      participant_pseudo: participant.pseudo,
      buzz_time_ms: updated.buzz_time_ms,
    });

    res.json({ ok: true, buzz_time_ms: updated.buzz_time_ms });
  },
);

// ── POST /answer (joueur — Phase A simulation) ────────────────────────────

const answerSchema = z.object({
  token: z.string(),
  matched_artist: z.boolean(),
  matched_title: z.boolean(),
});

router.post(
  '/answer',
  async (req: Request<{ id: string; roundId: string }>, res: Response): Promise<void> => {
    const parsed = answerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body invalide' } });
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
      res
        .status(403)
        .json({ error: { code: 'WRONG_SESSION', message: 'Token / session ne correspond pas' } });
      return;
    }

    const state = getActiveTrack(req.params.roundId);
    if (!state || state.phase !== 'buzzed' || state.buzzer_id !== payload.participant_id) {
      res.status(409).json({
        error: { code: 'NOT_YOUR_TURN', message: 'Tu n’as pas la main' },
      });
      return;
    }

    const participant = await prisma.participant.findUnique({
      where: { id: payload.participant_id },
      select: { id: true, pseudo: true, team_id: true, session_id: true },
    });
    if (!participant || participant.session_id !== req.params.id) {
      res
        .status(403)
        .json({ error: { code: 'PARTICIPANT_INVALID', message: 'Participant invalide' } });
      return;
    }

    const track = await prisma.track.findUnique({
      where: { id: state.track_id },
      select: { artist: true, title: true },
    });
    if (!track) {
      res.status(500).json({ error: { code: 'TRACK_LOST', message: 'Track introuvable' } });
      return;
    }

    const score = computeBuzzPoints(parsed.data);

    // Log scoring : un event ARTIST_FOUND si matched_artist, un event TITLE_BONUS si matched_title.
    // Même si rien n'est trouvé, on enregistre un event MANUAL_ADJUSTMENT à 0 pour traçabilité.
    if (score.matched_artist) {
      await prisma.scoreEvent.create({
        data: {
          session_id: req.params.id,
          session_round_id: req.params.roundId,
          participant_id: participant.id,
          team_id: participant.team_id,
          round_index: state.track_index,
          type: ScoreEventType.ARTIST_FOUND,
          points: score.artist_points,
          buzz_time_ms: state.buzz_time_ms,
          match_artist: true,
          match_title: score.matched_title,
        },
      });
      if (score.matched_title) {
        await prisma.scoreEvent.create({
          data: {
            session_id: req.params.id,
            session_round_id: req.params.roundId,
            participant_id: participant.id,
            team_id: participant.team_id,
            round_index: state.track_index,
            type: ScoreEventType.TITLE_BONUS,
            points: score.title_points,
            match_artist: true,
            match_title: true,
          },
        });
      }
    }

    setCooldown(req.params.roundId);

    const result: BuzzResult = {
      round_id: req.params.roundId,
      track_index: state.track_index,
      participant_id: participant.id,
      participant_pseudo: participant.pseudo,
      team_id: participant.team_id,
      matched_artist: score.matched_artist,
      matched_title: score.matched_title,
      artist_points: score.artist_points,
      title_points: score.title_points,
      total_points: score.total,
      reveal: { artist: track.artist, title: track.title },
    };
    broadcastToSession(req.params.id, 'buzz:result', result);

    res.json({ result });
  },
);

export default router;
