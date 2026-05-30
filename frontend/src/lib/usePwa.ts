/**
 * usePwa.ts — feat/pwa-installable
 *
 * Hook React qui expose l'API PWA :
 *   - needsRefresh   : true quand le SW a téléchargé une nouvelle version
 *   - applyUpdate()  : skipWaiting + reload pour activer la nouvelle version
 *   - canInstall     : true quand le navigateur a émis 'beforeinstallprompt'
 *   - promptInstall  : déclenche le prompt natif (Chrome/Edge Android+desktop)
 *   - isStandalone   : true quand la page tourne en mode installé (PWA / iOS HA)
 *   - isIos          : true sur iOS (Safari ne supporte pas beforeinstallprompt
 *                      → l'app doit afficher des instructions manuelles)
 *
 * registerSW vient de virtual:pwa-register (injecté par vite-plugin-pwa).
 * `registerType: 'prompt'` côté vite.config.ts garantit que `onNeedRefresh` est
 * appelé QUAND une mise à jour est dispo, mais qu'on attend confirmation user
 * avant de skipWaiting (sinon le SW peut redémarrer la page en plein milieu
 * d'une partie — désastreux côté host).
 */

import { useCallback, useEffect, useState } from 'react';

/** Type minimal de l'event beforeinstallprompt (pas standard TS). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/**
 * Détecte si la page tourne en mode PWA standalone (display-mode standalone)
 * ou si iOS l'a ajoutée à l'écran d'accueil (navigator.standalone).
 */
function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mql = window.matchMedia?.('(display-mode: standalone)');
  if (mql?.matches) return true;
  // iOS Safari < 16 : pas de display-mode standalone fiable, on lit la prop
  // legacy navigator.standalone.
  const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone;
  return iosStandalone === true;
}

function detectIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  // iPad iOS 13+ se présente comme Mac — on filtre via touchpoints pour exclure
  // les vrais Mac (qui n'ont pas d'écran tactile).
  const ua = navigator.userAgent;
  const isAppleMobile = /iPhone|iPad|iPod/.test(ua);
  const isIpadOS =
    /Macintosh/.test(ua) &&
    typeof navigator.maxTouchPoints === 'number' &&
    navigator.maxTouchPoints > 1;
  return isAppleMobile || isIpadOS;
}

export interface PwaApi {
  /** Une mise à jour SW est prête, on attend confirmation user pour reload. */
  needsRefresh: boolean;
  /** Active la mise à jour (skipWaiting + reload page). */
  applyUpdate: () => void;
  /** Ferme la notif update sans appliquer (sera reproposée à la prochaine visite). */
  dismissUpdate: () => void;
  /** Le navigateur permet l'install via prompt natif (Chrome/Edge). */
  canInstall: boolean;
  /** Déclenche le prompt natif. Résout 'accepted' ou 'dismissed'. */
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
  /** La page tourne en mode standalone (PWA déjà installée). */
  isStandalone: boolean;
  /** iOS — pas de prompt natif, afficher instructions manuelles. */
  isIos: boolean;
}

export function usePwa(): PwaApi {
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [updateSW, setUpdateSW] = useState<((reloadPage?: boolean) => Promise<void>) | null>(null);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(() => detectStandalone());
  const [isIos] = useState<boolean>(() => detectIos());

  // Enregistre le service worker via virtual:pwa-register. Import dynamique
  // pour ne pas casser le build si le plugin est absent.
  useEffect(() => {
    let cancelled = false;
    void import('virtual:pwa-register')
      .then(({ registerSW }) => {
        if (cancelled) return;
        const updater = registerSW({
          immediate: true,
          onNeedRefresh: () => setNeedsRefresh(true),
          onRegistered: (reg) => {
            // Re-vérifie l'update toutes les 30min (idéal pour les longues
            // sessions host qui restent ouvertes).
            if (reg) {
              setInterval(
                () => {
                  void reg.update().catch(() => {});
                },
                30 * 60 * 1000,
              );
            }
          },
          onRegisterError: (err) => {
            console.warn('[PWA] SW register error', err);
          },
        });
        setUpdateSW(() => updater);
      })
      .catch(() => {
        // Plugin PWA pas dispo (dev sans build) — silent skip.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Capture beforeinstallprompt pour pouvoir déclencher le prompt plus tard.
  useEffect(() => {
    const handler = (e: Event): void => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler as EventListener);

    const onInstalled = (): void => {
      setInstallEvent(null);
      setIsStandalone(true);
    };
    window.addEventListener('appinstalled', onInstalled);

    // Met à jour isStandalone si l'utilisateur quitte/réouvre en mode standalone.
    const mql = window.matchMedia?.('(display-mode: standalone)');
    const onMqlChange = (): void => setIsStandalone(detectStandalone());
    mql?.addEventListener?.('change', onMqlChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler as EventListener);
      window.removeEventListener('appinstalled', onInstalled);
      mql?.removeEventListener?.('change', onMqlChange);
    };
  }, []);

  const applyUpdate = useCallback((): void => {
    if (!updateSW) {
      // Pas de SW → reload normal pour récupérer la dernière version.
      window.location.reload();
      return;
    }
    void updateSW(true).catch((err) => {
      console.warn('[PWA] updateSW failed, fallback reload', err);
      window.location.reload();
    });
  }, [updateSW]);

  const dismissUpdate = useCallback((): void => setNeedsRefresh(false), []);

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!installEvent) return 'unavailable';
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    setInstallEvent(null);
    return choice.outcome;
  }, [installEvent]);

  return {
    needsRefresh,
    applyUpdate,
    dismissUpdate,
    canInstall: installEvent !== null,
    promptInstall,
    isStandalone,
    isIos,
  };
}
