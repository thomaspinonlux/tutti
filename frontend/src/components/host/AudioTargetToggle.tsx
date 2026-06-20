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

  // feat/arcade-buttons-vinyl-buzzer — toggle pill arcade : bord 2px ink,
  // track basil (green) ON / cream OFF, knob cream avec ombre dure ; press
  // arcade (translate + shadow flat) cohérent avec <Button />.
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      aria-pressed={onTv}
      aria-label={label}
      title={label}
      className={`group flex items-center gap-2 pl-1 pr-3 py-1 border-2 border-ink rounded-full shadow-arcade-sm transition-all duration-[80ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-arcade-flat disabled:opacity-[0.38] disabled:active:translate-x-0 disabled:active:translate-y-0 ${
        onTv ? 'bg-basil text-cream' : 'bg-cream text-ink hover:bg-cream-2'
      }`}
    >
      <span
        aria-hidden
        className={`flex items-center justify-center w-7 h-7 rounded-full border-2 border-ink shadow-arcade-flat text-base ${
          onTv ? 'bg-cream text-ink translate-x-0' : 'bg-cream text-ink'
        }`}
      >
        {onTv ? '📺' : '🎧'}
      </span>
      <span className="font-mono text-xs uppercase tracking-wider hidden sm:inline">{label}</span>
    </button>
  );
}
