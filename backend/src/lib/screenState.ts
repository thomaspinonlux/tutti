/**
 * Computed screen state — source unique de vérité pour l'écran TV.
 *
 * Lit la DB à chaque appel (no cache, no in-memory state). Calcule l'état
 * déterministe à partir des rows sessions + session_rounds.
 *
 * États (priorité descendante) :
 *   FINAL_PODIUM  — session.status=ENDED + ended_at < 5min
 *   PAUSED        — session PLAYING + round PLAYING + is_paused=true
 *   PLAYING       — session PLAYING + round PLAYING + !is_paused
 *   ROUND_PODIUM  — session PLAYING + last round ENDED (entre 2 manches)
 *   LOBBY         — session WAITING ou PLAYING sans round actif
 *   IDLE          — pas de session active dans la fenêtre temporelle
 *
 * Time-window filter (anti-zombie) :
 *   - Sessions ENDED gardées 5min après ended_at (pour afficher le podium final)
 *   - Sessions non-ENDED gardées si created_at < 4h ET updated_at < 30min
 *     (au-delà = abandonnée silencieusement)
 */

import type {
  CorrectAnswerEntry,
  CumulativeScore,
  CurrentTrackState,
  SessionWithParticipants,
} from '@tutti/shared';
import { prisma } from './prisma.js';
import { getCumulativeScores } from './scores.js';
import { buildCurrentTrackStateSnapshot } from './gameplayCore.js';
import type { GameMode, Team } from '@tutti/shared';

export type ScreenState =
  | { state: 'IDLE'; lastUpdate: string }
  | {
      state: 'LOBBY';
      sessionId: string;
      joinCode: string;
      sessionName: string | null;
      players: Array<{ id: string; pseudo: string; team_id: string | null }>;
      lastUpdate: string;
    }
  | {
      state: 'PLAYING';
      sessionId: string;
      joinCode: string;
      sessionName: string | null;
      /**
       * Vue session enrichie pour MainScreenView (rounds + participants +
       * is_paused + has_animator + mode). Sérialisée à chaque tick — payload
       * borné (~30 joueurs × ~10 rounds = ~5KB max).
       */
      session: SessionWithParticipants;
      currentTrack: CurrentTrackState | null;
      cumulative: CumulativeScore[];
      correctAnswers: CorrectAnswerEntry[];
      phase2StartedAt: string | null;
      roundPosition: number;
      roundsTotal: number;
      lastUpdate: string;
    }
  | {
      state: 'PAUSED';
      sessionId: string;
      joinCode: string;
      sessionName: string | null;
      session: SessionWithParticipants;
      currentTrack: CurrentTrackState | null;
      lastUpdate: string;
    }
  | {
      state: 'ROUND_PODIUM';
      sessionId: string;
      joinCode: string;
      sessionName: string | null;
      cumulative: CumulativeScore[];
      lastEndedRoundPosition: number;
      lastUpdate: string;
    }
  | {
      state: 'FINAL_PODIUM';
      sessionId: string;
      joinCode: string;
      sessionName: string | null;
      finalScores: CumulativeScore[];
      lastUpdate: string;
    };

const FINAL_PODIUM_WINDOW_MS = 5 * 60 * 1000; // 5 min après ended_at
const ZOMBIE_CREATED_WINDOW_MS = 4 * 60 * 60 * 1000; // 4h max depuis création

/**
 * Cherche la session "représentative" du workspace pour le screen-state.
 *
 * Priorité (révisée — Issue 2 du 6 mai) :
 *   1. Session WAITING/PLAYING active (créée dans les 4h anti-zombie)
 *      → l'admin a démarré une nouvelle session, on bascule dessus
 *   2. Sinon session ENDED < 5min ago (pour podium final résiduel)
 *   3. Sinon null → IDLE
 *
 * Avant : ENDED prioritaire → bug TV restée bloquée sur podium ancien
 * pendant 5min même quand une nouvelle session était lancée. Fix : active
 * d'abord, podium final seulement quand plus rien d'actif.
 */
async function findRepresentativeSession(workspaceId: string) {
  const now = new Date();
  const finalPodiumCutoff = new Date(now.getTime() - FINAL_PODIUM_WINDOW_MS);
  const zombieCreatedCutoff = new Date(now.getTime() - ZOMBIE_CREATED_WINDOW_MS);

  // [DIAG fix/library-end-session-strict-alignment] log all candidates
  const allCandidates = await prisma.session.findMany({
    where: { establishment: { workspace_id: workspaceId } },
    orderBy: { created_at: 'desc' },
    take: 5,
    select: {
      id: true,
      status: true,
      is_paused: true,
      created_at: true,
      ended_at: true,
      short_code: true,
      rounds: {
        select: {
          id: true,
          status: true,
          position: true,
          playlist: { select: { is_official_tutti: true } },
        },
        orderBy: { position: 'asc' },
      },
    },
  });
  console.info(
    `[DIAG findRepSession] workspace=${workspaceId} candidates(top5)=`,
    JSON.stringify(
      allCandidates.map((s) => ({
        id: s.id,
        status: s.status,
        is_paused: s.is_paused,
        short_code: s.short_code,
        created_at: s.created_at.toISOString(),
        ended_at: s.ended_at?.toISOString() ?? null,
        age_min: ((now.getTime() - s.created_at.getTime()) / 60000).toFixed(1),
        ended_age_min: s.ended_at
          ? ((now.getTime() - s.ended_at.getTime()) / 60000).toFixed(1)
          : null,
        has_official_round: s.rounds.some((r) => r.playlist?.is_official_tutti === true),
        rounds: s.rounds.map((r) => `${r.position}:${r.status}`).join(','),
      })),
    ),
  );

  // 1. WAITING/PLAYING active, créée dans les 4h (anti-zombie). Prioritaire
  // pour que la TV bascule sur une nouvelle session dès qu'elle est créée.
  const active = await prisma.session.findFirst({
    where: {
      establishment: { workspace_id: workspaceId },
      status: { in: ['WAITING', 'PLAYING'] },
      created_at: { gte: zombieCreatedCutoff },
    },
    orderBy: { created_at: 'desc' },
    include: {
      participants: { where: { is_kicked: false } },
      rounds: {
        orderBy: { position: 'asc' },
        include: {
          playlist: {
            select: {
              id: true,
              name: true,
              level: true,
              is_official_tutti: true,
              _count: { select: { playlist_tracks: true } },
            },
          },
        },
      },
    },
  });
  if (active) {
    console.info(
      `[DIAG findRepSession] -> ACTIVE session=${active.id} status=${active.status} is_paused=${active.is_paused} rounds=${active.rounds.map((r) => `${r.position}:${r.status}:${r.playlist.is_official_tutti ? 'OFFI' : 'PERSO'}`).join(',')}`,
    );
    return active;
  }

  // 2. Pas d'active → fallback ENDED <5min pour afficher le podium final
  // résiduel. Si l'admin lance une nouvelle session après, la session active
  // (étape 1 ci-dessus) la masquera immédiatement.
  const endedRecent = await prisma.session.findFirst({
    where: {
      establishment: { workspace_id: workspaceId },
      status: 'ENDED',
      ended_at: { gte: finalPodiumCutoff },
    },
    orderBy: { ended_at: 'desc' },
    include: {
      participants: { where: { is_kicked: false } },
      rounds: {
        orderBy: { position: 'asc' },
        include: {
          playlist: {
            select: {
              id: true,
              name: true,
              level: true,
              is_official_tutti: true,
              _count: { select: { playlist_tracks: true } },
            },
          },
        },
      },
    },
  });
  console.info(
    `[DIAG findRepSession] -> ${endedRecent ? `ENDED_RECENT session=${endedRecent.id} ended_at=${endedRecent.ended_at?.toISOString()}` : 'NULL (idle)'}`,
  );
  return endedRecent ?? null;
}

/**
 * Sérialise une session Prisma chargée (avec participants + rounds.playlist
 * incluant _count.playlist_tracks) au format SessionWithParticipants pour le
 * frontend. Convertit aussi _count.playlist_tracks → tracks_count.
 */
function serializeSession(
  session: Awaited<ReturnType<typeof findRepresentativeSession>>,
): SessionWithParticipants {
  if (!session) {
    throw new Error('serializeSession called with null session');
  }
  return {
    id: session.id,
    establishment_id: session.establishment_id,
    name: session.name,
    game_type: session.game_type,
    status: session.status,
    short_code: session.short_code,
    mode: session.mode,
    teams_config: (session.teams_config as Team[] | null) ?? null,
    language: session.language,
    question_set_id: session.question_set_id ?? null,
    has_animator: session.has_animator,
    is_paused: session.is_paused,
    buzz_window_seconds: session.buzz_window_seconds,
    max_participants: session.max_participants,
    created_at: session.created_at.toISOString(),
    started_at: session.started_at ? session.started_at.toISOString() : null,
    ended_at: session.ended_at ? session.ended_at.toISOString() : null,
    participants: session.participants.map((p) => ({
      id: p.id,
      session_id: p.session_id,
      pseudo: p.pseudo,
      team_id: p.team_id,
      is_master: p.is_master,
      is_kicked: p.is_kicked,
      joined_at: p.joined_at.toISOString(),
    })),
    rounds: session.rounds.map((r) => ({
      id: r.id,
      session_id: r.session_id,
      playlist_id: r.playlist_id,
      position: r.position,
      status: r.status,
      current_track_index: r.current_track_index,
      started_at: r.started_at ? r.started_at.toISOString() : null,
      ended_at: r.ended_at ? r.ended_at.toISOString() : null,
      created_at: r.created_at.toISOString(),
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
 * Calcule l'état screen actuel pour un workspace donné. Lit la DB à chaque
 * appel — déterministe, no cache.
 */
export async function computeScreenState(workspaceId: string): Promise<ScreenState> {
  const lastUpdate = new Date().toISOString();
  const session = await findRepresentativeSession(workspaceId);

  if (!session) {
    console.info(`[ScreenState] Workspace ${workspaceId} → IDLE (pas de session active)`);
    return { state: 'IDLE', lastUpdate };
  }

  const players = session.participants.map((p) => ({
    id: p.id,
    pseudo: p.pseudo,
    team_id: p.team_id,
  }));

  // FINAL_PODIUM : session ENDED dans la fenêtre 5min
  if (session.status === 'ENDED') {
    const finalScores = await getCumulativeScores({
      sessionId: session.id,
      mode: session.mode as GameMode,
      teams: (session.teams_config as Team[] | null) ?? null,
      participants: players,
    });
    console.info(`[ScreenState] Workspace ${workspaceId} → FINAL_PODIUM (session=${session.id})`);
    return {
      state: 'FINAL_PODIUM',
      sessionId: session.id,
      joinCode: session.short_code,
      sessionName: session.name,
      finalScores,
      lastUpdate,
    };
  }

  const playingRound = session.rounds.find((r) => r.status === 'PLAYING');
  const lastEndedRound = [...session.rounds].reverse().find((r) => r.status === 'ENDED');
  const roundsTotal = session.rounds.length;

  // PAUSED : session PLAYING + round PLAYING + is_paused
  if (playingRound && session.is_paused) {
    const currentTrack = await buildCurrentTrackStateSnapshot(playingRound.id);
    console.info(
      `[ScreenState] Workspace ${workspaceId} → PAUSED (session=${session.id}, round=${playingRound.position})`,
    );
    return {
      state: 'PAUSED',
      sessionId: session.id,
      joinCode: session.short_code,
      sessionName: session.name,
      session: serializeSession(session),
      currentTrack,
      lastUpdate,
    };
  }

  // PLAYING : session PLAYING + round PLAYING + !is_paused
  if (playingRound && !session.is_paused) {
    const currentTrack = await buildCurrentTrackStateSnapshot(playingRound.id);
    const cumulative = await getCumulativeScores({
      sessionId: session.id,
      mode: session.mode as GameMode,
      teams: (session.teams_config as Team[] | null) ?? null,
      participants: players,
    });
    console.info(
      `[ScreenState] Workspace ${workspaceId} → PLAYING (session=${session.id}, round=${playingRound.position}/${roundsTotal})`,
    );
    return {
      state: 'PLAYING',
      sessionId: session.id,
      joinCode: session.short_code,
      sessionName: session.name,
      session: serializeSession(session),
      currentTrack,
      cumulative,
      correctAnswers: currentTrack?.correct_answers ?? [],
      phase2StartedAt: currentTrack?.phase2_started_at ?? null,
      roundPosition: playingRound.position,
      roundsTotal,
      lastUpdate,
    };
  }

  // ROUND_PODIUM : session PLAYING (status) ET dernier round ENDED (entre 2 manches)
  if (lastEndedRound && session.status === 'PLAYING') {
    const cumulative = await getCumulativeScores({
      sessionId: session.id,
      mode: session.mode as GameMode,
      teams: (session.teams_config as Team[] | null) ?? null,
      participants: players,
    });
    console.info(
      `[ScreenState] Workspace ${workspaceId} → ROUND_PODIUM (session=${session.id}, lastRound=${lastEndedRound.position})`,
    );
    return {
      state: 'ROUND_PODIUM',
      sessionId: session.id,
      joinCode: session.short_code,
      sessionName: session.name,
      cumulative,
      lastEndedRoundPosition: lastEndedRound.position,
      lastUpdate,
    };
  }

  // LOBBY : session WAITING ou PLAYING sans round actif
  console.info(
    `[ScreenState] Workspace ${workspaceId} → LOBBY (session=${session.id}, players=${players.length})`,
  );
  return {
    state: 'LOBBY',
    sessionId: session.id,
    joinCode: session.short_code,
    sessionName: session.name,
    players,
    lastUpdate,
  };
}
