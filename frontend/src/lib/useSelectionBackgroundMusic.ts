/**
 * useSelectionBackgroundMusic — feat/selection-ui-mirroring (item 4)
 *
 * Joue une musique d'ambiance en boucle pendant que l'animateur est sur
 * l'écran de SÉLECTION de playlist. Démarre quand `enabled` passe true (arrivée
 * sur la sélection), s'arrête à la sortie (choix d'une playlist OU quitte la
 * sélection → unmount du composant qui appelle ce hook).
 *
 * ── Slot de configuration ──────────────────────────────────────────────────
 * Asset bundlé par défaut : `public/audio/selection-loop.mp3` (boucle upbeat
 * royalty-free, ~2:22, 128 kbps, sans voix — fournie par Thomas). Override via
 * `VITE_SELECTION_MUSIC_URL` (ex: CDN), ou '' pour désactiver (no-op).
 *
 * ── Autoplay ───────────────────────────────────────────────────────────────
 * Si le navigateur bloque l'autoplay (pas de geste user récent), on réessaie au
 * premier `pointerdown`. Aucune exception ne remonte (jamais de crash).
 *
 * ── iOS PWA ────────────────────────────────────────────────────────────────
 * Sur iPad PWA standalone, un seul flux audio « claim » à la fois : cette
 * musique s'arrête à la sortie de la sélection, AVANT que le player YouTube ne
 * prenne la main au lancement. À re-tester sur device quand l'asset sera fourni.
 */

import { useEffect, useRef } from 'react';

/**
 * Slot config — URL de l'asset. Défaut = la boucle bundlée dans public/audio/.
 * Override possible via `VITE_SELECTION_MUSIC_URL` (ex: CDN), ou la mettre à ''
 * pour désactiver (no-op).
 */
const SELECTION_MUSIC_URL: string =
  (import.meta.env.VITE_SELECTION_MUSIC_URL as string | undefined) ?? '/audio/selection-loop.mp3';

/** Volume d'ambiance (0..1) — discret pour rester en fond. */
const DEFAULT_VOLUME = 0.35;

interface Options {
  /** true = sur l'écran de sélection (joue). false / unmount = stop. */
  enabled: boolean;
}

export function useSelectionBackgroundMusic({ enabled }: Options): void {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!enabled || !SELECTION_MUSIC_URL) return;

    const audio = new Audio(SELECTION_MUSIC_URL);
    audio.loop = true;
    audio.volume = DEFAULT_VOLUME;
    audio.preload = 'auto';
    audioRef.current = audio;

    let gestureCleanup: (() => void) | null = null;

    const attemptPlay = (): void => {
      audio.play().catch(() => {
        // Autoplay bloqué → démarre au premier geste user, une seule fois.
        const onGesture = (): void => {
          audio.play().catch(() => undefined);
        };
        window.addEventListener('pointerdown', onGesture, { once: true });
        gestureCleanup = () => window.removeEventListener('pointerdown', onGesture);
      });
    };

    attemptPlay();

    return () => {
      gestureCleanup?.();
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {
        /* noop */
      }
      audioRef.current = null;
    };
  }, [enabled]);
}
