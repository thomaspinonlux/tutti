/**
 * Hook React pour la Wake Lock API — garde l'écran allumé pendant
 * une session active (cf. docs/PLAYER_RESILIENCE.md).
 *
 * Usage :
 *   useWakeLock(session?.status === 'PLAYING');
 *
 * - Si l'API n'est pas supportée (Safari iOS < 16.4, Firefox Android…),
 *   le hook ne fait rien (silencieux, pas d'erreur).
 * - Le navigateur relâche automatiquement le sentinel quand la page
 *   passe en background ; on le ré-acquiert sur `visibilitychange`.
 */

import { useEffect, useRef } from 'react';

// Type minimal de WakeLockSentinel — TypeScript le déclare déjà globalement
// dans lib.dom récent, mais on reste tolérant.
type Sentinel = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
};

export function useWakeLock(enabled: boolean): void {
  const sentinelRef = useRef<Sentinel | null>(null);

  useEffect(() => {
    const wl = (
      navigator as unknown as { wakeLock?: { request?: (type: 'screen') => Promise<Sentinel> } }
    ).wakeLock;
    if (!wl || typeof wl.request !== 'function') return;
    if (!enabled) return;

    let cancelled = false;

    const acquire = async (): Promise<void> => {
      try {
        if (document.visibilityState !== 'visible') return;
        const sentinel = await wl.request!('screen');
        if (cancelled) {
          void sentinel.release();
          return;
        }
        sentinelRef.current = sentinel;
        sentinel.addEventListener('release', () => {
          // Le navigateur a relâché le sentinel (page hidden / batterie faible).
          // On ne reset PAS sentinelRef ici : visibilitychange déclenchera
          // une nouvelle acquisition au retour.
        });
      } catch {
        // Permission refusée ou contexte non sécurisé (HTTP) : silencieux.
      }
    };

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible' && enabled && !sentinelRef.current?.released) {
        void acquire();
      } else if (
        document.visibilityState === 'visible' &&
        enabled &&
        sentinelRef.current?.released
      ) {
        // Sentinel relâché auto par le navigateur, on en redemande un.
        void acquire();
      }
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      const s = sentinelRef.current;
      sentinelRef.current = null;
      if (s && !s.released) {
        void s.release().catch(() => {
          /* déjà relâché — ignore */
        });
      }
    };
  }, [enabled]);
}
