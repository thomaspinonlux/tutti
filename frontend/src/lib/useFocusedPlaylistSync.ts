/**
 * useFocusedPlaylistSync — feat/tv-playlist-selection-sync
 *
 * Hook qui observe via IntersectionObserver tous les éléments DOM ayant
 * l'attribut `data-focus-playlist-id="<uuid>"` et POST le plus visible
 * (le plus proche du centre de viewport) à
 * `POST /api/workspace/screen-state/focused-playlist`.
 *
 * Throttle : POST uniquement au CHANGEMENT de playlist focused (pas à
 * chaque scroll pixel). Debounce 300ms pour éviter le spam pendant le
 * snap-scroll des carrousels CategoryRow.
 *
 * Cleanup : au unmount, POST `null` pour signaler "host a quitté la
 * sélection". Le store backend a un TTL 30s en safety net.
 *
 * Usage :
 *   useFocusedPlaylistSync({ enabled: tab === 'library' });
 *
 * Note : ne gère qu'UNE seule playlist focused à la fois (pas de multi-
 * cible). Si l'animateur scrolle 2 catégories en parallèle, on garde la
 * dernière focused.
 */

import { useEffect, useRef } from 'react';
import { postFocusedPlaylist } from './screenState.js';

const DEBOUNCE_MS = 300;
/** Seuil de visibilité minimum pour qu'une card soit considérée "focused". */
const VISIBILITY_THRESHOLD = 0.5;

interface Options {
  /** Désactive l'observer si false (ex: pas sur l'onglet bibliothèque). */
  enabled: boolean;
}

export function useFocusedPlaylistSync({ enabled }: Options): void {
  const lastSentRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const inFlightRef = useRef<boolean>(false);

  useEffect(() => {
    if (!enabled) return;

    /** Map d'intersection des éléments observés. */
    const ratios = new Map<string, number>();

    const sendIfChanged = (targetId: string | null): void => {
      if (lastSentRef.current === targetId) return;
      lastSentRef.current = targetId;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      postFocusedPlaylist(targetId)
        .catch((err) => {
          // Pas critique : si la requête fail, le polling backend
          // utilisera la dernière valeur (TTL 30s).
          console.warn('[FocusedPlaylistSync] post failed:', err);
        })
        .finally(() => {
          inFlightRef.current = false;
        });
    };

    const scheduleSync = (): void => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = window.setTimeout(() => {
        debounceTimerRef.current = null;
        // Pick l'élément avec le ratio le plus élevé (≥ seuil).
        let bestId: string | null = null;
        let bestRatio = VISIBILITY_THRESHOLD;
        for (const [id, ratio] of ratios) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        }
        sendIfChanged(bestId);
      }, DEBOUNCE_MS);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).getAttribute('data-focus-playlist-id');
          if (!id) continue;
          if (entry.isIntersecting) {
            ratios.set(id, entry.intersectionRatio);
          } else {
            ratios.delete(id);
          }
        }
        scheduleSync();
      },
      {
        // Centre horizontal du viewport — réduit la zone effective via
        // rootMargin pour matcher le "milieu" de l'écran host.
        threshold: [0.25, 0.5, 0.75, 1.0],
      },
    );

    // Observer tous les éléments existants + les futurs ajouts via
    // MutationObserver (les CategoryRow lazy-mountent au tab switch).
    const observeAll = (): void => {
      const els = document.querySelectorAll<HTMLElement>('[data-focus-playlist-id]');
      els.forEach((el) => observer.observe(el));
    };
    observeAll();

    const mutationObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches?.('[data-focus-playlist-id]')) {
            observer.observe(node);
          }
          node
            .querySelectorAll?.('[data-focus-playlist-id]')
            .forEach((el) => observer.observe(el as HTMLElement));
        });
      }
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      // Signale au backend "host a quitté la sélection".
      void postFocusedPlaylist(null).catch(() => undefined);
      lastSentRef.current = null;
    };
  }, [enabled]);
}
