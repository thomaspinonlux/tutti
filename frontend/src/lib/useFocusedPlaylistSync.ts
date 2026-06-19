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
/**
 * Keepalive : re-POST focus+scroll même immobile, pour rafraîchir le TTL 30s
 * du store backend. Sans ça, animateur immobile > 30s → PLAYLIST_SELECTION
 * tombe → la TV revient sur le QR/lobby. 10s = 3× de marge sous le TTL.
 */
const KEEPALIVE_MS = 10_000;
/** Seuil de visibilité minimum pour qu'une card soit considérée "focused". */
const VISIBILITY_THRESHOLD = 0.5;
/** Delta de ratio en-dessous duquel on ne re-POST pas (anti-spam). */
const SCROLL_EPSILON = 0.004;

interface Options {
  /** Désactive l'observer si false (ex: pas sur l'onglet bibliothèque). */
  enabled: boolean;
  /**
   * Signal de changement de structure DOM (ex: themeSections.length, ou un
   * compteur incrémenté quand le contenu mirroré change). Quand il change,
   * on (re-)observe TOUS les `[data-focus-playlist-id]` du DOM avec le même
   * IntersectionObserver (idempotent). Remplace l'ancien MutationObserver
   * globale `document.body`, plus léger sur Safari Mac/iPad.
   */
  signalKey?: string | number;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * Résout l'élément RÉELLEMENT scrollé depuis la cible d'un event `scroll`.
 * Le host scrolle un conteneur interne (pas window) → on ne devine pas, on
 * prend la cible de l'event :
 *   - élément → lui-même
 *   - document / Document → scrollingElement (ou documentElement) en fallback
 */
function resolveScrollEl(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) return target;
  if (target === document || target instanceof Document) {
    return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
  }
  return null;
}

/** Ratio de scroll vertical 0..1 de l'élément donné (fallback document). */
function computeScrollRatio(el: HTMLElement | null): number {
  const scroller =
    el ?? (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
  if (!scroller) return 0;
  const max = scroller.scrollHeight - scroller.clientHeight;
  return max > 0 ? clamp01(scroller.scrollTop / max) : 0;
}

type HRatios = Record<string, number>;

/**
 * Ratio de scroll HORIZONTAL 0..1 de chaque carrousel de catégorie, clé = slug.
 * Lit tous les `[data-carousel-cat]` du DOM (rendus par CategoryRow).
 */
function computeHRatios(): HRatios {
  const out: HRatios = {};
  document.querySelectorAll<HTMLElement>('[data-carousel-cat]').forEach((el) => {
    const slug = el.getAttribute('data-carousel-cat');
    if (!slug) return;
    const max = el.scrollWidth - el.clientWidth;
    out[slug] = max > 0 ? clamp01(el.scrollLeft / max) : 0;
  });
  return out;
}

/** true si un slug a changé de ≥ epsilon, ou si le set de clés diffère. */
function hRatiosChanged(a: HRatios, b: HRatios): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return true;
  for (const k of ak) {
    const bv = b[k];
    if (bv === undefined) return true;
    if (Math.abs(a[k]! - bv) >= SCROLL_EPSILON) return true;
  }
  return false;
}

export function useFocusedPlaylistSync({ enabled, signalKey }: Options): void {
  // État "voulu" (dernier calcul local).
  const focusedIdRef = useRef<string | null>(null);
  // État "envoyé" (dernier POST réussi/en cours).
  const sentIdRef = useRef<string | null>(null);
  const sentRatioRef = useRef<number>(-1);
  const sentHRatiosRef = useRef<HRatios>({});
  // Garde-fou réseau + coalescing.
  const inFlightRef = useRef<boolean>(false);
  const dirtyRef = useRef<boolean>(false);
  // Observer partagé — exposé via ref pour qu'un effet séparé (déclenché par
  // signalKey) puisse appeler observeAll() sur les nouveaux nœuds rendus.
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (!enabled) return;

    // Dernier conteneur VERTICALEMENT scrollé, capté depuis les events scroll
    // (cf. onScroll). null tant qu'aucun scroll → fallback document.
    let scrollerEl: HTMLElement | null = null;

    /**
     * Envoie l'état courant (focused + scroll). Par défaut, no-op si identique
     * au dernier POST (dedup). `force` = re-POST quoi qu'il arrive (keepalive
     * TTL : rafraîchir le store backend même immobile).
     */
    const flush = (force = false): void => {
      const id = focusedIdRef.current;
      const ratio = id ? computeScrollRatio(scrollerEl) : 0;
      const hRatios = id ? computeHRatios() : {};
      const idChanged = id !== sentIdRef.current;
      const ratioChanged = Math.abs(ratio - sentRatioRef.current) >= SCROLL_EPSILON;
      const hChanged = hRatiosChanged(hRatios, sentHRatiosRef.current);
      if (!force && !idChanged && !ratioChanged && !hChanged) return;
      if (inFlightRef.current) {
        dirtyRef.current = true;
        return;
      }
      inFlightRef.current = true;
      dirtyRef.current = false;
      sentIdRef.current = id;
      sentRatioRef.current = ratio;
      sentHRatiosRef.current = hRatios;
      const hLog = Object.entries(hRatios)
        .map(([k, v]) => `${k}:${v.toFixed(2)}`)
        .join(',');
      console.info(
        `[FocusedSync] POST id=${id ?? 'null'} ratio=${ratio.toFixed(3)} h={${hLog}}${force ? ' (keepalive)' : ''}`,
      );
      postFocusedPlaylist(id, ratio, hRatios)
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
    observerRef.current = observer;

    const observeAll = (): void => {
      document
        .querySelectorAll<HTMLElement>('[data-focus-playlist-id]')
        .forEach((el) => observer.observe(el));
    };
    observeAll();
    // Note : pas de MutationObserver global sur document.body (coûteux sur
    // Safari Mac/iPad). Les ré-observations après changement de structure
    // (themeSections, search, level step) sont déclenchées par le signalKey
    // dans un effet séparé ci-dessous. IntersectionObserver.observe est
    // idempotent → on peut re-observer les mêmes nœuds sans risque.

    // ── Scroll-sync (throttle ~100ms) ─────────────────────────────────────
    // Listener en phase CAPTURE sur window : les events `scroll` ne bubblent
    // pas mais sont capturés → on intercepte le scroll de n'importe quel
    // conteneur. On CALCULE le ratio depuis la CIBLE de l'event (l'élément qui
    // scrolle vraiment), pas window — le host scrolle un conteneur interne donc
    // window.scrollY reste 0. On ne retient la cible que si elle a un overflow
    // VERTICAL (> 4px) → ignore le scroll horizontal des carrousels.
    let scrollThrottle: number | null = null;
    const onScroll = (e: Event): void => {
      const el = resolveScrollEl(e.target);
      if (el && el.scrollHeight - el.clientHeight > 4) {
        scrollerEl = el;
      }
      if (scrollThrottle !== null) return;
      scrollThrottle = window.setTimeout(() => {
        scrollThrottle = null;
        flush();
      }, SCROLL_THROTTLE_MS);
    };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });

    // ── Keepalive TTL (re-POST toutes les 10s tant qu'une playlist est focused) ──
    // Rafraîchit le store backend (TTL 30s) même si l'animateur ne bouge pas →
    // la TV reste sur la grille au lieu de retomber sur le QR/lobby. Skip si
    // aucun focus (ex: onglet "Mes playlists" sans cards officielles → on laisse
    // le TTL expirer, il n'y a pas de grille officielle à mirrorer).
    const keepaliveTimer = window.setInterval(() => {
      if (focusedIdRef.current) flush(true);
    }, KEEPALIVE_MS);

    return () => {
      observer.disconnect();
      observerRef.current = null;
      window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
      window.clearInterval(keepaliveTimer);
      if (focusTimer !== null) window.clearTimeout(focusTimer);
      if (scrollThrottle !== null) window.clearTimeout(scrollThrottle);
      // Signale au backend "host a quitté la sélection".
      void postFocusedPlaylist(null).catch(() => undefined);
      focusedIdRef.current = null;
      sentIdRef.current = null;
      sentRatioRef.current = -1;
      sentHRatiosRef.current = {};
    };
  }, [enabled]);

  // Re-observation idempotente quand la structure DOM change (signalKey).
  // observer.observe est idempotent → re-observer un nœud déjà observé est
  // un no-op. Cible : nouvelles cards apparues après changement de provider,
  // de recherche, de filtre, ou d'étape (thème ⇄ niveau).
  useEffect(() => {
    if (!enabled) return;
    const obs = observerRef.current;
    if (!obs) return;
    document
      .querySelectorAll<HTMLElement>('[data-focus-playlist-id]')
      .forEach((el) => obs.observe(el));
  }, [enabled, signalKey]);
}
