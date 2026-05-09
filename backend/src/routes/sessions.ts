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
import {
  GameType,
  GameMode,
  SessionStatus,
  RoundStatus,
  Prisma,
  ScoreEventType,
} from '@prisma/client';
import type { Team, GameMode as GameModeType } from '@tutti/shared';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireWorkspace } from '../middleware/tenant.js';
import { generateUniqueShortCode } from '../lib/shortCode.js';
import { broadcastToSession } from '../socket/index.js';
import { getActiveTrack } from '../lib/gameState.js';
import { signParticipantToken } from '../lib/participantToken.js';
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
      // feat/granular-tracks-quizz-access — gate par game_type sur les
      // flags member.can_use_tracks / can_use_quizz. Defense in depth :
      // l'UI désactive les boutons côté frontend, mais on revérifie
      // côté backend pour éviter contournement via call API direct.
      if (req.userId) {
        const member = await prisma.workspaceMember.findFirst({
          where: { user_id: req.userId },
          select: { can_use_tracks: true, can_use_quizz: true },
        });
        if (member) {
          if (parsed.data.game_type === 'TRACKS' && !member.can_use_tracks) {
            res.status(403).json({
              error: { code: 'TRACKS_NOT_ALLOWED', message: 'Accès Tracks non autorisé' },
            });
            return;
          }
          if (parsed.data.game_type === 'QUIZZ' && !member.can_use_quizz) {
            res.status(403).json({
              error: { code: 'QUIZZ_NOT_ALLOWED', message: 'Accès Quizz non autorisé' },
            });
            return;
          }
        }
      }

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

      // Bug 4 (fix/critical-bugs-v3) — Auto-cleanup zombies AVANT de créer
      // la nouvelle session. Toute session WAITING/PLAYING antérieure du
      // workspace (admin a fermé l'onglet sans abandonner / crashée /
      // abandon non commit) est forcée à ENDED + reset is_paused. Idem
      // pour les rounds PLAYING associés.
      //
      // Règle : une seule session active par workspace à la fois. Sans
      // ce cleanup, findRepresentativeSession retournait la zombie au
      // lieu de la session ENDED récente → TV bloquée sur PAUSED de
      // l'ancienne, dashboard host vide.
      const cleanup = await prisma.session.updateMany({
        where: {
          establishment: { workspace_id: workspaceId },
          status: { in: ['WAITING', 'PLAYING'] },
        },
        data: {
          status: 'ENDED',
          ended_at: new Date(),
          is_paused: false,
        },
      });
      if (cleanup.count > 0) {
        console.info(
          `[Session Cleanup] Abandoned ${cleanup.count} zombie session(s) before creating new one in workspace=${workspaceId}`,
        );
        await prisma.sessionRound.updateMany({
          where: {
            session: { establishment: { workspace_id: workspaceId } },
            status: 'PLAYING',
          },
          data: { status: 'ENDED', ended_at: new Date() },
        });
      }

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

// ── GET /current (host) ──────────────────────────────────────────────────
// Retourne la session active la plus récente du workspace (status WAITING
// ou PLAYING). Permet de proposer "Reprendre la partie" après reload.

router.get(
  '/current',
  requireAuth,
  requireWorkspace,
  async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    try {
      const session = await prisma.session.findFirst({
        where: {
          establishment: { workspace_id: workspaceId },
          status: { in: ['WAITING', 'PLAYING'] },
        },
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          short_code: true,
          name: true,
          status: true,
          game_type: true,
          mode: true,
          started_at: true,
          created_at: true,
          _count: { select: { participants: true } },
        },
      });
      if (!session) {
        res.status(204).end();
        return;
      }
      res.json({
        session: {
          id: session.id,
          short_code: session.short_code,
          name: session.name,
          status: session.status,
          game_type: session.game_type,
          mode: session.mode,
          started_at: session.started_at,
          created_at: session.created_at,
          participants_count: session._count.participants,
        },
      });
    } catch (err: unknown) {
      console.error('[GET /sessions/current] error:', err);
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur récupération session' } });
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
          // Pivot B2C — pas d'exposition du nom d'établissement aux joueurs.
          // On envoie session.name (nom personnalisé de la partie) si présent,
          // sinon "Tutti". Le nom de l'établissement reste interne.
          establishment_name: session.name ?? 'Tutti',
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

// ── GET /by-code/:short_code/snapshot (public, screen TV) ────────────────
// Snapshot complet de la session destiné à la vue /screen TV (cast par code).
// Read-only, pas de tokens, pas d'infos sensibles.

router.get(
  '/by-code/:short_code/snapshot',
  async (req: Request<{ short_code: string }>, res: Response): Promise<void> => {
    const code = req.params.short_code.toUpperCase();
    try {
      const session = await prisma.session.findUnique({
        where: { short_code: code },
        include: {
          establishment: {
            select: { name: true, branding_color: true, branding_logo: true },
          },
          participants: {
            where: { is_kicked: false },
            orderBy: { joined_at: 'asc' },
          },
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
      if (!session) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
        return;
      }
      const participantsForScores = session.participants.map((p) => ({
        id: p.id,
        pseudo: p.pseudo,
        team_id: p.team_id,
      }));
      const teams = (session.teams_config as Team[] | null) ?? null;
      const cumulative = await getCumulativeScores({
        sessionId: session.id,
        mode: session.mode as GameModeType,
        teams,
        participants: participantsForScores,
      });
      // Sérialise les rounds en enrichissant playlist.tracks_count.
      const rounds = session.rounds.map((r) => ({
        ...r,
        playlist: {
          id: r.playlist.id,
          name: r.playlist.name,
          level: r.playlist.level,
          tracks_count: r.playlist._count.playlist_tracks,
        },
      }));
      res.json({
        session: {
          ...session,
          rounds,
          // Pivot B2C — pas d'exposition du nom d'établissement aux joueurs.
          // On envoie session.name (nom personnalisé de la partie) si présent,
          // sinon "Tutti". Le nom de l'établissement reste interne.
          establishment_name: session.name ?? 'Tutti',
          branding_color: session.establishment.branding_color,
          branding_logo: session.establishment.branding_logo,
        },
        cumulative,
      });
    } catch (err: unknown) {
      console.error('[GET /sessions/by-code/snapshot] error:', err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur snapshot' } });
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
    // feat/playlist-search-and-host-improvements F2 — autoriser le démarrage
    // sans joueur connecté (mode démo / test / animateur seul). L'host peut
    // toujours choisir d'attendre via l'UI s'il préfère.
    // Ancienne valeur : MIN_PLAYERS_TO_START = 1.
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
        data: {
          status: 'ENDED',
          ended_at: new Date(),
          // Bug 1 — Reset is_paused à la fin de session pour que les clients
          // sortent de l'état "pause" et affichent le podium proprement.
          is_paused: false,
        },
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

// ── POST /:id/abandon (host) — abandon silencieux de la session ───────────
// Utilisé quand l'admin clique "Retour au tableau de bord" sans avoir cliqué
// "Terminer le blind test". Marque la session ENDED en DB sans broadcast
// public (joueurs/écran TV repassent en IDLE au prochain poll screen-state).
// Pas de cumulative final, pas de notification.

router.post(
  '/:id/abandon',
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
      res.json({ ok: true, alreadyEnded: true });
      return;
    }
    try {
      console.info(`[Cleanup] Abandoning session ${own.id} (admin returned to dashboard)`);
      await prisma.sessionRound.updateMany({
        where: { session_id: req.params.id, status: 'PLAYING' },
        data: { status: 'ENDED', ended_at: new Date() },
      });
      await prisma.session.update({
        where: { id: req.params.id },
        data: {
          status: 'ENDED',
          ended_at: new Date(),
          is_paused: false,
        },
      });
      // Pas de broadcast 'session:ended' — abandon silencieux. L'écran TV
      // détectera le passage à IDLE via polling /screen-state.
      res.json({ ok: true });
    } catch (err: unknown) {
      console.error('[POST /sessions/:id/abandon] error:', err);
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur abandon session' } });
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
        select: {
          id: true,
          status: true,
          mode: true,
          teams_config: true,
          max_participants: true,
          _count: { select: { participants: { where: { is_kicked: false } } } },
        },
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
      // Cap V1 = 15 participants (cf. Session.max_participants, défaut 15).
      if (session._count.participants >= session.max_participants) {
        res.status(409).json({
          error: {
            code: 'SESSION_FULL',
            message: `Cette session est complète (${session.max_participants} participants maximum). Reviens plus tard ou demande à l'organisateur de créer une autre session.`,
          },
        });
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

// ── PATCH /:id/players/:pid/score (host adjust points) ────────────────────
// Feature 3 — édition manuelle des points par l'animateur (mode A iPad).
// Mirror du /master/adjust-points (mode B) avec auth Supabase + workspace.

const adjustPointsBody = z.object({
  delta: z.number().int().min(-1000).max(1000),
  reason: z.string().trim().max(200).optional(),
});

router.patch(
  '/:id/players/:pid/score',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string; pid: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const parsed = adjustPointsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'delta requis (entier -1000..1000)' },
      });
      return;
    }
    // Vérifie que la session appartient au workspace
    const session = await prisma.session.findFirst({
      where: { id: req.params.id, establishment: { workspace_id: workspaceId } },
      select: { id: true },
    });
    if (!session) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
      return;
    }
    const target = await prisma.participant.findUnique({
      where: { id: req.params.pid },
      select: { id: true, session_id: true, team_id: true, is_kicked: true },
    });
    if (!target || target.is_kicked || target.session_id !== session.id) {
      res
        .status(404)
        .json({ error: { code: 'TARGET_INVALID', message: 'Participant cible invalide' } });
      return;
    }
    const round = await prisma.sessionRound.findFirst({
      where: { session_id: session.id },
      orderBy: { position: 'desc' },
      select: { id: true },
    });
    const active = round ? getActiveTrack(round.id) : null;
    try {
      await prisma.scoreEvent.create({
        data: {
          session_id: session.id,
          session_round_id: round?.id ?? null,
          participant_id: target.id,
          team_id: target.team_id,
          round_index: active?.track_index ?? -1,
          type: ScoreEventType.MANUAL_ADJUSTMENT,
          points: parsed.data.delta,
          match_artist: false,
          match_title: false,
          is_public: false,
          reason: parsed.data.reason ?? `host:${req.userEmail ?? req.userId}`,
        } as Prisma.ScoreEventUncheckedCreateInput,
      });
      broadcastToSession(session.id, 'scores:invalidated', {});
      res.json({ ok: true });
    } catch (err: unknown) {
      console.error('[PATCH /sessions/:id/players/:pid/score] error:', err);
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur ajustement points' } });
    }
  },
);

export default router;
