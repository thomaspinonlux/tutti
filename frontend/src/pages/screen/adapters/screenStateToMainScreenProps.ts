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
  // fix/classement-qui-disparait-en-pause — LE SERVEUR ENVOIE MAINTENANT LES
  // SCORES EN PAUSE. On les transmet au lieu de forcer des tableaux vides :
  // le classement et les joueurs ayant trouvé restent affichés pendant une
  // annonce de l'animateur, comme sur sa console.
  return {
    session: state.session,
    currentTrack: state.currentTrack,
    cumulative: state.cumulative ?? [],
    correctAnswers: state.correctAnswers ?? [],
    phase2StartedAt: null,
    lastReveal: null,
    activeBuzzCount: 0,
  };
}
