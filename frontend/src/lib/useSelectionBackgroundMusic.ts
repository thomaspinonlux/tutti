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

    const attemptPlay = (): void => {
      if (!audio.paused) return;
      audio.play().catch(() => undefined);
    };

    attemptPlay();
    // fix/selection-music-mode-b — en Mode B, PERSONNE ne touche l'iPad entre
    // deux manches (l'animateur pilote depuis son téléphone) : le « premier
    // geste utilisateur » n'arrive jamais. D'où un réessai périodique.
    //
    // fix/console-figee — le réessai S'ARRÊTE dès que la musique démarre, et
    // le rattrapage au premier toucher est en `once` : avant, chaque tap sur
    // une vignette de playlist déclenchait un appel audio supplémentaire, ce
    // qui alourdissait l'écran de sélection au pire moment.
    // fix/reessai-sans-fin — LE RÉESSAI EST PLAFONNÉ.
    // Il ne s'arrêtait que si la musique démarrait : quand le fichier est
    // absent ou introuvable (déploiement, adresse de secours morte), la boucle
    // tournait indéfiniment tant que l'animateur restait sur l'écran de
    // sélection, avec un rejet avalé à chaque tour. Trente essais couvrent
    // largement l'attente d'un premier geste ; au-delà, ce n'est pas le geste
    // qui manque, c'est le fichier.
    let retryId = 0;
    let essais = 0;
    const tick = (): void => {
      if (!audio.paused || essais >= 30) {
        window.clearInterval(retryId);
        return;
      }
      essais += 1;
      attemptPlay();
    };
    retryId = window.setInterval(tick, 2000);
    window.addEventListener('pointerdown', attemptPlay, { once: true });

    return () => {
      window.clearInterval(retryId);
      window.removeEventListener('pointerdown', attemptPlay);
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
