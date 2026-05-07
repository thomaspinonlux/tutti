/**
 * PreGameStartScreen — Bug 3 (fix/critical-bugs-v3) + Bug B v5
 * (fix/playback-and-host-render-v5).
 *
 * Écran intermédiaire affiché entre la sélection de playlist et le 1er
 * morceau du blind test. Bouton GROS "▶ Démarrer le blind test" qui :
 *   - constitue un User Gesture frais → débloque l'autoplay policy navigateur
 *   - déclenche la création/start du round + playTrack via `onStart`
 *
 * Bug B v5 — PR #15 cueVideoById insuffisant. Le `playVideo()` du SDK
 * YouTube est appelé après plusieurs await + un round-trip socket, donc
 * Chrome a déjà invalidé le user gesture du clic. Symptôme : 1ère piste
 * ne démarre pas, host doit cliquer "Forcer audio" après refresh.
 *
 * Fix v5 — au moment du clic (synchrone, AVANT tout await ou Promise),
 * on déclenche un HTMLAudioElement.play() sur un buffer silencieux.
 * Cette action consomme le gesture pour le contexte audio du document
 * → unblock global du document. Les appels playVideo() asynchrones
 * suivants héritent alors du privilège audio.
 *
 * Référence : pattern courant pour libérer l'autoplay policy Chrome /
 * Safari, utilisé par les SDK Spotify Web et autres lecteurs musicaux.
 */

import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, MultiColorBar, TitleHandwritten, Underline } from '../../components/ui/index.js';

// 0.1s de silence WAV encodé en base64 — petit (44 bytes) et compatible
// tous navigateurs. Le contenu importe peu, c'est l'appel synchrone à
// .play() qui débloque le contexte audio du document.
const SILENT_WAV_DATA_URL =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

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
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);

  // Bug B v5 — handler SYNCHRONE qui exécute le play() avant tout await.
  // L'ordre est critique :
  //   1. Synchrone : .play() sur un audio silencieux → consomme le gesture
  //      utilisateur, débloque l'autoplay policy pour ce document.
  //   2. Synchrone : window.YT?.Player?.prototype?.playVideo si déjà prêt →
  //      claim immédiat même côté SDK YouTube si le player existe déjà.
  //   3. Async : onStart() qui fait createRound + startRound + playTrack.
  // Les appels async suivants (cueVideoById/playVideo/SDK Spotify) hériteront
  // du privilège audio acquis à l'étape 1.
  const handleStartClick = (): void => {
    const ts = Date.now();
    console.info(`[PreGame] Click handler executed at ${ts}`);
    console.info(
      `[PreGame] window.YT exists: ${typeof window !== 'undefined' && Boolean((window as unknown as { YT?: unknown }).YT)}`,
    );

    // Étape 1 — débloque autoplay via play() synchrone d'un audio silencieux.
    let unlocked = false;
    try {
      if (!silentAudioRef.current) {
        const a = new Audio(SILENT_WAV_DATA_URL);
        a.preload = 'auto';
        a.crossOrigin = 'anonymous';
        silentAudioRef.current = a;
      }
      const audio = silentAudioRef.current;
      audio.muted = false;
      audio.volume = 0.0001; // silence audible mais lecture validée
      // play() retourne une Promise. On NE l'attend pas pour préserver
      // la synchronicité du gesture handler.
      const playPromise = audio.play();
      unlocked = true;
      // Logging du résultat sans bloquer le gesture handler.
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise
          .then(() => console.info('[PreGame] Silent audio unlock OK'))
          .catch((err) =>
            console.warn('[PreGame] Silent audio unlock rejected (non-blocking):', err),
          );
      }
    } catch (err) {
      console.warn('[PreGame] Silent audio unlock threw (non-blocking):', err);
    }
    console.info(`[PreGame] playVideo() called sync: ${unlocked}`);

    // Étape 2 — déclenche onStart (async chain createRound → startRound →
    // playTrack). Pas d'await ici : le gesture est consommé par le play()
    // ci-dessus, le reste s'enchaîne en background.
    onStart();
  };

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
            onClick={handleStartClick}
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
