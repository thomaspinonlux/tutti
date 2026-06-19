/**
 * <AudioTargetToggle /> — feat/tv-audio-output
 *
 * Toggle host (à côté de TvCastButton) pour router le son vers l'écran TV
 * ouvert via tv_code sur un appareil séparé. Opt-in, jamais forcé :
 *   - défaut "host" (comportement actuel, son sur la tablette animateur)
 *   - clic → bascule sur "tv" : la TV (si elle a cliqué "Activer le son")
 *     prend le relais audio, le host devient muet mais garde tous les
 *     contrôles (play/pause/seek/next → serveur → TV).
 *
 * Si la TV se déconnecte / unmount, le store backend laisse expirer le flag
 * `tv_audio_armed` (TTL 60s) → la résolution du sink retombe sur host →
 * jamais de silence. L'animateur peut re-toggle "host" à tout moment.
 */

import { useTranslation } from 'react-i18next';
import { postAudioTarget } from '../../lib/screenState.js';
import type { AudioTarget } from '../../lib/audioSink.js';

interface Props {
  /** Valeur courante (lue du screen-state polling). */
  value: AudioTarget;
  /** Callback optimistic update local. */
  onChange: (next: AudioTarget) => void;
  disabled?: boolean;
}

export function AudioTargetToggle({ value, onChange, disabled }: Props): JSX.Element {
  const { t } = useTranslation();
  const onTv = value === 'tv';
  const label = onTv ? t('host.audioTarget.onTv') : t('host.audioTarget.onHost');

  const handleClick = (): void => {
    const next: AudioTarget = onTv ? 'host' : 'tv';
    onChange(next);
    void postAudioTarget(next).catch((err: unknown) => {
      console.warn('[AudioTargetToggle] POST failed:', err);
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      aria-pressed={onTv}
      aria-label={label}
      title={label}
      className={`flex items-center gap-1.5 px-3 py-2 border-2 border-ink rounded-lg font-mono text-xs uppercase tracking-wider transition-colors disabled:opacity-50 ${
        onTv ? 'bg-spritz text-cream shadow-pop-sm' : 'bg-cream text-ink hover:bg-cream-2'
      }`}
    >
      <span aria-hidden>{onTv ? '📺🔊' : '🎧'}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
