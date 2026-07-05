/**
 * PlayerControls — barre de contrôle de la console animateur.
 *
 * Hiérarchie claire (affordance) :
 *   - 1 action PRINCIPALE proéminente : « Morceau suivant → ».
 *   - 1 rangée TRANSPORT : Pause/Reprendre, Recommencer, Révéler.
 *   - 1 action TERTIAIRE discrète : « Terminer la manche ».
 * Aucune logique : reçoit les handlers, le parent pilote.
 *
 * Deux thèmes : clair (arcade crème, défaut) et `dark` (console premium,
 * cohérent avec l'écran TV — CTA coral, transport en boutons verre).
 */

import { useTranslation } from 'react-i18next';
import type { CurrentTrackState } from '@tutti/shared';
import { Button } from '../ui/index.js';

const CORAL = '#FF5C4D';

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
  /** Thème sombre (console premium) — défaut clair (identité crème). */
  dark?: boolean;
}

/** Bouton "verre" sombre (transport) — affordance nette sur fond foncé. */
function GlassButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-11 items-center gap-2 rounded-2xl border border-white/15 bg-white/[0.07] px-4 text-sm font-bold text-white backdrop-blur-md transition-colors hover:bg-white/[0.14] active:scale-[0.97] disabled:opacity-40"
    >
      {children}
    </button>
  );
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
  dark = false,
}: PlayerControlsProps): JSX.Element {
  const { t } = useTranslation();
  const isLastTrack = !!currentTrack && currentTrack.track_index >= totalTracks - 1;
  const canReveal =
    !!currentTrack && (currentTrack.phase === 'phase1' || currentTrack.phase === 'phase2');
  const nextLabel = `${isLastTrack ? t('host.viewRanking') : t('host.nextTrack')} →`;

  // ── Thème SOMBRE (console premium, cohérent TV) ──────────────────────────
  if (dark) {
    return (
      <div className="mt-6 flex flex-col items-center gap-4">
        {currentTrack && (
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            {!isPaused ? (
              <GlassButton onClick={onPauseAudio} disabled={busy}>
                ⏸ {t('host.pauseAudio')}
              </GlassButton>
            ) : (
              <button
                type="button"
                onClick={onResumeAudio}
                disabled={busy}
                className="inline-flex h-11 items-center gap-2 rounded-2xl px-5 text-sm font-bold text-[#0B0B0F] transition-transform active:scale-[0.97] disabled:opacity-40"
                style={{ backgroundColor: '#4ade80' }}
              >
                ▶ {t('host.resumeAudio')}
              </button>
            )}
            <GlassButton onClick={onRestartTrack} disabled={busy}>
              🔄 {t('host.restartTrack')}
            </GlassButton>
            {canReveal && (
              <GlassButton onClick={onRevealAnswer} disabled={busy}>
                💡 {t('host.revealAnswer')}
              </GlassButton>
            )}
          </div>
        )}

        {/* CTA principal = coral (accent TV). */}
        <button
          type="button"
          onClick={onNextTrack}
          disabled={busy || !currentTrack}
          className="h-14 w-full max-w-md rounded-2xl text-lg font-black text-[#0B0B0F] transition-transform active:scale-[0.98] disabled:opacity-40"
          style={{ backgroundColor: CORAL, boxShadow: `0 10px 34px ${CORAL}55` }}
        >
          {nextLabel}
        </button>

        <button
          type="button"
          onClick={onEndRound}
          disabled={busy}
          className="font-mono text-xs uppercase tracking-[0.2em] text-white/45 underline underline-offset-4 transition-colors hover:text-white/80 disabled:opacity-40"
        >
          {t('host.endRound')}
        </button>
      </div>
    );
  }

  // ── Thème CLAIR (arcade crème, défaut) ───────────────────────────────────
  return (
    <div className="mt-6 flex flex-col items-center gap-4">
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

      <Button
        variant="primary"
        size="lg"
        className="w-full max-w-md"
        onClick={onNextTrack}
        disabled={busy || !currentTrack}
      >
        {nextLabel}
      </Button>

      <Button variant="ghost" size="sm" onClick={onEndRound} disabled={busy}>
        {t('host.endRound')}
      </Button>
    </div>
  );
}
