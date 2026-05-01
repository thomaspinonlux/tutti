/**
 * useExternalScreen — détecte la présence d'un écran externe via la
 * Window Management API, propose une popup d'auto-projection au 1er render,
 * et expose une méthode openOnExternalScreen() pour le bouton manuel.
 *
 * Compat :
 *   - Chrome/Edge desktop : Window Management API supportée → détection auto
 *     + positionnement de la fenêtre /screen sur l'écran externe
 *   - Safari (Mac/iOS) : pas d'API → bouton manuel uniquement, qui ouvre
 *     /screen dans un nouvel onglet (l'utilisateur le glisse manuellement
 *     vers l'écran externe, ou bénéficie du mirroring iPad HDMI/AirPlay)
 *   - Firefox : pas d'API → fallback bouton manuel
 *
 * Permissions : navigator.permissions.query({name:'window-management'}) renvoie
 * 'granted' | 'prompt' | 'denied'. Si 'prompt', appel à getScreenDetails()
 * déclenche une demande utilisateur.
 *
 * Mémorisation : le consentement (auto-open accepté ou refusé pour la session)
 * est stocké en localStorage pour ne pas redemander à chaque navigation.
 */

import { useEffect, useState } from 'react';

const STORAGE_KEY_AUTO = 'tutti.externalScreen.autoOpen'; // 'yes' | 'no' | null
const POPUP_FEATURES = 'noopener,noreferrer';

interface ScreenDetailsLike {
  screens: Array<{
    isPrimary: boolean;
    left: number;
    top: number;
    width: number;
    height: number;
    label?: string;
  }>;
  currentScreen?: { isPrimary: boolean };
}

interface WindowWithGetScreenDetails extends Window {
  getScreenDetails?: () => Promise<ScreenDetailsLike>;
}

export interface UseExternalScreenResult {
  /** true si la Window Management API est supportée par ce navigateur. */
  apiSupported: boolean;
  /** true si plus d'un écran est disponible (api supportée requise). */
  hasExternalScreen: boolean;
  /** true si l'API a été interrogée au moins une fois (loading state). */
  detected: boolean;
  /** Doit-on afficher le prompt d'auto-projection ? */
  shouldPromptAutoOpen: boolean;
  /** Ouvre /screen?session=CODE sur l'écran externe (auto-positionné). */
  openOnExternalScreen: (shortCode: string) => Promise<boolean>;
  /** Mémorise un choix pour ne pas redemander cette session. */
  rememberChoice: (autoOpen: boolean) => void;
  /** Reset le choix mémorisé. */
  forgetChoice: () => void;
}

export function useExternalScreen(): UseExternalScreenResult {
  const w = window as WindowWithGetScreenDetails;
  const apiSupported = typeof w.getScreenDetails === 'function';

  const [detected, setDetected] = useState(false);
  const [hasExternalScreen, setHasExternalScreen] = useState(false);
  const [externalScreen, setExternalScreen] = useState<ScreenDetailsLike['screens'][0] | null>(
    null,
  );

  useEffect(() => {
    if (!apiSupported) {
      setDetected(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const details = await w.getScreenDetails!();
        if (cancelled) return;
        const external = details.screens.find((s) => !s.isPrimary);
        setHasExternalScreen(!!external);
        setExternalScreen(external ?? null);
      } catch {
        // Permission refusée ou autre erreur — pas grave, on tombe sur fallback manuel
      } finally {
        if (!cancelled) setDetected(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiSupported, w]);

  const remembered =
    typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY_AUTO) : null;
  const shouldPromptAutoOpen = hasExternalScreen && remembered === null;

  const rememberChoice = (autoOpen: boolean): void => {
    try {
      window.localStorage.setItem(STORAGE_KEY_AUTO, autoOpen ? 'yes' : 'no');
    } catch {
      /* ignore */
    }
  };

  const forgetChoice = (): void => {
    try {
      window.localStorage.removeItem(STORAGE_KEY_AUTO);
    } catch {
      /* ignore */
    }
  };

  /**
   * Ouvre /screen?session=CODE :
   *   - Si écran externe détecté + API supportée : positionne la fenêtre dessus
   *   - Sinon : ouvre dans un nouvel onglet, l'utilisateur déplace manuellement
   * Retourne true si la fenêtre a bien été ouverte.
   */
  const openOnExternalScreen = async (shortCode: string): Promise<boolean> => {
    const url = `/screen?session=${encodeURIComponent(shortCode.toUpperCase())}`;
    let features = POPUP_FEATURES;
    if (apiSupported && externalScreen) {
      features = `${POPUP_FEATURES},left=${externalScreen.left},top=${externalScreen.top},width=${externalScreen.width},height=${externalScreen.height},fullscreen=yes`;
    }
    const win = window.open(url, 'tutti-screen', features);
    if (!win) {
      // Bloqué par popup blocker
      return false;
    }
    return true;
  };

  return {
    apiSupported,
    hasExternalScreen,
    detected,
    shouldPromptAutoOpen,
    openOnExternalScreen,
    rememberChoice,
    forgetChoice,
  };
}
