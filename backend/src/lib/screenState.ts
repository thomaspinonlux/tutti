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

import type { CorrectAnswerEntry, CumulativeScore, CurrentTrackState } from '@tutti/shared';
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
 * Cherche la session "représentative" du workspace pour le screen-state :
 *   1. Session ENDED < 5min ago (pour podium final)
 *   2. Sinon session WAITING/PLAYING dans fenêtre temporelle valide
 *   3. Sinon null → IDLE
 */
async function findRepresentativeSession(workspaceId: string) {
  const now = new Date();
  const finalPodiumCutoff = new Date(now.getTime() - FINAL_PODIUM_WINDOW_MS);
  const zombieCreatedCutoff = new Date(now.getTime() - ZOMBIE_CREATED_WINDOW_MS);

  // 1. ENDED récente — la + récente, dans la fenêtre podium final
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
        include: { playlist: { select: { id: true, name: true, level: true } } },
      },
    },
  });
  if (endedRecent) return endedRecent;

  // 2. WAITING/PLAYING active, créée dans les 4h (anti-zombie). Note V1 :
  // pas de filtre sur "activité dernière 30min" car Session model n'a pas
  // de updated_at. À ajouter via migration si besoin futur.
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
        include: { playlist: { select: { id: true, name: true, level: true } } },
      },
    },
  });
  return active ?? null;
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
