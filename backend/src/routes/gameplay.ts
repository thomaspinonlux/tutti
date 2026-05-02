/**
 * Routes /api/sessions/:id/rounds/:roundId/* — boucle de jeu (host).
 *
 *   POST /play-track       (host) : démarre le track à current_track_index
 *   POST /next-track       (host) : avance au suivant (auto-end du round si plus de tracks)
 *   POST /skip-track       (host) : avance sans reveal (broadcast phase3-skipped d'abord)
 *   POST /give-answer      (host) : "Donner la réponse" — reveal artist+title, 0 pts
 *
 * Les routes joueur (/buzz, /voice-answer) sont définies dans
 * gameplayParticipant.ts (commit 3 — voice-first).
 *
 * Ces routes hôte permettent au créateur en mode B de piloter aussi depuis
 * l'iPad (footer maquette 06), pas seulement depuis son tel master.
 */

import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireWorkspace } from '../middleware/tenant.js';
import { broadcastToSession } from '../socket/index.js';
import { prisma } from '../lib/prisma.js';
import { restartActiveTrack } from '../lib/gameState.js';
import {
  advanceToNextOrEndRound,
  buildAndBroadcastTrack,
  findRoundForWorkspace,
  restartCurrentTrackAndBroadcast,
  revealCurrentTrack,
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

// ── POST /skip-track (host) ───────────────────────────────────────────────
// Broadcast track:phase_changed → phase3-skipped d'abord (les clients coupent
// proprement la lecture audio + n'affichent pas de reveal), puis avance.
// Mirror du /master/skip-track avec auth Supabase.

router.post(
  '/skip-track',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string; roundId: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const round = await findRoundForWorkspace(req.params.roundId, req.params.id, workspaceId);
    if (!round) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Round introuvable' } });
      return;
    }
    broadcastToSession(req.params.id, 'track:phase_changed', {
      round_id: req.params.roundId,
      phase: 'phase3-skipped',
    });
    const result = await advanceToNextOrEndRound(req.params.id, round);
    res.json(result);
  },
);

// ── POST /give-answer (host) ──────────────────────────────────────────────
// "Donner la réponse" — révèle artist+titre, 0 point, passe en phase3-revealed.
// La musique continue de jouer. Mirror du /master/give-answer avec auth Supabase.

router.post(
  '/give-answer',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string; roundId: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const round = await findRoundForWorkspace(req.params.roundId, req.params.id, workspaceId);
    if (!round) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Round introuvable' } });
      return;
    }
    const reveal = await revealCurrentTrack(req.params.id, req.params.roundId);
    if (!reveal) {
      res.status(409).json({
        error: {
          code: 'INVALID_PHASE',
          message: 'Le morceau ne peut être révélé que pendant les phases 1 ou 2',
        },
      });
      return;
    }
    res.json({ reveal });
  },
);

// ── POST /pause (host) ────────────────────────────────────────────────────
// Mirror de /master/pause avec auth Supabase (mode A iPad).

router.post(
  '/pause',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string; roundId: string }>, res: Response): Promise<void> => {
    try {
      const session = await prisma.session.update({
        where: { id: req.params.id },
        data: { is_paused: true },
      });
      broadcastToSession(req.params.id, 'session:paused', {
        session_id: session.id,
        requested_by: 'host',
      });
      res.json({ ok: true });
    } catch (err: unknown) {
      console.error('[POST host/pause] error:', err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur pause' } });
    }
  },
);

router.post(
  '/resume',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string; roundId: string }>, res: Response): Promise<void> => {
    try {
      const session = await prisma.session.update({
        where: { id: req.params.id },
        data: { is_paused: false },
      });
      broadcastToSession(req.params.id, 'session:resumed', { session_id: session.id });
      res.json({ ok: true });
    } catch (err: unknown) {
      console.error('[POST host/resume] error:', err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur reprise' } });
    }
  },
);

// ── POST /restart-track (host) ────────────────────────────────────────────
// Broadcast track:restart aux clients pour relancer l'audio à position_ms=0.

router.post(
  '/restart-track',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string; roundId: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const round = await findRoundForWorkspace(req.params.roundId, req.params.id, workspaceId);
    if (!round) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Round introuvable' } });
      return;
    }
    // Reset gameState + re-broadcast track:start (single source of truth).
    // Les clients voient un nouveau started_at → useSpotifyAudioSync seek(0)
    // ou play depuis URI inchangé. Plus d'event séparé track:restart.
    restartActiveTrack(req.params.roundId);
    const state = await restartCurrentTrackAndBroadcast(req.params.id, round);
    res.json({ ok: true, state });
  },
);

export default router;
