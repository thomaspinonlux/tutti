/**
 * useYouTubeAudioSync — Phase 3d
 *
 * Pendant de useSpotifyAudioSync pour les tracks provider 'youtube'.
 * Backend autoritaire : currentTrack.started_at / track_id changent → loadVideo.
 * isPaused → pause/resume.
 *
 * Pour les autres providers : no-op (le hook se désactive lui-même).
 */

import { useEffect, useRef } from 'react';
import type { CurrentTrackState } from '@tutti/shared';
import type { UseYouTubePlayerResult } from './useYouTubePlayer.js';

interface Options {
  youtube: UseYouTubePlayerResult;
  currentTrack: CurrentTrackState | null;
  isPaused: boolean;
  enabled?: boolean;
}

export function useYouTubeAudioSync({
  youtube,
  currentTrack,
  isPaused,
  enabled = true,
}: Options): void {
  const prevTrackIdRef = useRef<string | null>(null);
  const prevStartedAtRef = useRef<string | null>(null);
  const prevIsPausedRef = useRef<boolean>(false);

  useEffect(() => {
    if (!enabled) {
      prevTrackIdRef.current = null;
      prevStartedAtRef.current = null;
      prevIsPausedRef.current = false;
      return;
    }
    if (youtube.status !== 'ready') return;

    const trackId = currentTrack?.track_id ?? null;
    const startedAt = currentTrack?.started_at ?? null;
    const phase = currentTrack?.phase ?? null;

    // Cas 1 : pas de track actif → pause
    if (!currentTrack) {
      youtube.pause();
      prevTrackIdRef.current = null;
      prevStartedAtRef.current = null;
      return;
    }

    // Cas 2 : phase3-skipped → pause
    if (phase === 'phase3-skipped') {
      youtube.pause();
      prevTrackIdRef.current = trackId;
      prevStartedAtRef.current = startedAt;
      return;
    }

    // Cas 3 : provider non-YouTube → on pause YouTube s'il jouait avant.
    // Sans ce pause, le morceau YouTube continue en parallèle d'un nouveau
    // morceau Spotify (overlap audio cross-provider). Bug fix Mix S/YT.
    if (currentTrack.provider !== 'youtube') {
      if (prevTrackIdRef.current !== null) {
        console.info('[Audio Switch] Stopping YouTube (current is', currentTrack.provider, ')');
        youtube.pause();
        prevTrackIdRef.current = null;
        prevStartedAtRef.current = null;
        prevIsPausedRef.current = false;
      }
      return;
    }

    const trackIdChanged = trackId !== prevTrackIdRef.current;
    const startedAtChanged = startedAt !== prevStartedAtRef.current;

    // Cas 4 : nouveau track ou restart → loadVideoById (avec start/end anti-pub)
    if (trackIdChanged || startedAtChanged) {
      console.info(
        '[Audio Switch] Starting YouTube',
        trackIdChanged ? 'new_track' : 'restart',
        '→ videoId:',
        currentTrack.provider_track_id,
      );
      void youtube.play(currentTrack.provider_track_id);
      prevTrackIdRef.current = trackId;
      prevStartedAtRef.current = startedAt;
      prevIsPausedRef.current = isPaused;
      return;
    }

    // Cas 5 : changement de pause uniquement
    if (isPaused !== prevIsPausedRef.current) {
      if (isPaused) {
        youtube.pause();
      } else {
        youtube.resume();
      }
      prevIsPausedRef.current = isPaused;
    }
  }, [
    enabled,
    youtube,
    currentTrack,
    currentTrack?.track_id,
    currentTrack?.started_at,
    currentTrack?.phase,
    currentTrack?.provider,
    currentTrack?.provider_track_id,
    isPaused,
  ]);
}
