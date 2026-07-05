/**
 * PlayerControls — barre de contrôle de la console animateur (mode A iPad).
 *
 * Refonte affordance : avant, les commandes étaient des <Button variant="ghost">
 * (texte souligné, sans bord ni ombre) empilées sur 2 rangées → « pas très
 * visible comme bouton » + fouillis. Ici, hiérarchie claire :
 *   - 1 action PRINCIPALE proéminente : « Morceau suivant → » (primary arcade).
 *   - 1 rangée TRANSPORT en boutons bordés (secondary arcade) : Pause/Reprendre,
 *     Recommencer, Révéler — chacun avec bord + ombre dure = vraie affordance.
 *   - 1 action discrète : « Terminer la manche » (ghost, tertiaire).
 * Aucune logique : reçoit les handlers, le composant parent pilote.
 */

import { useTranslation } from 'react-i18next';
import type { CurrentTrackState } from '@tutti/shared';
import { Button } from '../ui/index.js';

export interface PlayerControlsProps {
  currentTrack: CurrentTrackState | null;
  isPaused: boolean;
  busy: boolean;
  totalTracks: number;
  onNextTrack: () => void;
  onEndRound: () => void;
  onPauseAudio: () => void;
  onResumeAudio: () => void;
  onRestartTrack: () => void;
  onRevealAnswer: () => void;
}

export function PlayerControls({
  currentTrack,
  isPaused,
  busy,
  totalTracks,
  onNextTrack,
  onEndRound,
  onPauseAudio,
  onResumeAudio,
  onRestartTrack,
  onRevealAnswer,
}: PlayerControlsProps): JSX.Element {
  const { t } = useTranslation();
  const isLastTrack = !!currentTrack && currentTrack.track_index >= totalTracks - 1;
  const canReveal =
    !!currentTrack && (currentTrack.phase === 'phase1' || currentTrack.phase === 'phase2');

  return (
    <div className="mt-6 flex flex-col items-center gap-4">
      {/* ── Rangée TRANSPORT : boutons bordés (vraie affordance) ─────────── */}
      {currentTrack && (
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          {!isPaused ? (
            <Button variant="secondary" size="sm" onClick={onPauseAudio} disabled={busy}>
              ⏸ {t('host.pauseAudio')}
            </Button>
          ) : (
            <Button variant="success" size="sm" onClick={onResumeAudio} disabled={busy}>
              ▶ {t('host.resumeAudio')}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onRestartTrack} disabled={busy}>
            🔄 {t('host.restartTrack')}
          </Button>
          {canReveal && (
            <Button variant="secondary" size="sm" onClick={onRevealAnswer} disabled={busy}>
              💡 {t('host.revealAnswer')}
            </Button>
          )}
        </div>
      )}

      {/* ── Action PRINCIPALE : proéminente, isolée ──────────────────────── */}
      <Button
        variant="primary"
        size="lg"
        className="w-full max-w-md"
        onClick={onNextTrack}
        disabled={busy || !currentTrack}
      >
        {isLastTrack ? t('host.viewRanking') : t('host.nextTrack')} →
      </Button>

      {/* ── Action TERTIAIRE : discrète ──────────────────────────────────── */}
      <Button variant="ghost" size="sm" onClick={onEndRound} disabled={busy}>
        {t('host.endRound')}
      </Button>
    </div>
  );
}
