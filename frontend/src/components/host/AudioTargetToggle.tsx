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
  /**
   * `tv_audio_armed` courant (screen-state). Quand la cible = TV mais aucun
   * écran TV n'est armé (= personne n'a cliqué « Activer le son » côté TV), le
   * son retombe sur le host (cf. resolveAudioSink) → le transfert "ne marche
   * pas". On affiche alors un hint expliquant l'étape de connexion manquante.
   */
  armed?: boolean;
  disabled?: boolean;
}

export function AudioTargetToggle({ value, onChange, armed, disabled }: Props): JSX.Element {
  const { t } = useTranslation();
  const onTv = value === 'tv';
  // Cible TV choisie mais aucun écran TV armé → le son reste sur le host.
  const showHint = onTv && !armed;

  const handleSet = (next: AudioTarget): void => {
    if (next === value) return;
    onChange(next);
    void postAudioTarget(next).catch((err: unknown) => {
      console.warn('[AudioTargetToggle] POST failed:', err);
    });
  };

  // feat/audio-sink-capsule — capsule 2 segments [ 🎧 Son ici | 📺 Son sur la
  // TV ]. Segment actif = fond plein contrasté, inactif = grisé. Même capsule
  // côté TV (TvAudioOutput). État sync host⇄TV via audio_target.
  const segments: Array<{ tgt: AudioTarget; icon: string; label: string; activeCls: string }> = [
    {
      tgt: 'host',
      icon: '🎧',
      label: t('host.audioTarget.onHost'),
      activeCls: 'bg-spritz text-ink',
    },
    { tgt: 'tv', icon: '📺', label: t('host.audioTarget.onTv'), activeCls: 'bg-basil text-cream' },
  ];
  return (
    <div className="relative">
      <div
        className="inline-flex border-2 border-ink rounded-full overflow-hidden shadow-arcade-sm"
        role="group"
        aria-label={`${t('host.audioTarget.onHost')} / ${t('host.audioTarget.onTv')}`}
      >
        {segments.map((s) => {
          const active = value === s.tgt;
          return (
            <button
              key={s.tgt}
              type="button"
              onClick={() => handleSet(s.tgt)}
              disabled={disabled}
              aria-pressed={active}
              title={s.label}
              className={`flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors disabled:opacity-[0.38] ${
                active ? s.activeCls : 'bg-cream text-ink-soft/60 hover:bg-cream-2'
              }`}
            >
              <span aria-hidden className="text-base">
                {s.icon}
              </span>
              <span className="hidden sm:inline">{s.label}</span>
            </button>
          );
        })}
      </div>

      {/* Hint de connexion : la cible TV est sélectionnée mais aucun écran TV
          n'a armé son audio → on explique l'étape manquante. Popover absolu
          (n'affecte pas le layout de la barre), auto-disparaît dès que la TV
          arme (armed=true). pointer-events-none : ne bloque aucun clic. */}
      {showHint && (
        <div className="absolute right-0 top-full mt-2 w-60 z-50 bg-cream border-2 border-ink rounded-xl shadow-arcade-sm px-3 py-2 text-left animate-pop-in pointer-events-none">
          <p className="font-mono text-[11px] leading-snug text-ink">
            {t('host.audioTarget.connectHint')}
          </p>
        </div>
      )}
    </div>
  );
}
