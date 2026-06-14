/**
 * useSelectionBackgroundMusic — feat/selection-ui-mirroring (item 4)
 *
 * Joue une musique d'ambiance en boucle pendant que l'animateur est sur
 * l'écran de SÉLECTION de playlist. Démarre quand `enabled` passe true (arrivée
 * sur la sélection), s'arrête à la sortie (choix d'une playlist OU quitte la
 * sélection → unmount du composant qui appelle ce hook).
 *
 * ── Slot de configuration ──────────────────────────────────────────────────
 * L'URL de l'asset est volontairement un SLOT vide par défaut : tant qu'aucune
 * URL n'est fournie, le hook est un no-op (la PR ne dépend donc pas de l'asset).
 * Pour activer : déposer un fichier audio royalty-free et renseigner soit la
 * const ci-dessous, soit la variable d'env Vite `VITE_SELECTION_MUSIC_URL`.
 *
 * Asset attendu (à fournir par Thomas) : boucle instrumentale royalty-free,
 * ambiance lounge/upbeat ~60-120s, MP3/AAC, sans voix. Placer dans
 * `frontend/public/audio/selection-loop.mp3` puis :
 *   VITE_SELECTION_MUSIC_URL=/audio/selection-loop.mp3
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

/** Slot config — laisser vide pour désactiver (no-op). Override via env. */
const SELECTION_MUSIC_URL: string =
  (import.meta.env.VITE_SELECTION_MUSIC_URL as string | undefined) ?? '';

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
