/**
 * useFocusedPlaylistSync — feat/tv-rail-selection
 *
 * Observe la grille de sélection de l'animateur et transmet UNE SEULE chose :
 * **quelle playlist est sélectionnée** (l'élément le plus visible, marqué
 * `data-focus-playlist-id`). Plus aucune position de défilement.
 *
 * Pourquoi ce changement : la console et la télécommande défilent
 * verticalement, la TV est un écran large. Un pourcentage de défilement
 * vertical n'a aucune traduction fidèle sur un bandeau horizontal — chaque
 * valeur était une approximation, et elle arrivait en retard. Un identifiant,
 * lui, est exact : la TV le traduit elle-même en amenant la carte au centre.
 *
 * ENVOI ANTI-RAFALE — pendant un balayage rapide, on n'envoie qu'un message
 * toutes les 120 ms, et TOUJOURS le dernier (celui où le doigt s'arrête). Le
 * réseau ne voit passer que quelques messages au lieu de dizaines. Comme
 * chaque message porte une sélection ABSOLUE et non un déplacement, un message
 * perdu ne coûte rien : le suivant corrige tout à lui seul.
 *
 * Destination : `POST /api/workspace/screen-state/focused-playlist`.
 * Au démontage, on envoie `null` (l'animateur a quitté la sélection) ; le
 * store backend garde un TTL de 30 s en filet.
 */

import { useEffect, useRef } from 'react';
import { postFocusedPlaylist } from './screenState.js';

/** Anti-rebond du changement de sélection (les carrousels s'aimantent). */
const FOCUS_DEBOUNCE_MS = 120;
/**
 * Cadence maximale d'envoi : au plus un message toutes les 120 ms pendant un
 * balayage rapide, le dernier étant toujours transmis.
 */
const SEND_THROTTLE_MS = 120;
/**
 * Renvoi périodique : rafraîchit le TTL de 30 s du store backend même quand
 * l'animateur ne bouge plus. Sans lui, au-delà de 30 s d'immobilité la TV
 * quitterait l'écran de sélection. 10 s laisse trois fois la marge.
 */
const KEEPALIVE_MS = 10_000;
/** Visibilité minimale pour qu'une carte soit considérée comme sélectionnée. */
const VISIBILITY_THRESHOLD = 0.5;

interface Options {
  /** Désactive l'observation si false (ex. hors de l'onglet bibliothèque). */
  enabled: boolean;
  /**
   * Signal de changement de structure : quand il change, on ré-observe tous
   * les `[data-focus-playlist-id]` présents (l'observation est idempotente).
   */
  signalKey?: string | number;
  /** Thème ouvert côté animateur (étape niveau) ; null = étape thèmes. */
  selectedThemeKey?: string | null;
}

export function useFocusedPlaylistSync({ enabled, signalKey, selectedThemeKey }: Options): void {
  /** Dernière sélection calculée localement. */
  const focusedIdRef = useRef<string | null>(null);
  /** Dernière sélection réellement transmise. */
  const sentIdRef = useRef<string | null>(null);
  const sentThemeKeyRef = useRef<string | null | undefined>(undefined);
  /** Horodatage du dernier envoi + envoi différé en attente (anti-rafale). */
  const lastSendRef = useRef(0);
  const pendingRef = useRef<number | null>(null);
  /** Garde réseau : un envoi à la fois, avec reprise si du neuf est arrivé. */
  const inFlightRef = useRef(false);
  const dirtyRef = useRef(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const selectedThemeKeyRef = useRef<string | null>(selectedThemeKey ?? null);
  const sendRef = useRef<((force?: boolean) => void) | null>(null);

  useEffect(() => {
    if (!enabled) return;

    /** Envoi effectif — appelé par l'anti-rafale, jamais directement. */
    const post = (force: boolean): void => {
      const id = focusedIdRef.current;
      const themeKey = id ? selectedThemeKeyRef.current : null;
      if (!force && id === sentIdRef.current && themeKey === sentThemeKeyRef.current) return;
      if (inFlightRef.current) {
        dirtyRef.current = true;
        return;
      }
      inFlightRef.current = true;
      dirtyRef.current = false;
      sentIdRef.current = id;
      sentThemeKeyRef.current = themeKey;
      lastSendRef.current = Date.now();
      postFocusedPlaylist(id, undefined, undefined, themeKey)
        .catch((err) => {
          // Sans gravité : la TV garde la dernière sélection reçue (TTL 30 s).
          console.warn('[SélectionSync] envoi échoué :', err);
        })
        .finally(() => {
          inFlightRef.current = false;
          if (dirtyRef.current) post(false);
        });
    };

    /**
     * Anti-rafale : au plus un envoi toutes les SEND_THROTTLE_MS, et un envoi
     * différé garantit que la DERNIÈRE sélection part toujours, même si le
     * doigt s'arrête juste après un envoi.
     */
    const send = (force = false): void => {
      if (force) {
        post(true);
        return;
      }
      const waited = Date.now() - lastSendRef.current;
      if (waited >= SEND_THROTTLE_MS) {
        post(false);
        return;
      }
      if (pendingRef.current !== null) return;
      pendingRef.current = window.setTimeout(() => {
        pendingRef.current = null;
        post(false);
      }, SEND_THROTTLE_MS - waited);
    };
    sendRef.current = send;

    // ── Quelle carte est sélectionnée : la plus visible à l'écran ──────────
    const visibility = new Map<string, number>();
    let debounce: number | null = null;

    const scheduleSelection = (): void => {
      if (debounce !== null) window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        debounce = null;
        let bestId: string | null = null;
        let best = VISIBILITY_THRESHOLD;
        for (const [id, ratio] of visibility) {
          if (ratio > best) {
            best = ratio;
            bestId = id;
          }
        }
        focusedIdRef.current = bestId;
        send();
      }, FOCUS_DEBOUNCE_MS);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).getAttribute('data-focus-playlist-id');
          if (!id) continue;
          if (entry.isIntersecting) visibility.set(id, entry.intersectionRatio);
          else visibility.delete(id);
        }
        scheduleSelection();
      },
      { threshold: [0.25, 0.5, 0.75, 1.0] },
    );
    observerRef.current = observer;
    document
      .querySelectorAll<HTMLElement>('[data-focus-playlist-id]')
      .forEach((el) => observer.observe(el));

    // Le défilement ne transporte plus rien : il sert seulement à réévaluer
    // quelle carte est la plus visible, ce dont l'observateur se charge déjà.
    // fix/tv-sort-de-la-selection — LE SIGNAL PART MÊME SANS CARTE CHOISIE.
    // Il n'était émis que si une carte était mise en avant : à l'étape des
    // thèmes, ou juste après un retour en arrière, plus rien ne partait et la
    // TV quittait l'écran de sélection au bout de 30 s (durée de validité côté
    // serveur) pour retomber sur l'écran d'attente.
    const keepalive = window.setInterval(() => {
      send(true);
    }, KEEPALIVE_MS);

    return () => {
      observer.disconnect();
      observerRef.current = null;
      window.clearInterval(keepalive);
      if (debounce !== null) window.clearTimeout(debounce);
      if (pendingRef.current !== null) window.clearTimeout(pendingRef.current);
      pendingRef.current = null;
      void postFocusedPlaylist(null).catch(() => undefined);
      sendRef.current = null;
      focusedIdRef.current = null;
      sentIdRef.current = null;
      sentThemeKeyRef.current = undefined;
    };
  }, [enabled]);

  // Changement d'étape (thèmes ⇄ niveaux) : envoi immédiat, même si la carte
  // sélectionnée ne change pas.
  useEffect(() => {
    selectedThemeKeyRef.current = selectedThemeKey ?? null;
    if (enabled) sendRef.current?.(true);
  }, [enabled, selectedThemeKey]);

  // Ré-observation quand la structure change (recherche, filtre, étape).
  useEffect(() => {
    if (!enabled) return;
    const obs = observerRef.current;
    if (!obs) return;
    document
      .querySelectorAll<HTMLElement>('[data-focus-playlist-id]')
      .forEach((el) => obs.observe(el));
  }, [enabled, signalKey]);
}
