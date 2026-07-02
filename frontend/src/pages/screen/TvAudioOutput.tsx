/**
 * <TvAudioOutput /> — feat/audio-auto-routing
 *
 * Composant TV-side. ROUTING AUTOMATIQUE : plus de capsule de choix. Un vrai
 * écran TV externe (autre appareil que la console) s'ARME au premier tap
 * (déblocage autoplay navigateur, inévitable) puis joue le son automatiquement
 * tant qu'il est armé. La console se mute alors toute seule (cf. lib/audioSink,
 * sink === 'tv' dès que tv_audio_armed).
 *
 *   1. Garde SAME-DEVICE : si cette fenêtre /screen tourne sur la MÊME machine
 *      que la console host (2e fenêtre), elle NE s'arme JAMAIS (sinon double
 *      son console + fenêtre). Détectée via localStorage['tutti-console-ws']
 *      écrit par HostPage. Dans ce cas → juste un texte "Son géré sur la
 *      console", `active` reste false, aucun player monté.
 *
 *   2. Vrai écran externe → overlay plein écran "Touchez l'écran pour démarrer
 *      le son" tant que `!tvAudioArmed`. Au tap : unlock autoplay + warmup +
 *      POST tv-audio-armed=true (+ state optimiste). Une fois armé, l'overlay
 *      disparaît, les players jouent via les sync hooks data-driven, heartbeat
 *      30s garde le flag frais (TTL backend 60s). Au unmount : POST false.
 *
 *   3. POST `tv_spotify_ready=true` quand le Spotify SDK est ready ; `false`
 *      au unmount ou error. Tant que ce flag vaut false, les tracks Spotify
 *      restent sur la console (le sink est calculé par lib/audioSink).
 *
 *   4. Bouton "Connecter Spotify ici" si track Spotify et !tv_spotify_ready.
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

// feat/tv-audio-persist — mémoire de SESSION : survit aux remontages du composant
// (TvAudioOutput n'est monté qu'en PLAYING/PAUSED → il se démonte entre 2 playlists),
// mais PAS au reload de la page. Passe à true dès que l'utilisateur a débloqué
// l'autoplay par 1 tap → on ré-arme ensuite AUTOMATIQUEMENT à chaque nouvelle
// playlist, sans re-toucher l'écran. (Le domaine a déjà l'activation utilisateur
// → les players se relancent sans nouveau geste tant que la page n'est pas rechargée.)
let hasUnlockedThisPageSession = false;

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
  tvAudioArmed,
  tvSpotifyReady,
  isPaused,
  currentTrack,
}: Props): JSX.Element | null {
  const { t } = useTranslation();
  const provider = currentTrack?.provider ?? null;

  // ── feat/audio-auto-routing — garde SAME-DEVICE ───────────────────────
  // Au mount, on lit le marqueur écrit par HostPage. Si le workspaceId de la
  // console == le nôtre → cette fenêtre /screen tourne sur la MÊME machine que
  // le host (2e fenêtre / onglet) → elle ne doit JAMAIS armer, sinon la console
  // ET cette fenêtre sortent le son en double. Un vrai écran TV externe est une
  // autre machine → pas de marqueur (ou workspace différent) → arme normalement.
  const isSameDeviceAsConsole = useMemo(() => {
    try {
      return window.localStorage.getItem('tutti-console-ws') === workspaceId;
    } catch {
      return false; // localStorage indispo → on suppose écran externe (safe)
    }
  }, [workspaceId]);

  // ── feat/audio-auto-routing — arm optimiste ───────────────────────────
  // Au premier tap sur l'overlay, on marque localArmed=true SANS attendre le
  // prochain poll (≤2-3s) pour que les players montent et jouent tout de suite.
  // Réconcilié : dès que la prop tvAudioArmed confirme, on relâche l'optimisme.
  // Ré-arm auto : si l'user a déjà débloqué le son cette session (page non
  // rechargée), on démarre DÉJÀ armé au remontage → pas d'overlay, pas de re-tap.
  const [localArmed, setLocalArmed] = useState(
    () => hasUnlockedThisPageSession && !isSameDeviceAsConsole,
  );
  useEffect(() => {
    if (localArmed && tvAudioArmed) setLocalArmed(false);
  }, [localArmed, tvAudioArmed]);

  // Armé = flag backend OU optimiste local. Same-device → jamais armé.
  const armed = !isSameDeviceAsConsole && (tvAudioArmed || localArmed);
  const active = armed; // son routé sur CET écran (= armé, hors same-device)

  const audioSink = resolveAudioSink({
    tv_audio_armed: armed,
    tv_spotify_ready: tvSpotifyReady,
    provider,
  });

  // ── Players TV ────────────────────────────────────────────────────────
  // Montés (enabled) tant que le son est armé ici. Le composant reste TOUJOURS
  // monté (jamais de `return null`) → aucun remount du sous-arbre audio au
  // re-render (cf #121).
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

  // Poste armed=true DÈS que l'écran devient actif (tap OU ré-arm auto à la
  // nouvelle playlist) — sans attendre le 1er tick du heartbeat (30 s). Garantit
  // que le host voit tv_audio_armed et se mute tout de suite → pas de double son.
  useEffect(() => {
    if (active) void postTvAudioArmed(workspaceId, true).catch(() => undefined);
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

  // Cleanup unmount : reset les 2 flags pour que le sink retombe sur host.
  useEffect(() => {
    return () => {
      void postTvAudioArmed(workspaceId, false).catch(() => undefined);
      void postTvSpotifyReady(workspaceId, false).catch(() => undefined);
    };
  }, [workspaceId]);

  // ── Action : ARMER l'audio sur cet écran (1 tap, déblocage autoplay) ──
  // (a) unlock + warmup SYNC dans le tick du tap (gesture autoplay navigateur)
  // (b) POST tv-audio-armed=true (c) la lecture du currentTrack démarre via les
  // sync hooks (audioSink devient 'tv' → la console se mute automatiquement).
  const handleArm = (): void => {
    unlockAudioSync('tv-start');
    youtube.warmupSync?.();
    hasUnlockedThisPageSession = true; // → ré-arm auto aux playlists suivantes (0 re-tap)
    setLocalArmed(true); // optimiste → players enabled + sink 'tv' immédiat
    void postTvAudioArmed(workspaceId, true).catch(() => undefined);
  };

  // ── Bouton "Connecter Spotify ici" — fallback retry si le SDK n'est pas
  // ready (token périmé, script bloqué…). Spotify est déjà monté à `active`.
  const handleSpotifyRetry = (): void => {
    unlockAudioSync('tv-screen-spotify-retry');
    void spotify.unblockAudio?.().catch(() => undefined);
  };

  const needSpotify = active && currentTrack?.provider === 'spotify' && spotify.status !== 'ready';

  // ── Garde same-device : 2e fenêtre sur la console → juste un texte, rien
  // d'autre (pas d'overlay, pas de player, `active` déjà false ci-dessus).
  if (isSameDeviceAsConsole) {
    return (
      <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center pointer-events-none">
        <p className="font-mono text-xs uppercase tracking-wider text-ink-soft/60 bg-cream/80 px-3 py-1.5 rounded-full">
          {t('screen.tvAudio.managedOnConsole')}
        </p>
      </div>
    );
  }

  return (
    <>
      {/* feat/audio-auto-routing — overlay plein écran "Touchez pour démarrer".
          Affiché UNIQUEMENT tant que non armé : c'est le déblocage autoplay
          navigateur (gesture user inévitable), PAS un bouton de routing. Une
          fois armé, il disparaît et le son joue automatiquement. */}
      {!armed && (
        <button
          type="button"
          onClick={handleArm}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-ink/90 text-cream cursor-pointer"
          aria-label={t('screen.tvAudio.tapToStart')}
        >
          <span aria-hidden className="text-7xl animate-pulse">
            👆
          </span>
          <span className="font-display text-3xl sm:text-4xl font-bold text-center px-8">
            {t('screen.tvAudio.tapToStart')}
          </span>
        </button>
      )}

      {/* Bouton "Connecter Spotify ici" — fallback quand le SDK Spotify n'est
          pas ready sur un track Spotify. Reste au-dessus du contenu, discret. */}
      {(needSpotify || spotify.error) && (
        <div className="fixed inset-x-0 bottom-24 z-40 flex justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-3 pointer-events-auto">
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
      )}
    </>
  );
}
