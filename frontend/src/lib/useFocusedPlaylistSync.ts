/**
 * useFocusedPlaylistSync — feat/tv-grid-mirror
 *
 * Observe la grille de sélection de l'animateur et POST en continu :
 *   - la playlist CENTRÉE (via IntersectionObserver sur les éléments DOM
 *     `data-focus-playlist-id="<uuid>"`) → highlight côté TV ;
 *   - la POSITION DE SCROLL de la grille (ratio 0..1, throttle ~100ms) →
 *     scroll-sync : la TV applique ce ratio à sa propre grille et suit
 *     l'écran animateur en direct.
 *
 * Destination : `POST /api/workspace/screen-state/focused-playlist`
 *   body `{ playlist_id, scroll_ratio }`.
 *
 * Cleanup : au unmount, POST `null` (host a quitté la sélection). Le store
 * backend a un TTL 30s en safety net.
 *
 * Usage : useFocusedPlaylistSync({ enabled: tab === 'library' });
 */

import { useEffect, useRef } from 'react';
import { postFocusedPlaylist } from './screenState.js';

/** Debounce du changement de playlist focused (snap-scroll carrousels). */
const FOCUS_DEBOUNCE_MS = 300;
/** Throttle des updates de scroll. */
const SCROLL_THROTTLE_MS = 100;
/** Seuil de visibilité minimum pour qu'une card soit considérée "focused". */
const VISIBILITY_THRESHOLD = 0.5;
/** Delta de ratio en-dessous duquel on ne re-POST pas (anti-spam). */
const SCROLL_EPSILON = 0.004;

interface Options {
  /** Désactive l'observer si false (ex: pas sur l'onglet bibliothèque). */
  enabled: boolean;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * Trouve le conteneur scrollable vertical qui porte la grille (overflow-y
 * auto/scroll). Fallback null → c'est le document/window qui scrolle.
 */
function findScroller(): HTMLElement | null {
  const anchor = document.querySelector<HTMLElement>('[data-focus-playlist-id]');
  let el: HTMLElement | null = anchor?.parentElement ?? null;
  while (el) {
    const oy = window.getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 4) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

/** Ratio de scroll vertical 0..1 du conteneur de la grille (ou du document). */
function computeScrollRatio(): number {
  const scroller = findScroller();
  if (scroller) {
    const max = scroller.scrollHeight - scroller.clientHeight;
    return max > 0 ? clamp01(scroller.scrollTop / max) : 0;
  }
  const doc = document.documentElement;
  const max = doc.scrollHeight - window.innerHeight;
  return max > 0 ? clamp01(window.scrollY / max) : 0;
}

export function useFocusedPlaylistSync({ enabled }: Options): void {
  // État "voulu" (dernier calcul local).
  const focusedIdRef = useRef<string | null>(null);
  // État "envoyé" (dernier POST réussi/en cours).
  const sentIdRef = useRef<string | null>(null);
  const sentRatioRef = useRef<number>(-1);
  // Garde-fou réseau + coalescing.
  const inFlightRef = useRef<boolean>(false);
  const dirtyRef = useRef<boolean>(false);

  useEffect(() => {
    if (!enabled) return;

    /** Envoie l'état courant (focused + scroll) si différent du dernier POST. */
    const flush = (): void => {
      const id = focusedIdRef.current;
      const ratio = id ? computeScrollRatio() : 0;
      const idChanged = id !== sentIdRef.current;
      const ratioChanged = Math.abs(ratio - sentRatioRef.current) >= SCROLL_EPSILON;
      if (!idChanged && !ratioChanged) return;
      if (inFlightRef.current) {
        dirtyRef.current = true;
        return;
      }
      inFlightRef.current = true;
      dirtyRef.current = false;
      sentIdRef.current = id;
      sentRatioRef.current = ratio;
      postFocusedPlaylist(id, ratio)
        .catch((err) => {
          // Pas critique : le polling backend garde la dernière valeur (TTL 30s).
          console.warn('[FocusedPlaylistSync] post failed:', err);
        })
        .finally(() => {
          inFlightRef.current = false;
          // Coalescing : si un update est arrivé pendant le POST, on renvoie.
          if (dirtyRef.current) flush();
        });
    };

    // ── Focus (IntersectionObserver) ──────────────────────────────────────
    const ratios = new Map<string, number>();
    let focusTimer: number | null = null;

    const scheduleFocusSync = (): void => {
      if (focusTimer !== null) window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(() => {
        focusTimer = null;
        let bestId: string | null = null;
        let bestRatio = VISIBILITY_THRESHOLD;
        for (const [id, r] of ratios) {
          if (r > bestRatio) {
            bestRatio = r;
            bestId = id;
          }
        }
        focusedIdRef.current = bestId;
        flush();
      }, FOCUS_DEBOUNCE_MS);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).getAttribute('data-focus-playlist-id');
          if (!id) continue;
          if (entry.isIntersecting) ratios.set(id, entry.intersectionRatio);
          else ratios.delete(id);
        }
        scheduleFocusSync();
      },
      { threshold: [0.25, 0.5, 0.75, 1.0] },
    );

    const observeAll = (): void => {
      document
        .querySelectorAll<HTMLElement>('[data-focus-playlist-id]')
        .forEach((el) => observer.observe(el));
    };
    observeAll();

    const mutationObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches?.('[data-focus-playlist-id]')) observer.observe(node);
          node
            .querySelectorAll?.('[data-focus-playlist-id]')
            .forEach((el) => observer.observe(el as HTMLElement));
        });
      }
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    // ── Scroll-sync (throttle ~100ms) ─────────────────────────────────────
    // Listener en phase CAPTURE sur window : les events `scroll` ne bubblent
    // pas mais sont capturés → on intercepte aussi le scroll d'un éventuel
    // conteneur interne, sans connaître sa cible à l'avance.
    let scrollThrottle: number | null = null;
    const onScroll = (): void => {
      if (scrollThrottle !== null) return;
      scrollThrottle = window.setTimeout(() => {
        scrollThrottle = null;
        flush();
      }, SCROLL_THROTTLE_MS);
    };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });

    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
      if (focusTimer !== null) window.clearTimeout(focusTimer);
      if (scrollThrottle !== null) window.clearTimeout(scrollThrottle);
      // Signale au backend "host a quitté la sélection".
      void postFocusedPlaylist(null).catch(() => undefined);
      focusedIdRef.current = null;
      sentIdRef.current = null;
      sentRatioRef.current = -1;
    };
  }, [enabled]);
}
