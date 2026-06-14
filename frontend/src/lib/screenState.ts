/**
 * Wrapper API /api/workspace/screen-state — source unique pour l'écran TV.
 *
 * Réécriture complète logique état TV : polling 2s, no socket, no cache.
 * Le backend calcule l'état from scratch en lisant la DB à chaque appel.
 */

import type {
  CorrectAnswerEntry,
  CumulativeScore,
  CurrentTrackState,
  SessionWithParticipants,
} from '@tutti/shared';
import { api } from './api.js';

export type ScreenStateValue =
  | 'IDLE'
  | 'LOBBY'
  | 'PLAYING'
  | 'PAUSED'
  | 'ROUND_PODIUM'
  | 'FINAL_PODIUM'
  | 'PLAYLIST_SELECTION';

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
       * is_paused + has_animator + mode). Permet à la TV v2 d'afficher
       * vinyl rotation, confettis, countdown, etc. via MainScreenView.
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
    }
  | {
      /** feat/tv-grid-mirror — la TV mirrore la GRILLE complète de l'écran de
       *  sélection animateur (catalogue fetché par la TV elle-même), highlight
       *  la playlist centrée et applique le scroll de l'animateur. */
      state: 'PLAYLIST_SELECTION';
      sessionId: string;
      joinCode: string;
      sessionName: string | null;
      /** Playlist centrée côté animateur → carte highlightée sur la TV. */
      focused_playlist_id: string;
      /** Position de scroll de la grille host, ratio 0..1. */
      scroll_ratio: number;
      lastUpdate: string;
    };

/**
 * POST la sélection courante : playlist centrée (null = sortie sélection) +
 * position de scroll de la grille (ratio 0..1) pour le scroll-sync TV.
 */
export async function postFocusedPlaylist(
  playlistId: string | null,
  scrollRatio?: number,
): Promise<void> {
  await api('/api/workspace/screen-state/focused-playlist', {
    method: 'POST',
    body: { playlist_id: playlistId, scroll_ratio: scrollRatio },
  });
}

/**
 * Récupère l'état screen actuel.
 * - Avec workspaceId : endpoint public (cross-browser TV)
 * - Sans workspaceId : endpoint authenticated (auto-detect via cookies Supabase)
 */
export async function getScreenState(workspaceId?: string): Promise<ScreenState> {
  const url = workspaceId
    ? `/api/workspace/screen-state/${encodeURIComponent(workspaceId)}`
    : '/api/workspace/screen-state';
  return api<ScreenState>(url);
}

/**
 * Abandon silencieux d'une session (admin retour dashboard sans cliquer
 * "Terminer le blind test"). Marque ENDED en DB sans broadcast.
 */
export async function abandonSession(sessionId: string): Promise<void> {
  await api(`/api/sessions/${encodeURIComponent(sessionId)}/abandon`, {
    method: 'POST',
  });
}
