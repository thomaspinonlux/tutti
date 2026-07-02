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
 * `registerType: 'autoUpdate'` côté vite.config.ts : un nouveau SW s'active et
 * reload la page automatiquement, mais SEULEMENT au (ré)chargement de l'app
 * (pas de vérif périodique en session → jamais de reload en pleine partie).
 * `needsRefresh`/`applyUpdate` restent exposés en fallback (navigateurs sans
 * auto-reload), mais en pratique le banner ne s'affiche plus.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

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
  // Réf. du SW enregistré + throttle des vérifs d'update (anti-spam au switch d'app).
  const swRegistrationRef = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const lastUpdateCheckRef = useRef(0);

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
          onRegistered: (r) => {
            // Capture la registration pour forcer une vérif d'update au refocus
            // (cf. effet ci-dessous). registerType 'autoUpdate' : si une nouvelle
            // version est trouvée, le SW s'active (skipWaiting) + la page reload.
            // On NE poll PAS en continu : un deploy en pleine partie ne doit pas
            // reloader l'onglet host. Le check se fait au RETOUR dans l'app
            // (visibilitychange), instant où l'on ne joue pas.
            swRegistrationRef.current = r;
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

  // Vérifie une nouvelle version À CHAQUE retour dans l'app (visibilitychange / focus).
  // Corrige le bundle périmé sur un onglet resté ouvert AVANT un deploy : iOS Safari ne
  // re-checke pas le SW tout seul en session, donc un host laissé ouvert servait l'ancien
  // bundle indéfiniment (capsule son fantôme, etc.). Throttle 20s (anti-spam au switch
  // d'app). Avec registerType 'autoUpdate', une version trouvée s'active + reload — au
  // refocus on ne joue pas à cet instant, donc pas de reload en plein morceau.
  useEffect(() => {
    const check = (): void => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastUpdateCheckRef.current < 20_000) return;
      lastUpdateCheckRef.current = now;
      void swRegistrationRef.current?.update().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
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
