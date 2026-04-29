/**
 * Routes /api/sessions/* — création, configuration, join, gestion participants.
 *
 *   POST   /                                : créer une session (host, auth)
 *   GET    /by-id/:id                       : détails (host, auth)
 *   GET    /by-code/:short_code             : vue publique (joueur, sans auth)
 *   PATCH  /:id                             : éditer config avant start (host)
 *   POST   /:id/start                       : passer status WAITING → PLAYING (host)
 *   POST   /by-code/:short_code/join        : joueur rejoint (sans auth)
 *   PATCH  /:id/participants/:pid           : host change l'équipe d'un joueur
 *   DELETE /:id/participants/:pid           : host kick
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { GameType, GameMode, SessionStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireWorkspace } from '../middleware/tenant.js';
import { generateUniqueShortCode } from '../lib/shortCode.js';
import { signParticipantToken } from '../lib/participantToken.js';
import { broadcastToSession } from '../socket/index.js';

const router: Router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────

async function ensureOwnSession(sessionId: string, workspaceId: string) {
  return prisma.session.findFirst({
    where: { id: sessionId, establishment: { workspace_id: workspaceId } },
    include: { participants: { where: { is_kicked: false }, orderBy: { joined_at: 'asc' } } },
  });
}

// ── POST / : création (host) ──────────────────────────────────────────────

const teamSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/u),
});

const createSchema = z.object({
  game_type: z.enum(['TRACKS', 'QUIZZ']).default('TRACKS'),
  mode: z.enum(['SOLO', 'TEAMS']).default('SOLO'),
  teams_config: z.array(teamSchema).max(8).optional(),
  language: z.enum(['fr', 'en']).default('fr'),
  playlist_id: z.string().uuid().optional(),
  question_set_id: z.string().uuid().optional(),
});

router.post(
  '/',
  requireAuth,
  requireWorkspace,
  async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({
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

      // Pour TRACKS, vérifier que la playlist appartient bien au tenant
      if (parsed.data.game_type === 'TRACKS') {
        if (!parsed.data.playlist_id) {
          res
            .status(400)
            .json({
              error: { code: 'PLAYLIST_REQUIRED', message: 'playlist_id requis pour TRACKS' },
            });
          return;
        }
        const ownPlaylist = await prisma.playlist.findFirst({
          where: { id: parsed.data.playlist_id, establishment: { workspace_id: workspaceId } },
          select: { id: true },
        });
        if (!ownPlaylist) {
          res
            .status(404)
            .json({ error: { code: 'PLAYLIST_NOT_FOUND', message: 'Playlist introuvable' } });
          return;
        }
      }

      const shortCode = await generateUniqueShortCode(establishment.name);

      const session = await prisma.session.create({
        data: {
          establishment_id: establishment.id,
          game_type: parsed.data.game_type as GameType,
          mode: parsed.data.mode as GameMode,
          teams_config: parsed.data.teams_config
            ? (parsed.data.teams_config as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          language: parsed.data.language,
          playlist_id: parsed.data.playlist_id ?? null,
          question_set_id: parsed.data.question_set_id ?? null,
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
    res.json({ session });
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
          participants: { where: { is_kicked: false }, select: { id: true } },
        },
      });
      if (!session) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
        return;
      }
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
  mode: z.enum(['SOLO', 'TEAMS']).optional(),
  teams_config: z.array(teamSchema).max(8).nullable().optional(),
  language: z.enum(['fr', 'en']).optional(),
  playlist_id: z.string().uuid().nullable().optional(),
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
      res
        .status(400)
        .json({
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
      res
        .status(409)
        .json({
          error: {
            code: 'INVALID_STATUS',
            message: 'Configuration impossible : session déjà démarrée',
          },
        });
      return;
    }
    try {
      const updateData: Prisma.SessionUpdateInput = {};
      if (parsed.data.mode) updateData.mode = parsed.data.mode as GameMode;
      if (parsed.data.teams_config !== undefined) {
        updateData.teams_config = parsed.data.teams_config
          ? (parsed.data.teams_config as Prisma.InputJsonValue)
          : Prisma.JsonNull;
      }
      if (parsed.data.language) updateData.language = parsed.data.language;
      if (parsed.data.playlist_id !== undefined) {
        updateData.playlist_id = parsed.data.playlist_id;
      }
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
    if (own.participants.length < 2) {
      res
        .status(400)
        .json({ error: { code: 'NOT_ENOUGH_PLAYERS', message: 'Au moins 2 joueurs requis' } });
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

// ── POST /by-code/:code/join (joueur, sans auth) ──────────────────────────

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
      res
        .status(400)
        .json({
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
      if (session.status !== 'WAITING') {
        res
          .status(409)
          .json({
            error: { code: 'NOT_ACCEPTING_PLAYERS', message: 'Session déjà démarrée ou terminée' },
          });
        return;
      }

      // Si TEAMS, valider que team_id existe dans teams_config
      let teamId: string | null = null;
      if (session.mode === 'TEAMS') {
        const teams = (session.teams_config as Array<{ id: string }> | null) ?? [];
        if (!parsed.data.team_id || !teams.some((t) => t.id === parsed.data.team_id)) {
          res
            .status(400)
            .json({
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

// ── PATCH /:id/participants/:pid (host change l'équipe) ──────────────────

const movePartSchema = z.object({
  team_id: z.string().uuid().nullable(),
});

router.patch(
  '/:id/participants/:pid',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string; pid: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const parsed = movePartSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({
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
    // Si team_id fourni, vérifier qu'il existe dans teams_config
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

// ── DELETE /:id/participants/:pid (host kick) ────────────────────────────

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
