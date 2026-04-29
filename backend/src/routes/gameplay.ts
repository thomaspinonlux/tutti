/**
 * Routes /api/sessions/:id/rounds/:roundId/* — boucle de jeu (host).
 *
 *   POST /play-track       (host) : démarre le track à current_track_index
 *   POST /next-track       (host) : avance au suivant (auto-end du round si plus de tracks)
 *
 * Les routes joueur (/buzz, /voice-answer) sont définies dans
 * gameplayParticipant.ts (commit 3 — voice-first).
 */

import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireWorkspace } from '../middleware/tenant.js';
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

export default router;
