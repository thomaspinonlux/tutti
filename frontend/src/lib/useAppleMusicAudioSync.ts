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
}

export function useAppleMusicAudioSync({
  apple,
  currentTrack,
  isPaused,
  enabled = true,
}: Options): void {
  const prevTrackIdRef = useRef<string | null>(null);
  const prevStartedAtRef = useRef<string | null>(null);
  const prevIsPausedRef = useRef<boolean>(false);

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

    // Cas 4 : nouveau track ou restart (started_at change) → play
    if (trackIdChanged || startedAtChanged) {
      void apple.play(currentTrack.provider_track_id);
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
  ]);
}
