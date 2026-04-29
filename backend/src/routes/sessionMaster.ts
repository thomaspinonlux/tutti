/**
 * Routes /api/sessions/:id/master/* — pilotage de la session par le joueur
 * désigné master (mode B "Sans animateur"). Utile aussi en mode A pour
 * éventuellement déléguer un sous-pouvoir, mais le pilotage principal mode A
 * reste sur l'iPad/Mac via les routes host.
 *
 *   POST /next-track      : avance au morceau suivant (depuis cooldown)
 *   POST /skip-track      : avance au morceau suivant (depuis listening/buzzed,
 *                            cancel buzz éventuel sans score)
 *   POST /reveal          : "Réponse" — révèle artist+titre, 0 point
 *   POST /pause           : flip is_paused = true, broadcast session:paused
 *   POST /resume          : flip is_paused = false, broadcast session:resumed
 *   POST /end-round       : termine le round PLAYING
 *   POST /end-session     : termine toute la session (avec podium)
 *   POST /pick-round      : crée + démarre + lance le 1ᵉʳ track d'une playlist
 *                            (combine create-round + start-round + play-track)
 *   POST /adjust-points   : ajuste les points d'un participant (silencieux,
 *                            pas de broadcast public — seul le score se met
 *                            à jour, transparent pour les joueurs)
 *
 * Auth : middleware requireMasterParticipant (token participant + is_master).
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Prisma, RoundStatus, ScoreEventType } from '@prisma/client';
import type { GameMode, Team } from '@tutti/shared';
import { prisma } from '../lib/prisma.js';
import { requireMasterParticipant } from '../middleware/master.js';
import { broadcastToSession } from '../socket/index.js';
import { clearActiveTrack, getActiveTrack } from '../lib/gameState.js';
import { getCumulativeScores } from '../lib/scores.js';
import {
  advanceToNextOrEndRound,
  buildAndBroadcastTrack,
  endRoundInternal,
  findRoundForSession,
  revealCurrentTrack,
} from '../lib/gameplayCore.js';

const router: Router = Router({ mergeParams: true });

// Toutes les routes sont protégées par le middleware master.
router.use(requireMasterParticipant);

// ── Schemas ───────────────────────────────────────────────────────────────

const roundIdSchema = z.object({ token: z.string(), round_id: z.string().uuid() });
const pickRoundSchema = z.object({ token: z.string(), playlist_id: z.string().uuid() });
const adjustPointsSchema = z.object({
  token: z.string(),
  target_participant_id: z.string().uuid(),
  delta: z.number().int().min(-1000).max(1000),
  reason: z.string().max(200).optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────

const PLAYLIST_LIGHT = {
  id: true,
  name: true,
  level: true,
  _count: { select: { playlist_tracks: true } },
} as const;

function enrichRound<
  R extends {
    playlist: { id: string; name: string; level: string; _count: { playlist_tracks: number } };
  },
>(round: R) {
  return {
    ...round,
    playlist: {
      id: round.playlist.id,
      name: round.playlist.name,
      level: round.playlist.level,
      tracks_count: round.playlist._count.playlist_tracks,
    },
  };
}

// ── POST /scores ──────────────────────────────────────────────────────────
// Renvoie la cumulative de la session pour que le master puisse voir les
// totaux courants quand il ouvre le panneau d'ajustement de points.

router.post('/scores', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const session = await prisma.session.findUnique({
    where: { id: req.params.id },
    include: { participants: { where: { is_kicked: false } } },
  });
  if (!session) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
    return;
  }
  const teams = (session.teams_config as Team[] | null) ?? null;
  const cumulative = await getCumulativeScores({
    sessionId: session.id,
    mode: session.mode as GameMode,
    teams,
    participants: session.participants.map((p) => ({
      id: p.id,
      pseudo: p.pseudo,
      team_id: p.team_id,
    })),
  });
  res.json({ cumulative });
});

// ── POST /playlists ───────────────────────────────────────────────────────
// Renvoie la liste des playlists publiables disponibles pour l'établissement
// de la session (pour que le master puisse choisir la manche suivante depuis
// son tel). Pas en GET car l'auth master se fait via token dans le body.

router.post('/playlists', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const session = await prisma.session.findUnique({
    where: { id: req.params.id },
    select: { establishment_id: true },
  });
  if (!session) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
    return;
  }
  const playlists = await prisma.playlist.findMany({
    where: {
      establishment_id: session.establishment_id,
      is_published: true,
    },
    orderBy: { updated_at: 'desc' },
    select: {
      id: true,
      name: true,
      description: true,
      cover_url: true,
      level: true,
      language: true,
      is_express: true,
      is_official_tutti: true,
      _count: { select: { playlist_tracks: true } },
    },
  });
  res.json({
    playlists: playlists.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      cover_url: p.cover_url,
      level: p.level,
      language: p.language,
      is_express: p.is_express,
      is_official_tutti: p.is_official_tutti,
      tracks_count: p._count.playlist_tracks,
    })),
  });
});

// ── POST /next-track ──────────────────────────────────────────────────────

router.post('/next-track', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const parsed = roundIdSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'round_id requis' } });
    return;
  }
  const round = await findRoundForSession(parsed.data.round_id, req.params.id);
  if (!round) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Round introuvable' } });
    return;
  }
  const result = await advanceToNextOrEndRound(req.params.id, round);
  res.json(result);
});

// ── POST /skip-track ──────────────────────────────────────────────────────
// Master a appuyé sur "Sauter" (mauvaise piste glissée dans la playlist).
// Différence avec /next-track : on broadcast track:phase_changed → phase3-skipped
// AVANT d'avancer, pour que les clients puissent stopper la lecture audio
// proprement (au lieu de juste enchainer sur le suivant).

router.post('/skip-track', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const parsed = roundIdSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'round_id requis' } });
    return;
  }
  const round = await findRoundForSession(parsed.data.round_id, req.params.id);
  if (!round) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Round introuvable' } });
    return;
  }
  // Marque la phase phase3-skipped pour que les clients sachent ne pas
  // afficher de reveal. Puis avance.
  broadcastToSession(req.params.id, 'track:phase_changed', {
    round_id: parsed.data.round_id,
    phase: 'phase3-skipped',
  });
  const result = await advanceToNextOrEndRound(req.params.id, round);
  res.json(result);
});

// ── POST /give-answer ─────────────────────────────────────────────────────
// "Donner la réponse" master : personne n'a trouvé pendant la phase 1, on
// révèle artist+titre, 0 point, on passe en phase3-revealed (la musique
// continue à jouer jusqu'à ce que master clique "Suivant"). Alias historique
// /reveal préservé temporairement pour rétrocompat. Broadcast track:revealed.

const giveAnswerHandler = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const parsed = roundIdSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'round_id requis' } });
    return;
  }
  const reveal = await revealCurrentTrack(req.params.id, parsed.data.round_id);
  if (!reveal) {
    res.status(409).json({
      error: {
        code: 'INVALID_PHASE',
        message: "Le morceau ne peut être révélé que pendant l'écoute",
      },
    });
    return;
  }
  res.json({ reveal });
};

router.post('/give-answer', giveAnswerHandler);
// Alias rétrocompat — supprimable après mise à jour du frontend (commit 5).
router.post('/reveal', giveAnswerHandler);

// ── POST /pause ───────────────────────────────────────────────────────────

router.post('/pause', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const session = await prisma.session.update({
      where: { id: req.params.id },
      data: { is_paused: true },
    });
    broadcastToSession(req.params.id, 'session:paused', {
      session_id: session.id,
      requested_by: req.master!.pseudo,
    });
    res.json({ ok: true });
  } catch (err: unknown) {
    console.error('[POST master/pause] error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur pause' } });
  }
});

// ── POST /resume ──────────────────────────────────────────────────────────

router.post('/resume', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const session = await prisma.session.update({
      where: { id: req.params.id },
      data: { is_paused: false },
    });
    broadcastToSession(req.params.id, 'session:resumed', { session_id: session.id });
    res.json({ ok: true });
  } catch (err: unknown) {
    console.error('[POST master/resume] error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur reprise' } });
  }
});

// ── POST /end-round ───────────────────────────────────────────────────────

router.post('/end-round', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const parsed = roundIdSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'round_id requis' } });
    return;
  }
  try {
    const round = await endRoundInternal(req.params.id, parsed.data.round_id);
    res.json({ round });
  } catch (err: unknown) {
    console.error('[POST master/end-round] error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur fin round' } });
  }
});

// ── POST /end-session ─────────────────────────────────────────────────────

router.post('/end-session', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const own = await prisma.session.findUnique({
    where: { id: req.params.id },
    include: {
      participants: { where: { is_kicked: false } },
    },
  });
  if (!own) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
    return;
  }
  if (own.status === 'ENDED') {
    res.status(409).json({ error: { code: 'INVALID_STATUS', message: 'Session déjà terminée' } });
    return;
  }
  try {
    // Termine d'abord le round courant éventuel (cleanup gameState aussi)
    const playingRounds = await prisma.sessionRound.findMany({
      where: { session_id: req.params.id, status: 'PLAYING' },
      select: { id: true },
    });
    for (const r of playingRounds) clearActiveTrack(r.id);
    await prisma.sessionRound.updateMany({
      where: { session_id: req.params.id, status: 'PLAYING' },
      data: { status: 'ENDED', ended_at: new Date() },
    });

    const session = await prisma.session.update({
      where: { id: req.params.id },
      data: { status: 'ENDED', ended_at: new Date() },
    });

    const teams = (own.teams_config as Team[] | null) ?? null;
    const cumulative = await getCumulativeScores({
      sessionId: session.id,
      mode: session.mode as GameMode,
      teams,
      participants: own.participants.map((p) => ({
        id: p.id,
        pseudo: p.pseudo,
        team_id: p.team_id,
      })),
    });
    broadcastToSession(session.id, 'session:ended', { session, cumulative });
    res.json({ session, cumulative });
  } catch (err: unknown) {
    console.error('[POST master/end-session] error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur fin session' } });
  }
});

// ── POST /pick-round ──────────────────────────────────────────────────────
// Combine create-round + start-round + play-track en 1 seul appel pour le
// master (qui est sur tel, donc on évite 3 round-trips).

router.post('/pick-round', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const parsed = pickRoundSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'playlist_id requis' } });
    return;
  }
  // Vérif tenant playlist via l'établissement de la session.
  const session = await prisma.session.findUnique({
    where: { id: req.params.id },
    select: { establishment_id: true, status: true },
  });
  if (!session) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
    return;
  }
  if (session.status === 'ENDED') {
    res.status(409).json({ error: { code: 'INVALID_STATUS', message: 'Session terminée' } });
    return;
  }
  const playlist = await prisma.playlist.findFirst({
    where: { id: parsed.data.playlist_id, establishment_id: session.establishment_id },
    include: { _count: { select: { playlist_tracks: true } } },
  });
  if (!playlist) {
    res.status(404).json({
      error: { code: 'PLAYLIST_NOT_FOUND', message: 'Playlist introuvable pour cet établissement' },
    });
    return;
  }
  if (playlist._count.playlist_tracks === 0) {
    res.status(400).json({ error: { code: 'EMPTY_PLAYLIST', message: 'Playlist vide' } });
    return;
  }

  try {
    // 1) Si la session est en WAITING, la passer en PLAYING d'abord.
    if (session.status === 'WAITING') {
      const updated = await prisma.session.update({
        where: { id: req.params.id },
        data: { status: 'PLAYING', started_at: new Date() },
      });
      broadcastToSession(req.params.id, 'session:started', { session: updated });
    }

    // 2) Termine les autres rounds PLAYING (au cas où).
    const playingRounds = await prisma.sessionRound.findMany({
      where: { session_id: req.params.id, status: 'PLAYING' },
      select: { id: true },
    });
    for (const r of playingRounds) clearActiveTrack(r.id);
    await prisma.sessionRound.updateMany({
      where: { session_id: req.params.id, status: 'PLAYING' },
      data: { status: 'ENDED', ended_at: new Date() },
    });

    // 3) Crée le nouveau round à la position suivante.
    const lastRound = await prisma.sessionRound.findFirst({
      where: { session_id: req.params.id },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const created = await prisma.sessionRound.create({
      data: {
        session_id: req.params.id,
        playlist_id: parsed.data.playlist_id,
        position: (lastRound?.position ?? 0) + 1,
        status: 'PENDING',
      },
      include: { playlist: { select: PLAYLIST_LIGHT } },
    });
    const enrichedCreated = enrichRound(created);
    broadcastToSession(req.params.id, 'round:created', { round: enrichedCreated });

    // 4) Démarre le round (PENDING → PLAYING).
    const started = await prisma.sessionRound.update({
      where: { id: created.id },
      data: { status: 'PLAYING' as RoundStatus, started_at: new Date() },
      include: { playlist: { select: PLAYLIST_LIGHT } },
    });
    const enrichedStarted = enrichRound(started);
    broadcastToSession(req.params.id, 'round:started', { round: enrichedStarted });

    // 5) Lance le 1ᵉʳ track. On a besoin du round avec tracks pour ça.
    const fullRound = await findRoundForSession(created.id, req.params.id);
    if (!fullRound) {
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Round créé introuvable' } });
      return;
    }
    const state = await buildAndBroadcastTrack(req.params.id, fullRound, 0);
    res.json({ round: enrichedStarted, state });
  } catch (err: unknown) {
    console.error('[POST master/pick-round] error:', err);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lancement de la manche' },
    });
  }
});

// ── POST /adjust-points ───────────────────────────────────────────────────
// Crée un ScoreEvent type MANUAL_ADJUSTMENT. Pas de broadcast public (pas de
// notif), seul l'invalidation des scores est diffusée pour que les clients
// rafraîchissent silencieusement leur cumulative.

router.post(
  '/adjust-points',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const parsed = adjustPointsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Body invalide',
          details: parsed.error.flatten(),
        },
      });
      return;
    }
    const target = await prisma.participant.findUnique({
      where: { id: parsed.data.target_participant_id },
      select: { id: true, session_id: true, team_id: true, is_kicked: true },
    });
    if (!target || target.is_kicked || target.session_id !== req.params.id) {
      res
        .status(404)
        .json({ error: { code: 'TARGET_INVALID', message: 'Participant cible invalide' } });
      return;
    }

    // Cherche le round PLAYING pour rattacher l'event (sinon le plus récent).
    const round = await prisma.sessionRound.findFirst({
      where: { session_id: req.params.id },
      orderBy: { position: 'desc' },
      select: { id: true },
    });
    const active = round ? getActiveTrack(round.id) : null;

    try {
      await prisma.scoreEvent.create({
        data: {
          session_id: req.params.id,
          session_round_id: round?.id ?? null,
          participant_id: target.id,
          team_id: target.team_id,
          round_index: active?.track_index ?? -1,
          type: ScoreEventType.MANUAL_ADJUSTMENT,
          points: parsed.data.delta,
          match_artist: false,
          match_title: false,
          // Cf. brief : pas de notif publique. is_public=false rend l'event
          // exclus des feeds publics éventuels (la cumulative agrège tout).
          is_public: false,
          reason: parsed.data.reason ?? `master:${req.master!.pseudo}`,
        } as Prisma.ScoreEventUncheckedCreateInput,
      });
      // Signal silencieux : les clients rafraîchissent leur cumulative.
      broadcastToSession(req.params.id, 'scores:invalidated', {});
      res.json({ ok: true });
    } catch (err: unknown) {
      console.error('[POST master/adjust-points] error:', err);
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur ajustement points' } });
    }
  },
);

export default router;
