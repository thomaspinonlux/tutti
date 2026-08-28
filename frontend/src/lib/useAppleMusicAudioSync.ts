/**
 * useAppleMusicAudioSync — synchronise l'audio Apple Music avec l'état serveur.
 * feat/apple-music (étape 4). Miroir de useSpotifyAudioSync.
 *
 * Source unique de vérité = état serveur (currentTrack + isPaused). Le hook
 * réagit aux changements et pilote MusicKit :
 *   - provider ≠ 'apple_music' → pause (cut cross-provider : évite l'overlap si
 *     le morceau courant sort sur Spotify/YouTube).
 *   - currentTrack === null / phase3-skipped → pause.
 *   - track_id ou started_at change → play(catalogId).
 *   - isPaused bascule (track inchangé) → pause / resume.
 *
 * Une seule logique séquentielle, backend = autorité (aucun useEffect parallèle).
 */

import { useEffect, useRef } from 'react';
import type { CurrentTrackState } from '@tutti/shared';
import type { UseAppleMusicPlayerResult } from './useAppleMusicPlayer.js';

interface Options {
  apple: UseAppleMusicPlayerResult;
  currentTrack: CurrentTrackState | null;
  isPaused: boolean;
  /** Hook désactivé si false (ex : round pas en PLAYING, autre device actif). */
  enabled?: boolean;
  /**
   * feat/next-track-preload — apple_music_id du MORCEAU SUIVANT du tirage
   * (canal privilégié track:answer). Quand présent, il est mis en file
   * d'attente du lecteur PENDANT le morceau courant ; au changement de piste,
   * si le nouveau morceau est celui préchargé → bascule instantanée
   * (playPrepared) au lieu d'un chargement complet.
   */
  nextPreloadId?: string | null;
}

export function useAppleMusicAudioSync({
  apple,
  currentTrack,
  isPaused,
  enabled = true,
  nextPreloadId = null,
}: Options): void {
  const prevTrackIdRef = useRef<string | null>(null);
  const prevStartedAtRef = useRef<string | null>(null);
  const prevIsPausedRef = useRef<boolean>(false);
  const lastPreparedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      // CUT SUR L'AUTRE : le device inactif coupe réellement le son.
      void apple.pause();
      prevTrackIdRef.current = null;
      prevStartedAtRef.current = null;
      prevIsPausedRef.current = false;
      return;
    }
    if (apple.status !== 'ready') {
      return; // MusicKit pas prêt : on attend le passage à 'ready'.
    }

    const trackId = currentTrack?.track_id ?? null;
    const startedAt = currentTrack?.started_at ?? null;
    const phase = currentTrack?.phase ?? null;

    // Cas 1 : pas de track actif → pause
    if (!currentTrack) {
      void apple.pause();
      prevTrackIdRef.current = null;
      prevStartedAtRef.current = null;
      return;
    }

    // Cas 2 : phase3-skipped → pause (morceau annulé avant reveal)
    if (phase === 'phase3-skipped') {
      void apple.pause();
      prevTrackIdRef.current = trackId;
      prevStartedAtRef.current = startedAt;
      return;
    }

    // Cas 3 : provider non-Apple → coupe Apple s'il jouait (anti-overlap).
    if (currentTrack.provider !== 'apple_music') {
      if (prevTrackIdRef.current !== null) {
        void apple.pause();
        prevTrackIdRef.current = null;
        prevStartedAtRef.current = null;
        prevIsPausedRef.current = false;
      }
      return;
    }

    const trackIdChanged = trackId !== prevTrackIdRef.current;
    const startedAtChanged = startedAt !== prevStartedAtRef.current;

    // Cas 4 : nouveau track → bascule INSTANTANÉE si préchargé, sinon play.
    // Restart du même track (started_at change) → toujours un play complet.
    if (trackIdChanged || startedAtChanged) {
      const target = currentTrack.provider_track_id;
      void (async () => {
        const instant = trackIdChanged && (await apple.playPrepared(target));
        if (!instant) await apple.play(target);
        lastPreparedRef.current = null;
      })();
      prevTrackIdRef.current = trackId;
      prevStartedAtRef.current = startedAt;
      prevIsPausedRef.current = isPaused;
      return;
    }

    // Cas 5 : changement de pause uniquement (track inchangé)
    if (isPaused !== prevIsPausedRef.current) {
      if (isPaused) void apple.pause();
      else void apple.resume();
      prevIsPausedRef.current = isPaused;
    }

    // Cas 6 — feat/next-track-preload : le suivant est connu et pas encore en
    // file → on le précharge maintenant, pendant que le courant joue.
    if (nextPreloadId && lastPreparedRef.current !== nextPreloadId) {
      void apple.prepareNext(nextPreloadId).then((ok) => {
        if (ok) lastPreparedRef.current = nextPreloadId;
      });
    }
  }, [
    enabled,
    apple,
    apple.status,
    currentTrack,
    currentTrack?.track_id,
    currentTrack?.started_at,
    currentTrack?.phase,
    currentTrack?.provider,
    currentTrack?.provider_track_id,
    isPaused,
    nextPreloadId,
  ]);
}
