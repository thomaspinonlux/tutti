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
import type { CurrentTrackState, BuzzResult } from '@tutti/shared';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireWorkspace } from '../middleware/tenant.js';
import { verifyParticipantToken } from '../lib/participantToken.js';
import { broadcastToSession } from '../socket/index.js';
import {
  clearActiveTrack,
  getActiveTrack,
  setActiveTrack,
  setCooldown,
  tryBuzz,
} from '../lib/gameState.js';
import { computeBuzzPoints } from '../lib/gameScoring.js';

const router: Router = Router({ mergeParams: true });

const LISTEN_DURATION_MS = 30_000; // 30s par défaut pour V1

// ── Helpers ───────────────────────────────────────────────────────────────

async function ensureOwnRound(roundId: string, sessionId: string, workspaceId: string) {
  return prisma.sessionRound.findFirst({
    where: {
      id: roundId,
      session_id: sessionId,
      session: { establishment: { workspace_id: workspaceId } },
    },
    include: { playlist: { include: { tracks: { orderBy: { position: 'asc' } } } } },
  });
}

async function buildAndBroadcastTrack(
  sessionId: string,
  round: Awaited<ReturnType<typeof ensureOwnRound>>,
  trackIndex: number,
): Promise<CurrentTrackState | null> {
  if (!round) return null;
  const track = round.playlist.tracks[trackIndex];
  if (!track) return null;

  const state: CurrentTrackState = {
    round_id: round.id,
    track_index: trackIndex,
    track_id: track.id,
    provider: track.provider as CurrentTrackState['provider'],
    provider_track_id: track.provider_track_id,
    artist: track.artist,
    title: track.title,
    album: track.album,
    year: track.year,
    cover_url: track.cover_url,
    started_at: new Date().toISOString(),
    duration_ms: LISTEN_DURATION_MS,
    phase: 'listening',
    buzzer_id: null,
    buzzer_pseudo: null,
  };

  setActiveTrack(round.id, {
    round_id: round.id,
    track_index: trackIndex,
    track_id: track.id,
    started_at: Date.now(),
    phase: 'listening',
    buzzer_id: null,
    buzz_time_ms: null,
  });

  await prisma.sessionRound.update({
    where: { id: round.id },
    data: { current_track_index: trackIndex },
  });

  broadcastToSession(sessionId, 'track:start', { state });
  return state;
}

// ── POST /play-track (host) ───────────────────────────────────────────────

router.post(
  '/play-track',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string; roundId: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const round = await ensureOwnRound(req.params.roundId, req.params.id, workspaceId);
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
    const round = await ensureOwnRound(req.params.roundId, req.params.id, workspaceId);
    if (!round) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Round introuvable' } });
      return;
    }
    const nextIndex = round.current_track_index + 1;
    if (nextIndex >= round.playlist.tracks.length) {
      // Plus de tracks → auto-end du round
      await prisma.sessionRound.update({
        where: { id: round.id },
        data: { status: 'ENDED', ended_at: new Date() },
      });
      clearActiveTrack(round.id);
      const updatedRound = await prisma.sessionRound.findUnique({
        where: { id: round.id },
        include: {
          playlist: {
            select: { id: true, name: true, level: true, _count: { select: { tracks: true } } },
          },
        },
      });
      const enriched = updatedRound && {
        ...updatedRound,
        playlist: {
          id: updatedRound.playlist.id,
          name: updatedRound.playlist.name,
          level: updatedRound.playlist.level,
          tracks_count: updatedRound.playlist._count.tracks,
        },
      };
      broadcastToSession(req.params.id, 'round:ended', { round: enriched });
      res.json({ ended: true, round: enriched });
      return;
    }
    const state = await buildAndBroadcastTrack(req.params.id, round, nextIndex);
    res.json({ state });
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
