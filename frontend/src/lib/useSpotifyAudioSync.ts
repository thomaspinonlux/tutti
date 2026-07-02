/**
 * useSpotifyAudioSync — synchronise l'audio Spotify avec l'état serveur.
 *
 * Source unique de vérité = état serveur (currentTrack + isPaused). Le hook
 * réagit aux changements et pilote le SDK Spotify en conséquence.
 *
 * Décisions :
 *   - currentTrack.started_at change → seek 0 + play (couvre track suivant
 *     ET restart même URI : le serveur émet track:start avec nouveau
 *     started_at dans les 2 cas)
 *   - currentTrack.provider_track_id change → play(new URI)
 *   - currentTrack === null → pause (round terminé / mid-track skip)
 *   - currentTrack.phase === 'phase3-skipped' → pause (skip avant reveal)
 *   - isPaused: true → pause SDK
 *   - isPaused: false (et currentTrack présent) → resume SDK
 *
 * Pas de useEffect parallèles. Une seule logique séquentielle pilotée par
 * les changements de l'état serveur. Backend = autorité.
 */

import { useEffect, useRef } from 'react';
import type { CurrentTrackState } from '@tutti/shared';
import type { UseSpotifyPlayerResult } from './useSpotifyPlayer.js';

interface Options {
  spotify: UseSpotifyPlayerResult;
  currentTrack: CurrentTrackState | null;
  isPaused: boolean;
  /** Hook désactivé si false (ex: round pas en PLAYING). */
  enabled?: boolean;
}

export function useSpotifyAudioSync({
  spotify,
  currentTrack,
  isPaused,
  enabled = true,
}: Options): void {
  // Track les valeurs précédentes pour décider entre play / seek / resume / pause
  const prevTrackIdRef = useRef<string | null>(null);
  const prevStartedAtRef = useRef<string | null>(null);
  const prevIsPausedRef = useRef<boolean>(false);

  useEffect(() => {
    if (!enabled) {
      // feat/audio-auto-routing — CUT SUR L'AUTRE : le device inactif doit
      // COUPER réellement le son, pas juste cesser de piloter. Sans ce pause,
      // le player continue de jouer là où il en était (bug "pause sur TV mais
      // continue sur iPad"). On pause AVANT de reset les refs.
      void spotify.pause();
      prevTrackIdRef.current = null;
      prevStartedAtRef.current = null;
      prevIsPausedRef.current = false;
      return;
    }
    if (spotify.status !== 'ready') {
      // SDK pas encore prêt : on attend. Le pendingPlayRef interne gérera
      // le déclenchement initial quand le device sera ready.
      return;
    }

    const trackId = currentTrack?.track_id ?? null;
    const startedAt = currentTrack?.started_at ?? null;
    const phase = currentTrack?.phase ?? null;

    // Cas 1 : pas de track actif → pause
    if (!currentTrack) {
      console.info('[AudioSync] currentTrack=null → pause');
      void spotify.pause();
      prevTrackIdRef.current = null;
      prevStartedAtRef.current = null;
      return;
    }

    // Cas 2 : phase3-skipped → pause (le morceau est annulé, pas de reveal)
    if (phase === 'phase3-skipped') {
      console.info('[AudioSync] phase3-skipped → pause');
      void spotify.pause();
      prevTrackIdRef.current = trackId;
      prevStartedAtRef.current = startedAt;
      return;
    }

    // Cas 3 : provider non-Spotify → on pause Spotify s'il jouait avant.
    // Sans ce pause, le morceau Spotify continue en parallèle d'un nouveau
    // morceau YouTube (overlap audio cross-provider). Bug fix Mix S/YT.
    if (currentTrack.provider !== 'spotify') {
      if (prevTrackIdRef.current !== null) {
        console.info('[Audio Switch] Stopping Spotify (current is', currentTrack.provider, ')');
        void spotify.pause();
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
      const reason = trackIdChanged ? 'new_track' : 'restart_same_track';
      console.info(
        '[Audio Switch] Starting Spotify',
        reason,
        '→ uri:',
        currentTrack.provider_track_id,
        '| started_at:',
        startedAt,
      );
      void spotify.play(`spotify:track:${currentTrack.provider_track_id}`);
      prevTrackIdRef.current = trackId;
      prevStartedAtRef.current = startedAt;
      prevIsPausedRef.current = isPaused;
      return;
    }

    // Cas 5 : changement de pause uniquement (track inchangé)
    if (isPaused !== prevIsPausedRef.current) {
      if (isPaused) {
        console.info('[AudioSync] isPaused→true → pause SDK');
        void spotify.pause();
      } else {
        console.info('[AudioSync] isPaused→false → resume SDK');
        void spotify.resume();
      }
      prevIsPausedRef.current = isPaused;
    }
  }, [
    enabled,
    spotify,
    // feat/audio-auto-routing — BUG 1ère track : le SDK passe à 'ready' APRÈS
    // track:start ; sans spotify.status dans les deps, l'effet ne rejoue pas
    // et le 1er morceau ne démarre jamais. On l'ajoute pour re-déclencher dès
    // que le SDK devient ready.
    spotify.status,
    currentTrack,
    currentTrack?.track_id,
    currentTrack?.started_at,
    currentTrack?.phase,
    currentTrack?.provider,
    currentTrack?.provider_track_id,
    isPaused,
  ]);
}
