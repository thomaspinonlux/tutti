/**
 * Adapter ScreenState (PLAYING/PAUSED) → MainScreenViewProps.
 *
 * Permet à ScreenPage v2 (polling /screen-state) de réutiliser la riche
 * vue MainScreenView (confettis, countdown 15s, vinyl rotation, dance pulse,
 * reveal cover, phase eyebrow, etc.) sans dupliquer la logique d'affichage.
 *
 * Champs non-disponibles côté TV (TV est passive, pas de buzz socket events
 * directs) :
 *   - lastReveal      : null (synthétisé par HostPage via socket track:reveal)
 *   - activeBuzzCount : 0    (compteur phase 1 alimenté par socket buzz events)
 *   - positionMs/durationMs : undefined (pas de SDK audio sur la TV)
 *   - busy/onSkipTrack/onGiveAnswer/onNextTrack : undefined (TV pas d'admin)
 *
 * Ces fallback sont volontaires : la TV affiche correctement sans eux.
 * MainScreenView teste explicitement leur présence avant de rendre.
 */

import type { MainScreenViewProps } from '../MainScreenView.js';
import type { ScreenState } from '../../../lib/screenState.js';

type PlayingOrPaused = Extract<ScreenState, { state: 'PLAYING' | 'PAUSED' }>;

export function screenStateToMainScreenProps(state: PlayingOrPaused): MainScreenViewProps {
  if (state.state === 'PLAYING') {
    return {
      session: state.session,
      currentTrack: state.currentTrack,
      cumulative: state.cumulative,
      correctAnswers: state.correctAnswers,
      phase2StartedAt: state.phase2StartedAt,
      lastReveal: null,
      activeBuzzCount: 0,
      // pas de positionMs/durationMs côté TV — MainScreenView gère undefined
    };
  }
  // PAUSED : pas de scoreboard cumulé exposé dans cet état; on passe [].
  return {
    session: state.session,
    currentTrack: state.currentTrack,
    cumulative: [],
    correctAnswers: [],
    phase2StartedAt: null,
    lastReveal: null,
    activeBuzzCount: 0,
  };
}
