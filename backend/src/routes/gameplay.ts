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
import type { RoundProgramItem, RoundProgramResponse, RoundStatus } from '@tutti/shared';
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

// ── GET /program (host) ───────────────────────────────────────────────────
// Phase 2.1 : panel "Programme manche" — liste ordonnée des tracks de la
// manche avec statut PLAYED/CURRENT/UPCOMING. Lecture seule, pas de broadcast.

router.get(
  '/program',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string; roundId: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const round = await findRoundForWorkspace(req.params.roundId, req.params.id, workspaceId);
    if (!round) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Round introuvable' } });
      return;
    }
    const currentIdx = round.current_track_index;
    // feat/playlist-pool-random-selection — projection sur le subset
    // selected_track_ids si défini, sinon fallback playlist complète.
    const selected = round.selected_track_ids ?? [];
    let orderedTracks: typeof round.playlist.playlist_tracks;
    if (selected.length > 0) {
      const lookup = new Map(round.playlist.playlist_tracks.map((pt) => [pt.track.id, pt]));
      orderedTracks = selected
        .map((tid) => lookup.get(tid))
        .filter((pt): pt is NonNullable<typeof pt> => pt !== undefined);
    } else {
      orderedTracks = round.playlist.playlist_tracks;
    }
    const tracks: RoundProgramItem[] = orderedTracks.map((pt, idx) => ({
      position: idx,
      track_id: pt.track.id,
      artist: pt.track.artist.canonical_name,
      title: pt.track.canonical_title,
      year: pt.track.year,
      cover_url: pt.track.cover_url,
      duration_ms: pt.track.duration_ms,
      status:
        idx < currentIdx
          ? 'PLAYED'
          : idx === currentIdx && round.status === 'PLAYING'
            ? 'CURRENT'
            : 'UPCOMING',
    }));
    const body: RoundProgramResponse = {
      round_id: round.id,
      round_status: round.status as RoundStatus,
      current_track_index: currentIdx,
      total_tracks: tracks.length,
      tracks,
    };
    res.json(body);
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

// ── GET /results (host) ───────────────────────────────────────────────────
//
// feat/round-end-rankings — résultats de fin de manche pour
// RoundIntermissionScreen. Retourne 3 classements basés sur ScoreEvent :
//   - round_ranking      : points cumulés PAR PARTICIPANT pour ce round
//                          uniquement (filter session_round_id = roundId)
//   - cumulative_ranking : points cumulés depuis le début de la session
//                          (toutes manches confondues)
//   - fastest_player     : participant avec la meilleure moyenne de
//                          buzz_time_ms sur le round (min 1 buzz pour
//                          être éligible)
//
// Ne dépend pas d'une éventuelle migration : ScoreEvent.buzz_time_ms +
// session_round_id existent déjà depuis la migration initiale.

router.get(
  '/results',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string; roundId: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const sessionId = req.params.id;
    const roundId = req.params.roundId;
    const round = await findRoundForWorkspace(roundId, sessionId, workspaceId);
    if (!round) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Round introuvable' } });
      return;
    }
    // Participants de la session (pour pseudo / team / color).
    const participants = await prisma.participant.findMany({
      where: { session_id: sessionId },
      select: { id: true, pseudo: true, team_id: true, is_kicked: true },
    });
    const pseudoById = new Map(participants.map((p) => [p.id, p.pseudo]));

    // 1. Round ranking : SUM(points) GROUP BY participant_id WHERE session_round_id = X
    const roundAggregate = await prisma.scoreEvent.groupBy({
      by: ['participant_id'],
      where: { session_round_id: roundId, session_id: sessionId },
      _sum: { points: true },
    });
    const round_ranking = roundAggregate
      .map((r) => ({
        participant_id: r.participant_id,
        pseudo: pseudoById.get(r.participant_id) ?? '?',
        points: r._sum.points ?? 0,
      }))
      .sort((a, b) => b.points - a.points)
      .map((r, idx) => ({ ...r, rank: idx + 1 }));

    // 2. Cumulative ranking : SUM(points) GROUP BY participant_id WHERE session_id = X
    const cumulAggregate = await prisma.scoreEvent.groupBy({
      by: ['participant_id'],
      where: { session_id: sessionId },
      _sum: { points: true },
    });
    const cumulative_ranking = cumulAggregate
      .map((r) => ({
        participant_id: r.participant_id,
        pseudo: pseudoById.get(r.participant_id) ?? '?',
        total_points: r._sum.points ?? 0,
      }))
      .sort((a, b) => b.total_points - a.total_points)
      .map((r, idx) => ({ ...r, rank: idx + 1 }));

    // 3. Fastest player du round : avg buzz_time_ms le plus bas + count
    //    des "premiers buzz" (positions = 1). Doit avoir au moins 1 buzz.
    const buzzEvents = await prisma.scoreEvent.findMany({
      where: {
        session_round_id: roundId,
        session_id: sessionId,
        buzz_time_ms: { not: null },
      },
      select: {
        participant_id: true,
        buzz_time_ms: true,
        round_index: true,
      },
    });
    // Group by participant : avg buzz_time + count first buzzes (track-level).
    type FastStat = {
      participant_id: string;
      total_ms: number;
      count: number;
      first_buzz_count: number;
    };
    const fastByPid = new Map<string, FastStat>();
    // first_buzz_count = nb de track_index où le participant a le buzz_time min
    const minBuzzByTrack = new Map<number, number>();
    for (const ev of buzzEvents) {
      if (ev.buzz_time_ms == null) continue;
      const cur = minBuzzByTrack.get(ev.round_index);
      if (cur === undefined || ev.buzz_time_ms < cur) {
        minBuzzByTrack.set(ev.round_index, ev.buzz_time_ms);
      }
    }
    for (const ev of buzzEvents) {
      if (ev.buzz_time_ms == null) continue;
      const cur = fastByPid.get(ev.participant_id) ?? {
        participant_id: ev.participant_id,
        total_ms: 0,
        count: 0,
        first_buzz_count: 0,
      };
      cur.total_ms += ev.buzz_time_ms;
      cur.count += 1;
      if (minBuzzByTrack.get(ev.round_index) === ev.buzz_time_ms) {
        cur.first_buzz_count += 1;
      }
      fastByPid.set(ev.participant_id, cur);
    }
    const fastestList = Array.from(fastByPid.values())
      .map((s) => ({
        participant_id: s.participant_id,
        pseudo: pseudoById.get(s.participant_id) ?? '?',
        avg_buzz_ms: Math.round(s.total_ms / s.count),
        first_buzz_count: s.first_buzz_count,
        buzz_count: s.count,
      }))
      .sort((a, b) => b.first_buzz_count - a.first_buzz_count || a.avg_buzz_ms - b.avg_buzz_ms);
    const fastest_player = fastestList.length > 0 ? fastestList[0] : null;

    res.json({
      round_id: roundId,
      round_position: round.position,
      round_ranking,
      cumulative_ranking,
      fastest_player,
    });
  },
);

export default router;
