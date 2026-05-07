/**
 * PreGameStartScreen — Bug 3 (fix/critical-bugs-v3).
 *
 * Écran intermédiaire affiché entre la sélection de playlist et le 1er
 * morceau du blind test. Bouton GROS "▶ Démarrer le blind test" qui :
 *   - constitue un User Gesture frais → débloque l'autoplay policy navigateur
 *   - déclenche la création/start du round + playTrack via `onStart`
 *
 * Avant ce fix, le clic sur la card playlist déclenchait directement la
 * chaîne async create+start+play, et le gesture user était considéré
 * "stale" par Chrome au moment où le SDK (Spotify ou YouTube) appelait
 * play() → audio bloqué les 1ères secondes.
 */

import { useTranslation } from 'react-i18next';
import { Button, MultiColorBar, TitleHandwritten, Underline } from '../../components/ui/index.js';

interface Props {
  /** Nom affiché de la playlist (FR ou EN selon locale courante). */
  playlistName: string;
  /** Nombre de morceaux jouables (déjà filtré côté caller). */
  trackCount: number;
  /** Affiché si le caller a un sous-titre additionnel (ex: "Officiel Tutti"). */
  badge?: string | null;
  /** Source utilisée (Spotify / YouTube) — informatif. */
  providerLabel?: string | null;
  /** Loading externe : désactive le bouton pendant la chaîne async. */
  busy?: boolean;
  onStart: () => void;
  onCancel?: () => void;
}

export function PreGameStartScreen({
  playlistName,
  trackCount,
  badge,
  providerLabel,
  busy = false,
  onStart,
  onCancel,
}: Props): JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen flex flex-col bg-[#7a8a9a]">
      <MultiColorBar height="md" />
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="text-center max-w-2xl">
          {badge && (
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-cream/80 mb-3">
              {badge}
            </p>
          )}
          <TitleHandwritten as="h1" className="text-cream text-5xl md:text-7xl mb-4">
            <Underline>{t('preGame.readyTitle')}</Underline>
          </TitleHandwritten>
          <p className="font-editorial italic text-cream text-2xl md:text-3xl mb-2">
            {playlistName}
          </p>
          <p className="font-mono text-cream/80 text-base md:text-lg mb-12">
            {t('preGame.trackCount', { count: trackCount })}
            {providerLabel && (
              <span className="ml-2 px-2 py-0.5 border border-cream/40 rounded-full text-xs uppercase tracking-wider">
                {providerLabel}
              </span>
            )}
          </p>

          <Button
            type="button"
            size="lg"
            variant="primary"
            disabled={busy}
            onClick={() => {
              console.info('[PreGame] Click — Démarrer le blind test');
              onStart();
            }}
            className="!min-w-[260px] !py-5 !text-2xl !font-bold uppercase tracking-wide"
          >
            {busy ? '⏳ ' + t('preGame.starting') : '▶ ' + t('preGame.startButton')}
          </Button>

          {onCancel && (
            <div className="mt-6">
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="font-mono text-sm text-cream/70 hover:text-cream underline disabled:opacity-50"
              >
                {t('preGame.cancel')}
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
