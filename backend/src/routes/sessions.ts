/**
 * Routes /api/sessions/* — création, configuration, join, gestion participants,
 * rounds, scores cumulés.
 *
 *   POST   /                                : créer une session (sans playlist)
 *   GET    /by-id/:id                       : détails (host) + rounds + scores
 *   GET    /by-code/:short_code             : vue publique (joueur)
 *   PATCH  /:id                             : éditer name/mode/teams/language
 *   POST   /:id/start                       : WAITING → PLAYING (host)
 *   POST   /:id/end                         : termine la session
 *
 *   POST   /:id/rounds                      : créer une manche { playlist_id }
 *   POST   /:id/rounds/:roundId/start       : passer round PENDING → PLAYING
 *                                              (le précédent passe à ENDED)
 *   POST   /:id/rounds/:roundId/end         : passer round PLAYING → ENDED
 *
 *   POST   /by-code/:short_code/join        : joueur rejoint (sans auth)
 *   PATCH  /:id/participants/:pid           : host change l'équipe
 *   DELETE /:id/participants/:pid           : host kick (soft)
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { GameType, GameMode, SessionStatus, RoundStatus, Prisma } from '@prisma/client';
import type { Team } from '@tutti/shared';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireWorkspace } from '../middleware/tenant.js';
import { generateUniqueShortCode } from '../lib/shortCode.js';
import { signParticipantToken } from '../lib/participantToken.js';
import { broadcastToSession } from '../socket/index.js';
import { getCumulativeScores } from '../lib/scores.js';

const router: Router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────

async function ensureOwnSession(sessionId: string, workspaceId: string) {
  return prisma.session.findFirst({
    where: { id: sessionId, establishment: { workspace_id: workspaceId } },
    include: {
      participants: { where: { is_kicked: false }, orderBy: { joined_at: 'asc' } },
      rounds: {
        orderBy: { position: 'asc' },
        include: {
          playlist: {
            select: {
              id: true,
              name: true,
              level: true,
              _count: { select: { playlist_tracks: true } },
            },
          },
        },
      },
    },
  });
}

type EnrichedSession = Awaited<ReturnType<typeof ensureOwnSession>>;

function serializeSession(session: NonNullable<EnrichedSession>) {
  return {
    ...session,
    rounds: session.rounds.map((r) => ({
      ...r,
      playlist: {
        id: r.playlist.id,
        name: r.playlist.name,
        level: r.playlist.level,
        tracks_count: r.playlist._count.playlist_tracks,
      },
    })),
  };
}

// ── POST / : création (host) — sans playlist au démarrage ─────────────────

const teamSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/u),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  game_type: z.enum(['TRACKS', 'QUIZZ']).default('TRACKS'),
  mode: z.enum(['SOLO', 'TEAMS']).default('SOLO'),
  teams_config: z.array(teamSchema).max(8).optional(),
  language: z.enum(['fr', 'en']).default('fr'),
  question_set_id: z.string().uuid().optional(),
  // Mode A vs B. Défaut B (false) = "tout le monde joue", c'est le défaut B2C.
  has_animator: z.boolean().default(false),
});

router.post(
  '/',
  requireAuth,
  requireWorkspace,
  async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const parsed = createSchema.safeParse(req.body);
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
    try {
      const establishment = await prisma.establishment.findFirst({
        where: { workspace_id: workspaceId },
        orderBy: { created_at: 'asc' },
      });
      if (!establishment) {
        res
          .status(404)
          .json({ error: { code: 'NO_ESTABLISHMENT', message: 'Aucun établissement' } });
        return;
      }

      const shortCode = await generateUniqueShortCode(establishment.name);

      const session = await prisma.session.create({
        data: {
          establishment_id: establishment.id,
          name: parsed.data.name ?? null,
          game_type: parsed.data.game_type as GameType,
          mode: parsed.data.mode as GameMode,
          teams_config: parsed.data.teams_config
            ? (parsed.data.teams_config as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          language: parsed.data.language,
          question_set_id: parsed.data.question_set_id ?? null,
          has_animator: parsed.data.has_animator,
          short_code: shortCode,
          status: 'WAITING',
        },
      });
      res.status(201).json({ session });
    } catch (err: unknown) {
      console.error('[POST /sessions] error:', err);
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur création session' } });
    }
  },
);

// ── GET /by-id/:id (host) ─────────────────────────────────────────────────

router.get(
  '/by-id/:id',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const session = await ensureOwnSession(req.params.id, workspaceId);
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
    res.json({ session: serializeSession(session), cumulative });
  },
);

// ── GET /by-code/:short_code (public) ─────────────────────────────────────

router.get(
  '/by-code/:short_code',
  async (req: Request<{ short_code: string }>, res: Response): Promise<void> => {
    const code = req.params.short_code.toUpperCase();
    try {
      const session = await prisma.session.findUnique({
        where: { short_code: code },
        include: {
          establishment: { select: { name: true, branding_color: true } },
          participants: {
            where: { is_kicked: false },
            select: { id: true, pseudo: true, is_master: true },
          },
          rounds: {
            where: { status: 'PLAYING' },
            select: { id: true, position: true, playlist: { select: { name: true } } },
            take: 1,
          },
        },
      });
      if (!session) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
        return;
      }
      const currentRound = session.rounds[0] ?? null;
      const masterPseudo = session.participants.find((p) => p.is_master)?.pseudo ?? null;
      res.json({
        session: {
          short_code: session.short_code,
          status: session.status,
          mode: session.mode,
          teams_config: session.teams_config,
          language: session.language,
          game_type: session.game_type,
          establishment_name: session.establishment.name,
          branding_color: session.establishment.branding_color,
          participants_count: session.participants.length,
          has_animator: session.has_animator,
          master_pseudo: masterPseudo,
          current_round: currentRound
            ? {
                position: currentRound.position,
                playlist_name: currentRound.playlist.name,
              }
            : null,
        },
      });
    } catch (err: unknown) {
      console.error('[GET /sessions/by-code] error:', err);
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur récupération session' } });
    }
  },
);

// ── PATCH /:id (host) ─────────────────────────────────────────────────────

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).nullable().optional(),
  mode: z.enum(['SOLO', 'TEAMS']).optional(),
  teams_config: z.array(teamSchema).max(8).nullable().optional(),
  language: z.enum(['fr', 'en']).optional(),
  question_set_id: z.string().uuid().nullable().optional(),
});

router.patch(
  '/:id',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const parsed = patchSchema.safeParse(req.body);
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
    const own = await ensureOwnSession(req.params.id, workspaceId);
    if (!own) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
      return;
    }
    if (own.status !== 'WAITING') {
      res.status(409).json({
        error: {
          code: 'INVALID_STATUS',
          message: 'Configuration impossible : session déjà démarrée',
        },
      });
      return;
    }
    try {
      const updateData: Prisma.SessionUpdateInput = {};
      if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
      if (parsed.data.mode) updateData.mode = parsed.data.mode as GameMode;
      if (parsed.data.teams_config !== undefined) {
        updateData.teams_config = parsed.data.teams_config
          ? (parsed.data.teams_config as Prisma.InputJsonValue)
          : Prisma.JsonNull;
      }
      if (parsed.data.language) updateData.language = parsed.data.language;
      if (parsed.data.question_set_id !== undefined) {
        updateData.question_set_id = parsed.data.question_set_id;
      }
      const session = await prisma.session.update({
        where: { id: req.params.id },
        data: updateData,
      });
      broadcastToSession(session.id, 'session:state', { session });
      res.json({ session });
    } catch (err: unknown) {
      console.error('[PATCH /sessions/:id] error:', err);
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur mise à jour session' } });
    }
  },
);

// ── POST /:id/start (host) ────────────────────────────────────────────────

router.post(
  '/:id/start',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const own = await ensureOwnSession(req.params.id, workspaceId);
    if (!own) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
      return;
    }
    if (own.status !== 'WAITING') {
      res
        .status(409)
        .json({ error: { code: 'INVALID_STATUS', message: 'Session pas en WAITING' } });
      return;
    }
    const MIN_PLAYERS_TO_START = 1; // V1 dev/test (2 en prod commerciale)
    if (own.participants.length < MIN_PLAYERS_TO_START) {
      res
        .status(400)
        .json({ error: { code: 'NOT_ENOUGH_PLAYERS', message: 'Au moins 1 joueur requis' } });
      return;
    }
    try {
      const session = await prisma.session.update({
        where: { id: req.params.id },
        data: { status: 'PLAYING' as SessionStatus, started_at: new Date() },
      });
      broadcastToSession(session.id, 'session:started', { session });
      res.json({ session });
    } catch (err: unknown) {
      console.error('[POST /sessions/:id/start] error:', err);
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur démarrage session' } });
    }
  },
);

// ── POST /:id/end (host) — termine toute la session ───────────────────────

router.post(
  '/:id/end',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const own = await ensureOwnSession(req.params.id, workspaceId);
    if (!own) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
      return;
    }
    if (own.status === 'ENDED') {
      res.status(409).json({ error: { code: 'INVALID_STATUS', message: 'Session déjà terminée' } });
      return;
    }
    try {
      // Termine d'abord le round courant éventuel
      await prisma.sessionRound.updateMany({
        where: { session_id: req.params.id, status: 'PLAYING' },
        data: { status: 'ENDED', ended_at: new Date() },
      });
      const session = await prisma.session.update({
        where: { id: req.params.id },
        data: { status: 'ENDED', ended_at: new Date() },
      });

      // Scores cumulés finaux pour le podium
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
      console.error('[POST /sessions/:id/end] error:', err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur fin session' } });
    }
  },
);

// ── ROUNDS ────────────────────────────────────────────────────────────────

const createRoundSchema = z.object({
  playlist_id: z.string().uuid(),
});

router.post(
  '/:id/rounds',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const parsed = createRoundSchema.safeParse(req.body);
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
    const own = await ensureOwnSession(req.params.id, workspaceId);
    if (!own) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
      return;
    }
    if (own.status === 'ENDED') {
      res.status(409).json({ error: { code: 'INVALID_STATUS', message: 'Session terminée' } });
      return;
    }
    // Vérif tenant playlist
    const playlist = await prisma.playlist.findFirst({
      where: { id: parsed.data.playlist_id, establishment: { workspace_id: workspaceId } },
      include: { _count: { select: { playlist_tracks: true } } },
    });
    if (!playlist) {
      res
        .status(404)
        .json({ error: { code: 'PLAYLIST_NOT_FOUND', message: 'Playlist introuvable' } });
      return;
    }
    if (playlist._count.playlist_tracks === 0) {
      res.status(400).json({ error: { code: 'EMPTY_PLAYLIST', message: 'Playlist vide' } });
      return;
    }
    try {
      const lastRound = await prisma.sessionRound.findFirst({
        where: { session_id: req.params.id },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      const round = await prisma.sessionRound.create({
        data: {
          session_id: req.params.id,
          playlist_id: parsed.data.playlist_id,
          position: (lastRound?.position ?? 0) + 1,
          status: 'PENDING',
        },
        include: {
          playlist: {
            select: {
              id: true,
              name: true,
              level: true,
              _count: { select: { playlist_tracks: true } },
            },
          },
        },
      });
      const enriched = {
        ...round,
        playlist: {
          id: round.playlist.id,
          name: round.playlist.name,
          level: round.playlist.level,
          tracks_count: round.playlist._count.playlist_tracks,
        },
      };
      broadcastToSession(req.params.id, 'round:created', { round: enriched });
      res.status(201).json({ round: enriched });
    } catch (err: unknown) {
      console.error('[POST /sessions/:id/rounds] error:', err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur création round' } });
    }
  },
);

router.post(
  '/:id/rounds/:roundId/start',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string; roundId: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const own = await ensureOwnSession(req.params.id, workspaceId);
    if (!own) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
      return;
    }
    if (own.status !== 'PLAYING') {
      res
        .status(409)
        .json({ error: { code: 'INVALID_STATUS', message: 'Démarre la session avant un round' } });
      return;
    }
    try {
      // Termine les autres rounds PLAYING (au cas où)
      await prisma.sessionRound.updateMany({
        where: { session_id: req.params.id, status: 'PLAYING', NOT: { id: req.params.roundId } },
        data: { status: 'ENDED', ended_at: new Date() },
      });
      const round = await prisma.sessionRound.update({
        where: { id: req.params.roundId, session_id: req.params.id },
        data: { status: 'PLAYING' as RoundStatus, started_at: new Date() },
        include: {
          playlist: {
            select: {
              id: true,
              name: true,
              level: true,
              _count: { select: { playlist_tracks: true } },
            },
          },
        },
      });
      const enriched = {
        ...round,
        playlist: {
          id: round.playlist.id,
          name: round.playlist.name,
          level: round.playlist.level,
          tracks_count: round.playlist._count.playlist_tracks,
        },
      };
      broadcastToSession(req.params.id, 'round:started', { round: enriched });
      res.json({ round: enriched });
    } catch (err: unknown) {
      console.error('[POST /sessions/:id/rounds/:roundId/start] error:', err);
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur démarrage round' } });
    }
  },
);

router.post(
  '/:id/rounds/:roundId/end',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string; roundId: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const own = await ensureOwnSession(req.params.id, workspaceId);
    if (!own) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
      return;
    }
    try {
      const round = await prisma.sessionRound.update({
        where: { id: req.params.roundId, session_id: req.params.id },
        data: { status: 'ENDED' as RoundStatus, ended_at: new Date() },
        include: {
          playlist: {
            select: {
              id: true,
              name: true,
              level: true,
              _count: { select: { playlist_tracks: true } },
            },
          },
        },
      });
      const enriched = {
        ...round,
        playlist: {
          id: round.playlist.id,
          name: round.playlist.name,
          level: round.playlist.level,
          tracks_count: round.playlist._count.playlist_tracks,
        },
      };
      broadcastToSession(req.params.id, 'round:ended', { round: enriched });
      res.json({ round: enriched });
    } catch (err: unknown) {
      console.error('[POST /sessions/:id/rounds/:roundId/end] error:', err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur fin round' } });
    }
  },
);

// ── JOIN (joueur, sans auth) ──────────────────────────────────────────────

const joinSchema = z.object({
  pseudo: z.string().trim().min(1).max(40),
  team_id: z.string().uuid().nullable().optional(),
  fingerprint: z.string().max(64).optional(),
});

router.post(
  '/by-code/:short_code/join',
  async (req: Request<{ short_code: string }>, res: Response): Promise<void> => {
    const code = req.params.short_code.toUpperCase();
    const parsed = joinSchema.safeParse(req.body);
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
    try {
      const session = await prisma.session.findUnique({
        where: { short_code: code },
        select: { id: true, status: true, mode: true, teams_config: true },
      });
      if (!session) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
        return;
      }
      // On accepte les joueurs en WAITING ET en PLAYING (latecomers OK).
      // Refuser uniquement quand session terminée.
      if (session.status === 'ENDED') {
        res
          .status(409)
          .json({ error: { code: 'NOT_ACCEPTING_PLAYERS', message: 'Session terminée' } });
        return;
      }

      let teamId: string | null = null;
      if (session.mode === 'TEAMS') {
        const teams = (session.teams_config as Array<{ id: string }> | null) ?? [];
        if (!parsed.data.team_id || !teams.some((t) => t.id === parsed.data.team_id)) {
          res.status(400).json({
            error: {
              code: 'INVALID_TEAM',
              message: 'team_id requis et valide pour le mode TEAMS',
            },
          });
          return;
        }
        teamId = parsed.data.team_id;
      }

      const participant = await prisma.participant.create({
        data: {
          session_id: session.id,
          pseudo: parsed.data.pseudo,
          team_id: teamId,
          fingerprint: parsed.data.fingerprint ?? null,
        },
      });

      const token = signParticipantToken({ participantId: participant.id, sessionId: session.id });
      broadcastToSession(session.id, 'participant:joined', { participant });
      res.status(201).json({ participant, token });
    } catch (err: unknown) {
      console.error('[POST /sessions/by-code/join] error:', err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur join session' } });
    }
  },
);

// ── PARTICIPANTS (host) ───────────────────────────────────────────────────

const movePartSchema = z.object({ team_id: z.string().uuid().nullable() });

router.patch(
  '/:id/participants/:pid',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string; pid: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const parsed = movePartSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body invalide' } });
      return;
    }
    const own = await ensureOwnSession(req.params.id, workspaceId);
    if (!own) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
      return;
    }
    if (parsed.data.team_id) {
      const teams = (own.teams_config as Array<{ id: string }> | null) ?? [];
      if (!teams.some((t) => t.id === parsed.data.team_id)) {
        res.status(400).json({ error: { code: 'INVALID_TEAM', message: 'team_id inconnu' } });
        return;
      }
    }
    try {
      const participant = await prisma.participant.update({
        where: { id: req.params.pid, session_id: req.params.id },
        data: { team_id: parsed.data.team_id },
      });
      broadcastToSession(own.id, 'participant:moved_team', { participant });
      res.json({ participant });
    } catch (err: unknown) {
      console.error('[PATCH /sessions/:id/participants/:pid] error:', err);
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur changement équipe' } });
    }
  },
);

// ── POST /:id/participants/:pid/master (host) ────────────────────────────
// Désigne un participant comme master (animateur du tel) en mode B.
// Désigne via toggle : si déjà master → le révoque, sinon → le promeut et
// révoque tous les autres masters de la session (un seul master à la fois).
// Mode A : utile aussi pour donner accès au menu master à un participant
// précis, même si le pilotage principal reste sur l'iPad.
router.post(
  '/:id/participants/:pid/master',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string; pid: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const own = await ensureOwnSession(req.params.id, workspaceId);
    if (!own) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
      return;
    }
    try {
      const target = await prisma.participant.findFirst({
        where: { id: req.params.pid, session_id: req.params.id, is_kicked: false },
      });
      if (!target) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Participant introuvable' } });
        return;
      }
      const willBeMaster = !target.is_master;
      // Atomic : démasterise tous les autres puis (dé)masterise la cible.
      const [, updatedTarget] = await prisma.$transaction([
        prisma.participant.updateMany({
          where: { session_id: req.params.id, is_master: true, NOT: { id: req.params.pid } },
          data: { is_master: false },
        }),
        prisma.participant.update({
          where: { id: req.params.pid },
          data: { is_master: willBeMaster },
        }),
      ]);
      broadcastToSession(own.id, 'participant:master_changed', {
        participant: updatedTarget,
        // Aide les clients à savoir si quelqu'un d'autre vient d'être démasterisé
        // (un seul master à la fois, donc on les démasterise tous puis on remet).
        is_master: willBeMaster,
      });
      res.json({ participant: updatedTarget });
    } catch (err: unknown) {
      console.error('[POST /sessions/:id/participants/:pid/master] error:', err);
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur désignation master' } });
    }
  },
);

router.delete(
  '/:id/participants/:pid',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string; pid: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const own = await ensureOwnSession(req.params.id, workspaceId);
    if (!own) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
      return;
    }
    try {
      const participant = await prisma.participant.update({
        where: { id: req.params.pid, session_id: req.params.id },
        data: { is_kicked: true },
      });
      broadcastToSession(own.id, 'participant:kicked', { participant });
      res.json({ ok: true });
    } catch (err: unknown) {
      console.error('[DELETE /sessions/:id/participants/:pid] error:', err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur kick' } });
    }
  },
);

export default router;
