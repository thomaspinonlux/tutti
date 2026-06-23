/**
 * <TvAudioOutput /> — feat/tv-audio-output
 *
 * Composant TV-side qui :
 *
 *   1. Monte `useYouTubePlayer` + `useSpotifyPlayer` côté TV quand
 *      `audio_target === 'tv'` (l'animateur a activé le routage TV).
 *      → Spotify SDK utilise le TOKEN PUBLIC du workspace (même compte
 *      Premium que le host, scope streaming).
 *
 *   2. Branche `useYouTubeAudioSync` / `useSpotifyAudioSync` sur le
 *      `currentTrack` polled par ScreenPage. enabled=`audioSink === 'tv'`.
 *      → MÊME logique data-driven que le host (started_at / isPaused /
 *      provider → play/pause/seek). Pas de chemin de contrôle parallèle.
 *
 *   3. POST `tv_audio_armed=true` au clic du bouton "🔊 Activer le son sur
 *      cet écran" (gesture user nécessaire pour débloquer l'autoplay
 *      navigateur). Heartbeat 30s pour rafraîchir le TTL backend (60s).
 *      Au unmount : POST `false` → la résolution du sink retombe sur host.
 *
 *   4. POST `tv_spotify_ready=true` quand le Spotify SDK est ready ;
 *      `false` au unmount ou error. Tant que ce flag vaut false, les tracks
 *      Spotify restent sur le host (le sink est calculé par lib/audioSink).
 *
 *   5. Affiche :
 *      - bouton "🔊 Activer le son sur cet écran" si !tv_audio_armed
 *      - bouton "🟢 Connecter Spotify ici" si track Spotify et !tv_spotify_ready
 *
 * Crashs SDK Spotify déjà couverts par le RootErrorBoundary racine (#115).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CurrentTrackState } from '@tutti/shared';
import { useYouTubePlayer } from '../../lib/useYouTubePlayer.js';
import { useYouTubeAudioSync } from '../../lib/useYouTubeAudioSync.js';
import { useSpotifyPlayer } from '../../lib/useSpotifyPlayer.js';
import { useSpotifyAudioSync } from '../../lib/useSpotifyAudioSync.js';
import { resolveAudioSink } from '../../lib/audioSink.js';
import {
  postTvAudioArmed,
  postTvSpotifyReady,
  postAudioTargetPublic,
} from '../../lib/screenState.js';
import { getSpotifyTokenPublic } from '../../lib/music.js';
import { unlockAudioSync } from '../../lib/audioUnlock.js';

const HEARTBEAT_MS = 30_000;

interface Props {
  workspaceId: string;
  audioTarget: 'host' | 'tv';
  tvAudioArmed: boolean;
  tvSpotifyReady: boolean;
  isPaused: boolean;
  currentTrack: CurrentTrackState | null;
  /**
   * feat/host-tv-perfect-sync (F3) — dernier seek réel (reason='seek') reçu via
   * socket par ScreenPage. Quand la TV est le sink (active), on applique le seek
   * sur SON lecteur. `nonce` force le re-déclenchement même à position identique.
   */
  seekSignal?: { positionMs: number; nonce: number } | null;
}

export function TvAudioOutput({
  workspaceId,
  audioTarget,
  tvAudioArmed,
  tvSpotifyReady,
  isPaused,
  currentTrack,
  seekSignal,
}: Props): JSX.Element | null {
  const { t } = useTranslation();
  const provider = currentTrack?.provider ?? null;

  // ── feat/tv-audio-self-serve — état local optimiste ───────────────────
  // La TV prend / rend le son d'UN clic. `localDesired` force l'état attendu
  // SANS attendre le prochain poll (≤2s) : 'tv' = je prends le son ici,
  // 'host' = je le rends, null = je suis le screen-state polled. Réconcilié
  // dès que les props (audio_target / tv_audio_armed) confirment.
  const [localDesired, setLocalDesired] = useState<'tv' | 'host' | null>(null);
  useEffect(() => {
    if (localDesired === 'tv' && audioTarget === 'tv' && tvAudioArmed) setLocalDesired(null);
    if (localDesired === 'host' && audioTarget !== 'tv') setLocalDesired(null);
  }, [localDesired, audioTarget, tvAudioArmed]);

  const effectiveOnTv = localDesired ? localDesired === 'tv' : audioTarget === 'tv';
  const effectiveArmed =
    localDesired === 'tv' ? true : localDesired === 'host' ? false : tvAudioArmed;

  const audioSink = resolveAudioSink({
    audio_target: effectiveOnTv ? 'tv' : 'host',
    tv_audio_armed: effectiveArmed,
    tv_spotify_ready: tvSpotifyReady,
    provider,
  });
  const active = effectiveOnTv && effectiveArmed; // son routé sur CET écran

  // ── Players TV ────────────────────────────────────────────────────────
  // Montés (enabled) tant que le son est routé ici ET armé. Le composant
  // reste TOUJOURS monté (jamais de `return null`) → aucun remount du
  // sous-arbre audio au re-render (cf #121).
  const youtube = useYouTubePlayer({ enabled: active });

  // Spotify : token = endpoint public /api/auth/spotify/token-public/:workspaceId
  // (creds Premium workspace).
  const spotifyTokenFetcher = useMemo(
    () => () => getSpotifyTokenPublic(workspaceId),
    [workspaceId],
  );
  const spotify = useSpotifyPlayer({
    enabled: active,
    tokenFetcher: spotifyTokenFetcher,
    deviceName: 'Tutti TV',
  });

  // ── Audio sync — pilote PLAY/PAUSE/SEEK depuis le state serveur ────────
  useYouTubeAudioSync({
    youtube,
    currentTrack,
    isPaused,
    enabled: audioSink === 'tv',
  });
  useSpotifyAudioSync({
    spotify,
    currentTrack,
    isPaused,
    enabled: audioSink === 'tv',
  });

  // ── Heartbeat tv_audio_armed (TTL backend 60s, ré-POST 30s) ───────────
  useEffect(() => {
    if (!active) return;
    const tick = (): void => {
      void postTvAudioArmed(workspaceId, true).catch(() => undefined);
    };
    const id = window.setInterval(tick, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [active, workspaceId]);

  // ── tv_spotify_ready : sync flag avec status SDK ──────────────────────
  const spotifyReadyRef = useRef(false);
  useEffect(() => {
    const isReady = active && spotify.status === 'ready';
    if (isReady !== spotifyReadyRef.current) {
      spotifyReadyRef.current = isReady;
      void postTvSpotifyReady(workspaceId, isReady).catch(() => undefined);
    }
  }, [active, spotify.status, workspaceId]);

  // Heartbeat tv_spotify_ready tant que le SDK est ready.
  useEffect(() => {
    if (!active || spotify.status !== 'ready') return;
    const id = window.setInterval(() => {
      void postTvSpotifyReady(workspaceId, true).catch(() => undefined);
    }, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [active, spotify.status, workspaceId]);

  // F3 — la TV est le SINK : applique le seek serveur (reason='seek') sur son
  // lecteur. nonce dans les deps → re-seek à position identique re-déclenche.
  useEffect(() => {
    if (!seekSignal || !active) return;
    const ms = seekSignal.positionMs;
    if (currentTrack?.provider === 'youtube') youtube.seek(ms);
    else void spotify.seek(ms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekSignal?.nonce, active]);

  // Cleanup unmount : reset les 2 flags pour que le sink retombe sur host.
  useEffect(() => {
    return () => {
      void postTvAudioArmed(workspaceId, false).catch(() => undefined);
      void postTvSpotifyReady(workspaceId, false).catch(() => undefined);
    };
  }, [workspaceId]);

  // ── Action : PRENDRE le son sur cet écran (1 clic) ────────────────────
  // (a) audio_target='tv' via la route PUBLIQUE scoped workspace (sans toucher
  // la tablette) (b) arme l'autoplay (tv_audio_armed=true) (c) la lecture du
  // currentTrack démarre via les sync hooks (audioSink devient 'tv').
  const [busy, setBusy] = useState(false);
  const handleTakeSound = (): void => {
    // SYNC unlock + warmup DANS le tick du clic (gesture autoplay navigateur).
    unlockAudioSync('tv-screen-take-sound');
    youtube.warmupSync?.();
    setLocalDesired('tv'); // optimiste → players enabled + sink 'tv' immédiat
    setBusy(true);
    void Promise.allSettled([
      postAudioTargetPublic(workspaceId, 'tv'),
      postTvAudioArmed(workspaceId, true),
    ]).finally(() => setBusy(false));
  };

  // ── Action : RENDRE le son au host (toggle off) ───────────────────────
  const handleReleaseSound = (): void => {
    setLocalDesired('host'); // optimiste → players disabled, host reprend
    setBusy(true);
    void Promise.allSettled([
      postAudioTargetPublic(workspaceId, 'host'),
      postTvAudioArmed(workspaceId, false),
    ]).finally(() => setBusy(false));
  };

  // ── Bouton "Connecter Spotify ici" — fallback retry si le SDK n'est pas
  // ready (token périmé, script bloqué…). Spotify est déjà monté à `active`.
  const handleSpotifyRetry = (): void => {
    unlockAudioSync('tv-screen-spotify-retry');
    void spotify.unblockAudio?.().catch(() => undefined);
  };

  const needSpotify = active && currentTrack?.provider === 'spotify' && spotify.status !== 'ready';

  // Toujours rendu (jamais `return null`) : l'opérateur de la salle prend le
  // son d'UN clic sur la TV, sans condition côté host.
  return (
    <div className="fixed inset-x-0 bottom-24 z-40 flex justify-center pointer-events-none">
      <div className="flex flex-col items-center gap-3 pointer-events-auto">
        {!active ? (
          <button
            type="button"
            onClick={handleTakeSound}
            disabled={busy}
            className="px-6 py-4 text-lg font-display font-bold bg-spritz text-cream border-2 border-ink shadow-pop-lg rounded-xl flex items-center gap-3 transition-transform hover:-translate-y-0.5 disabled:opacity-50"
          >
            <span aria-hidden className="text-2xl">
              🔊
            </span>
            {t('screen.tvAudio.takeSound')}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleReleaseSound}
            disabled={busy}
            aria-pressed
            className="px-6 py-4 text-lg font-display font-bold bg-basil text-cream border-2 border-ink shadow-pop-lg rounded-xl flex items-center gap-3 transition-transform hover:-translate-y-0.5 disabled:opacity-50"
          >
            <span aria-hidden className="text-2xl">
              🔊
            </span>
            {t('screen.tvAudio.soundActive')}
          </button>
        )}
        {needSpotify && (
          <button
            type="button"
            onClick={handleSpotifyRetry}
            className="px-5 py-3 text-base font-display font-bold bg-plum text-cream border-2 border-ink shadow-pop rounded-xl flex items-center gap-3 transition-transform hover:-translate-y-0.5"
          >
            <span aria-hidden className="text-xl">
              🟢
            </span>
            {t('screen.tvAudio.connectSpotify')}
          </button>
        )}
        {spotify.error && (
          <p className="text-xs font-mono text-raspberry bg-cream px-3 py-1 rounded">
            Spotify : {spotify.error}
          </p>
        )}
      </div>
    </div>
  );
}
