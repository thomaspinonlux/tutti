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
  /**
   * fix/console-figee — LE LECTEUR EST LU PAR RÉFÉRENCE, PAS PAR DÉPENDANCE.
   *
   * Le hook lecteur renvoie un objet NEUF à chaque rendu. Tant qu'il figurait
   * dans les dépendances, cet effet se rejouait à chaque rendu — soit 4 fois
   * par seconde à cause des sondes de position — et sa première instruction
   * (`apple.pause()`) traversait le pont vers le code natif à cette cadence,
   * en permanence. C'est cette saturation qui figeait la console.
   *
   * Désormais l'objet est lu via une référence toujours à jour, et l'effet ne
   * se rejoue que sur un VRAI changement (morceau, phase, pause, disponibilité
   * du lecteur).
   */
  const appleRef = useRef(apple);
  appleRef.current = apple;
  const appleStatus = apple.status;
  /** Vrai tant que l'effet n'a pas encore coupé le son après désactivation. */
  const wasEnabledRef = useRef(false);
  // fix/ancien-morceau-qui-revient — numéro d'ordre du dernier lancement.
  const jetonLancementRef = useRef(0);

  useEffect(() => {
    const apple = appleRef.current;
    if (!enabled) {
      // CUT SUR L'AUTRE : le device inactif coupe réellement le son — mais UNE
      // SEULE FOIS, au passage à l'état désactivé, pas à chaque rendu.
      if (wasEnabledRef.current) {
        wasEnabledRef.current = false;
        void apple.pause();
      }
      prevTrackIdRef.current = null;
      prevStartedAtRef.current = null;
      prevIsPausedRef.current = false;
      return;
    }
    wasEnabledRef.current = true;
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
      // fix/ancien-morceau-qui-revient — LE LANCEMENT LE PLUS RÉCENT GAGNE.
      // Rien ne vérifiait, après l'attente, que le morceau visé était toujours
      // le morceau courant : quand l'animateur enchaînait deux titres en moins
      // d'une seconde, la demande la plus ancienne pouvait aboutir en dernier
      // et imposer le morceau précédent. La salle entendait un titre, la
      // console et la TV en affichaient un autre.
      const jeton = ++jetonLancementRef.current;
      void (async () => {
        const instant = trackIdChanged && (await apple.playPrepared(target));
        if (jeton !== jetonLancementRef.current) return;
        if (!instant) await apple.play(target);
        if (jeton !== jetonLancementRef.current) return;
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
    appleStatus,
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
