/**
 * Socket.IO — initialisation, auth dual (host Supabase JWT OU participant JWT),
 * rooms par session.id, événements de salle d'attente.
 *
 * Pattern auth :
 *   - Host se connecte avec `auth.token` = JWT Supabase
 *   - Joueur se connecte avec `auth.token` = JWT participant signé
 *     (retourné par POST /api/sessions/:code/join)
 *
 * Rooms : `session:{sessionId}` — tous les sockets d'une même session
 *         (host + joueurs) y sont rattachés.
 *
 * Événements V1 (étape 9, salle d'attente) :
 *   ← (server emit)
 *     - "session:state"          : snapshot complet (status, participants…)
 *     - "participant:joined"     : un nouveau joueur arrive
 *     - "participant:left"       : un joueur quitte
 *     - "participant:moved_team" : changement d'équipe
 *     - "participant:kicked"     : kick par le host
 *     - "session:started"        : la partie démarre (étape 10)
 *
 * Étapes 10+ ajouteront play_track, buzz, score_event…
 */

import type { Server as HttpServer } from 'node:http';
import type { CumulativeScore, CurrentTrackState, GameMode, Team } from '@tutti/shared';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { supabaseAdmin } from '../lib/supabase.js';
import { verifyParticipantToken } from '../lib/participantToken.js';
import { prisma } from '../lib/prisma.js';
import { buildCurrentTrackStateSnapshot } from '../lib/gameplayCore.js';
import { getCumulativeScores } from '../lib/scores.js';

type SocketIdentity =
  | { kind: 'host'; userId: string; userEmail: string | null }
  | { kind: 'participant'; participantId: string; sessionId: string }
  | { kind: 'spectator'; sessionId: string };

const SESSION_INCLUDE = {
  participants: { where: { is_kicked: false }, orderBy: { joined_at: 'asc' as const } },
  rounds: {
    orderBy: { position: 'asc' as const },
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
} as const;

type SessionWithIncludes = NonNullable<
  Awaited<
    ReturnType<
      typeof import('../lib/prisma.js').prisma.session.findFirst<{
        include: typeof SESSION_INCLUDE;
      }>
    >
  >
>;

function serializeSession(session: SessionWithIncludes) {
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

/**
 * Phase 2.3 — pour un session avec un round PLAYING, retourne le snapshot
 * CurrentTrackState courant si dispo en mémoire, sinon null. Permet au host
 * qui se reconnecte (reload page) de rehydrater currentTrack sans attendre
 * le prochain track:start.
 */
async function buildSessionSnapshot(
  session: SessionWithIncludes,
): Promise<CurrentTrackState | null> {
  const playingRound = session.rounds.find((r) => r.status === 'PLAYING');
  if (!playingRound) return null;
  return buildCurrentTrackStateSnapshot(playingRound.id);
}

/**
 * Reconnexion joueur — calcule la cumulative actuelle pour que le frontend
 * restaure le myScore + classement direct, sans attendre un track:correct_answer.
 */
async function buildCumulativeSnapshot(session: SessionWithIncludes): Promise<CumulativeScore[]> {
  try {
    return await getCumulativeScores({
      sessionId: session.id,
      mode: session.mode as GameMode,
      teams: (session.teams_config as Team[] | null) ?? null,
      participants: session.participants.map((p) => ({
        id: p.id,
        pseudo: p.pseudo,
        team_id: p.team_id,
      })),
    });
  } catch (err) {
    console.warn('[socket] buildCumulativeSnapshot failed:', err);
    return [];
  }
}

interface AuthedSocket extends Socket {
  identity?: SocketIdentity;
}

/**
 * CORS Socket.IO — même whitelist que l'API REST. Cf. server.ts.
 * On duplique ici car ce module est importé en premier par server.ts et on
 * évite l'import circulaire.
 */
const STATIC_ALLOWED_ORIGINS = [
  'https://tuttiparty.app',
  'https://www.tuttiparty.app',
  'https://tutti-brown.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
];
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const allowedOrigins = new Set([...STATIC_ALLOWED_ORIGINS, FRONTEND_URL]);

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  if (/^https:\/\/tutti-[a-z0-9-]+\.vercel\.app$/.test(origin)) return true;
  return false;
}

let io: SocketIOServer | null = null;

export function initSocketIO(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) return callback(null, true);
        callback(new Error(`CORS blocked: origin ${origin} not allowed`));
      },
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // ── Middleware auth (handshake) ───────────────────────────────────────
  io.use(async (socket: AuthedSocket, next) => {
    try {
      const role = socket.handshake.auth?.role as string | undefined;

      // Spectator : accès anonyme read-only par short_code (TV mode "cast par code")
      if (role === 'spectator') {
        const shortCode = String(socket.handshake.auth?.shortCode ?? '').toUpperCase();
        if (!shortCode) return next(new Error('SHORT_CODE_REQUIRED'));
        const session = await prisma.session.findUnique({
          where: { short_code: shortCode },
          select: { id: true },
        });
        if (!session) return next(new Error('SESSION_NOT_FOUND'));
        socket.identity = { kind: 'spectator', sessionId: session.id };
        return next();
      }

      const raw = socket.handshake.auth?.token;
      if (typeof raw !== 'string' || !raw) {
        return next(new Error('AUTH_REQUIRED'));
      }

      if (role === 'host') {
        const { data, error } = await supabaseAdmin.auth.getUser(raw);
        if (error || !data.user) return next(new Error('INVALID_HOST_TOKEN'));
        socket.identity = {
          kind: 'host',
          userId: data.user.id,
          userEmail: data.user.email ?? null,
        };
        return next();
      }

      if (role === 'participant') {
        const decoded = verifyParticipantToken(raw);
        socket.identity = {
          kind: 'participant',
          participantId: decoded.participant_id,
          sessionId: decoded.session_id,
        };
        return next();
      }

      return next(new Error('UNKNOWN_ROLE'));
    } catch (err) {
      return next(err instanceof Error ? err : new Error('AUTH_FAILED'));
    }
  });

  io.on('connection', (socket: AuthedSocket) => {
    const identity = socket.identity;
    if (!identity) {
      socket.disconnect(true);
      return;
    }

    // Spectator : auto-join sa session room dès connexion (read-only).
    if (identity.kind === 'spectator') {
      void socket.join(roomName(identity.sessionId));
    }

    // ── Join by sessionId (joueur ou host avec ID connu) ─────────────
    socket.on(
      'session:join',
      async (payload: { sessionId: string }, ack?: (...args: unknown[]) => void) => {
        try {
          const sessionId = String(payload?.sessionId ?? '');
          if (!sessionId) throw new Error('sessionId manquant');

          if (identity.kind === 'host') {
            const session = await prisma.session.findFirst({
              where: {
                id: sessionId,
                establishment: {
                  workspace: { members: { some: { user_id: identity.userId } } },
                },
              },
              include: SESSION_INCLUDE,
            });
            if (!session) throw new Error('Session introuvable ou non autorisée');
            await socket.join(roomName(sessionId));
            const active_track = await buildSessionSnapshot(session);
            const cumulative = await buildCumulativeSnapshot(session);
            ack?.({
              ok: true,
              session: serializeSession(session),
              active_track,
              cumulative,
            });
            return;
          }

          if (identity.sessionId !== sessionId) {
            throw new Error('Session ID ne correspond pas au token');
          }
          const session = await prisma.session.findUnique({
            where: { id: sessionId },
            include: SESSION_INCLUDE,
          });
          if (!session) throw new Error('Session introuvable');
          await socket.join(roomName(sessionId));
          const active_track = await buildSessionSnapshot(session);
          const cumulative = await buildCumulativeSnapshot(session);
          ack?.({
            ok: true,
            session: serializeSession(session),
            active_track,
            cumulative,
          });
        } catch (err) {
          ack?.({ ok: false, error: (err as Error).message });
        }
      },
    );

    // ── Join by short_code (host qui ne connaît que le code) ─────────
    socket.on(
      'session:join_by_code',
      async (payload: { shortCode: string }, ack?: (...args: unknown[]) => void) => {
        try {
          if (identity.kind !== 'host') throw new Error('Réservé au host');
          const shortCode = String(payload?.shortCode ?? '').toUpperCase();
          if (!shortCode) throw new Error('shortCode manquant');
          const session = await prisma.session.findFirst({
            where: {
              short_code: shortCode,
              establishment: {
                workspace: { members: { some: { user_id: identity.userId } } },
              },
            },
            include: SESSION_INCLUDE,
          });
          if (!session) throw new Error('Session introuvable ou non autorisée');
          await socket.join(roomName(session.id));
          const active_track = await buildSessionSnapshot(session);
          const cumulative = await buildCumulativeSnapshot(session);
          ack?.({
            ok: true,
            session: serializeSession(session),
            active_track,
            cumulative,
          });
        } catch (err) {
          ack?.({ ok: false, error: (err as Error).message });
        }
      },
    );

    socket.on('disconnect', () => {
      // Note V1 : on ne déclenche PAS de "participant:left" automatique sur
      // disconnect, pour tolérer les reconnexions (changement de réseau, écran
      // en veille…). Le host peut kicker manuellement si besoin.
    });
  });

  return io;
}

export function getIO(): SocketIOServer {
  if (!io) throw new Error("Socket.IO n'est pas initialisé");
  return io;
}

export function roomName(sessionId: string): string {
  return `session:${sessionId}`;
}

/** Helper : broadcast à tous les sockets d'une session (host + joueurs). */
export function broadcastToSession(sessionId: string, event: string, payload: unknown): void {
  if (!io) return;
  io.to(roomName(sessionId)).emit(event, payload);
}
