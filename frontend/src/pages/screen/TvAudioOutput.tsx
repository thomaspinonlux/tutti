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
import { postTvAudioArmed, postTvSpotifyReady } from '../../lib/screenState.js';
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
}

export function TvAudioOutput({
  workspaceId,
  audioTarget,
  tvAudioArmed,
  tvSpotifyReady,
  isPaused,
  currentTrack,
}: Props): JSX.Element | null {
  const { t } = useTranslation();
  const provider = currentTrack?.provider ?? null;
  const audioSink = resolveAudioSink({
    audio_target: audioTarget,
    tv_audio_armed: tvAudioArmed,
    tv_spotify_ready: tvSpotifyReady,
    provider,
  });
  const armOnTv = audioTarget === 'tv';

  // ── Players TV ────────────────────────────────────────────────────────
  // YouTube : monté tant que la TV est en mode "son sur TV" ET armée.
  const youtube = useYouTubePlayer({ enabled: armOnTv && tvAudioArmed });

  // Spotify : monté seulement si l'animateur a activé le routage TV ET
  // l'user a armé l'audio (= cliqué le bouton). Token = endpoint public
  // /api/auth/spotify/token-public/:workspaceId (creds Premium workspace).
  const spotifyTokenFetcher = useMemo(
    () => () => getSpotifyTokenPublic(workspaceId),
    [workspaceId],
  );
  const spotify = useSpotifyPlayer({
    enabled: armOnTv && tvAudioArmed,
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
    if (!armOnTv || !tvAudioArmed) return;
    const tick = (): void => {
      void postTvAudioArmed(workspaceId, true).catch(() => undefined);
    };
    const id = window.setInterval(tick, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [armOnTv, tvAudioArmed, workspaceId]);

  // ── tv_spotify_ready : sync flag avec status SDK ──────────────────────
  const spotifyReadyRef = useRef(false);
  useEffect(() => {
    const isReady = armOnTv && spotify.status === 'ready';
    if (isReady !== spotifyReadyRef.current) {
      spotifyReadyRef.current = isReady;
      void postTvSpotifyReady(workspaceId, isReady).catch(() => undefined);
    }
  }, [armOnTv, spotify.status, workspaceId]);

  // Heartbeat tv_spotify_ready tant que le SDK est ready.
  useEffect(() => {
    if (!armOnTv || spotify.status !== 'ready') return;
    const id = window.setInterval(() => {
      void postTvSpotifyReady(workspaceId, true).catch(() => undefined);
    }, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [armOnTv, spotify.status, workspaceId]);

  // Cleanup unmount : reset les 2 flags pour que le sink retombe sur host.
  useEffect(() => {
    return () => {
      void postTvAudioArmed(workspaceId, false).catch(() => undefined);
      void postTvSpotifyReady(workspaceId, false).catch(() => undefined);
    };
  }, [workspaceId]);

  // ── Bouton "Activer le son sur cet écran" ─────────────────────────────
  const [arming, setArming] = useState(false);
  const handleArm = (): void => {
    // SYNC unlock dans le tick du clic (PreGameStartScreen pattern).
    unlockAudioSync('tv-screen-arm-button');
    youtube.warmupSync?.();
    setArming(true);
    void postTvAudioArmed(workspaceId, true)
      .catch((err: unknown) => {
        console.warn('[TvAudioOutput] arm POST failed:', err);
      })
      .finally(() => setArming(false));
  };

  // ── Bouton "Connecter Spotify ici" — Spotify déjà monté à `tvAudioArmed` ;
  // le SDK se connecte automatiquement avec le token public workspace. Le
  // bouton est un FALLBACK pour ré-tenter si l'init a foiré (token périmé,
  // SDK script bloqué, etc.). En pratique : si `spotify.status === 'error'`,
  // on propose un retry.
  const handleSpotifyRetry = (): void => {
    unlockAudioSync('tv-screen-spotify-retry');
    void spotify.unblockAudio?.().catch(() => undefined);
  };

  if (!armOnTv) return null;

  const needArm = !tvAudioArmed;
  const needSpotify =
    !needArm && currentTrack?.provider === 'spotify' && spotify.status !== 'ready';

  return (
    <div className="fixed inset-x-0 bottom-24 z-40 flex justify-center pointer-events-none">
      <div className="flex flex-col items-center gap-3 pointer-events-auto">
        {needArm && (
          <button
            type="button"
            onClick={handleArm}
            disabled={arming}
            className="px-6 py-4 text-lg font-display font-bold bg-spritz text-cream border-2 border-ink shadow-pop-lg rounded-xl flex items-center gap-3 transition-transform hover:-translate-y-0.5 disabled:opacity-50"
          >
            <span aria-hidden className="text-2xl">
              🔊
            </span>
            {t('screen.tvAudio.activate')}
          </button>
        )}
        {needSpotify && (
          <button
            type="button"
            onClick={handleSpotifyRetry}
            className="px-5 py-3 text-base font-display font-bold bg-basil text-cream border-2 border-ink shadow-pop rounded-xl flex items-center gap-3 transition-transform hover:-translate-y-0.5"
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
