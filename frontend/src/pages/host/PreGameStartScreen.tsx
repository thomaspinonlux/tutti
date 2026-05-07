/**
 * PreGameStartScreen — overlay "Prêt à jouer ?" + unlock cross-browser
 * de l'autoplay (Safari, Chrome, Firefox, Edge).
 *
 * Historique :
 *   - PR #14 (Bug 3) : composant introduit pour fournir un user gesture
 *     dédié avant la chaîne async createRound+startRound+playTrack.
 *   - PR #15 (Bug B) : refacto cueVideoById → CUED → playVideo dans le
 *     SDK YouTube pour limiter le décalage gesture/play.
 *   - PR #17 (Bug B v5) : audio silencieux .play() synchrone dans le
 *     onClick handler.
 *   - Ce fix v6 (fix/cross-browser-autoplay-unlock) : ordre + détection.
 *
 * Spec v6 — handler onClick SYNCHRONE qui fait dans cet ordre :
 *
 *   1. Silent audio unlock — new Audio(silentWav).play() → claim audio
 *      context document (Promise non-awaited, sync-fired).
 *   2. YouTube IFrame warmup — playerInstance.playVideo() puis
 *      pauseVideo() après 50ms si SDK déjà prêt → claim côté SDK YT.
 *   3. onStart() — chaîne async createRound/startRound/playTrack.
 *
 * Détection unlock raté (Safari + content blockers, iOS) — après 1500ms,
 * on lit getPlayerState(). Si UNSTARTED ou PAUSED → l'unlock a échoué.
 * On affiche alors un overlay fallback "Cliquez pour démarrer la
 * lecture" qui fait un autre playVideo() au clic suivant.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, MultiColorBar, TitleHandwritten, Underline } from '../../components/ui/index.js';

// 0.1s de silence WAV encodé en base64 — 44 bytes inline. Le contenu
// importe peu, c'est l'appel synchrone à .play() qui débloque le contexte
// audio du document.
const SILENT_WAV_DATA_URL =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

// Constantes YT.PlayerState (cf. iframe API). Dupliquées localement pour
// ne pas dépendre du global `window.YT` qui pourrait pas être prêt.
// On compare contre UNSTARTED + PAUSED (= unlock raté). Tous les autres
// states (BUFFERING=3, PLAYING=1, CUED=5, ENDED=0) sont OK.
const YT_STATE_UNSTARTED = -1;
const YT_STATE_PAUSED = 2;

const UNLOCK_DETECTION_DELAY_MS = 1500;

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
  /**
   * v6 — primitive sync exposée par useYouTubePlayer pour claim audio
   * côté SDK YT. Appelée DEPUIS le click handler, pas après await.
   */
  onYoutubeWarmup?: () => void;
  /**
   * v6 — état SDK YT pour détecter unlock raté (UNSTARTED/PAUSED après
   * 1500ms = bloqué par autoplay policy navigateur).
   */
  getYoutubeState?: () => number | null;
}

export function PreGameStartScreen({
  playlistName,
  trackCount,
  badge,
  providerLabel,
  busy = false,
  onStart,
  onCancel,
  onYoutubeWarmup,
  getYoutubeState,
}: Props): JSX.Element {
  const { t } = useTranslation();
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);
  const [unlockFailed, setUnlockFailed] = useState(false);
  const detectionTimerRef = useRef<number | null>(null);

  // Cleanup detection timer si composant unmount.
  useEffect(() => {
    return () => {
      if (detectionTimerRef.current !== null) {
        window.clearTimeout(detectionTimerRef.current);
      }
    };
  }, []);

  // Bug autoplay v6 — handler SYNCHRONE pour cross-browser unlock.
  const handleStartClick = (): void => {
    const ts = Date.now();
    console.info(`[PreGame] Click handler executed at ${ts}`);
    console.info(
      `[PreGame] window.YT exists: ${typeof window !== 'undefined' && Boolean((window as unknown as { YT?: unknown }).YT)}`,
    );

    // ── Étape 1 SYNC : silent audio unlock ────────────────────────────
    let audioUnlocked = false;
    try {
      if (!silentAudioRef.current) {
        const a = new Audio(SILENT_WAV_DATA_URL);
        a.preload = 'auto';
        silentAudioRef.current = a;
      }
      const audio = silentAudioRef.current;
      audio.volume = 0;
      // play() retourne Promise mais l'effet est SYNC côté browser pour
      // claim le user gesture du contexte audio.
      const playPromise = audio.play();
      audioUnlocked = true;
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
    console.info(`[PreGame] playVideo() called sync: ${audioUnlocked}`);

    // ── Étape 2 SYNC : YouTube IFrame warmup ──────────────────────────
    if (onYoutubeWarmup) {
      try {
        onYoutubeWarmup();
        console.info('[PreGame] YouTube warmupSync invoked');
      } catch (err) {
        console.warn('[PreGame] YouTube warmupSync threw (non-blocking):', err);
      }
    }

    // ── Étape 3 ASYNC : déclenche la chaîne create/start/play ────────
    onStart();

    // ── Étape 4 : détection unlock raté après 1500ms ──────────────────
    if (detectionTimerRef.current !== null) {
      window.clearTimeout(detectionTimerRef.current);
    }
    detectionTimerRef.current = window.setTimeout(() => {
      if (!getYoutubeState) {
        console.info('[PreGame] Unlock detection skipped (no getYoutubeState)');
        return;
      }
      const state = getYoutubeState();
      console.info(`[PreGame] Unlock detection : YT state after 1.5s = ${state}`);
      // Unlock raté = player toujours UNSTARTED ou PAUSED après le délai.
      // BUFFERING ou CUED ou PLAYING = unlock OK.
      if (state === YT_STATE_UNSTARTED || state === YT_STATE_PAUSED) {
        console.warn('[PreGame] Unlock FAILED — showing fallback overlay');
        setUnlockFailed(true);
      }
    }, UNLOCK_DETECTION_DELAY_MS);
  };

  // Fallback : 2ème user gesture pour browsers qui ont rejeté le 1er.
  const handleFallbackClick = (): void => {
    console.info('[PreGame] Fallback click — retrying YouTube warmup');
    if (onYoutubeWarmup) {
      try {
        onYoutubeWarmup();
      } catch (err) {
        console.warn('[PreGame] Fallback warmup threw:', err);
      }
    }
    setUnlockFailed(false);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#7a8a9a] relative">
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

      {/* Fallback overlay si autoplay bloqué par browser/content blocker. */}
      {unlockFailed && (
        <div className="fixed inset-0 z-50 bg-ink/80 flex items-center justify-center px-6">
          <div className="max-w-md text-center bg-cream border-4 border-ink rounded-3xl p-8 shadow-pop-lg">
            <p className="text-4xl mb-3" aria-hidden>
              ⚠️
            </p>
            <p className="font-display text-xl mb-2">{t('preGame.autoplayBlockedTitle')}</p>
            <p className="font-editorial italic text-ink-2 mb-6">
              {t('preGame.autoplayBlockedHint')}
            </p>
            <Button
              type="button"
              size="lg"
              variant="primary"
              onClick={handleFallbackClick}
              className="!min-w-[260px] !py-4 !text-xl !font-bold"
            >
              ▶ {t('preGame.autoplayRetryButton')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
