/**
 * <SafariMediaBanner /> — bannière info affichée en haut du layout admin
 * uniquement sur Safari (macOS + iOS) pour informer l'user que les
 * réglages par défaut + content blockers peuvent bloquer la lecture
 * audio des blind tests.
 *
 * Détection :
 *   - navigator.userAgent contient "Safari" mais PAS "Chrome" / "CriOS"
 *     / "Edg" / "Firefox" / "FxiOS" (Chrome iOS = "CriOS").
 *   - heuristique : Safari pur sur Mac OS ou iOS.
 *
 * fix/pwa-safari-audio-unlock :
 *   - Si l'app tourne en PWA standalone (Dock macOS / Home Screen iOS),
 *     l'utilisateur n'a PAS d'icône "AA" dans la barre Safari (pas de barre
 *     du tout). Le message d'origine devient absurde et frustrant.
 *   - On masque alors la bandeau côté standalone. Le bouton "🔊 Forcer
 *     audio sur cet appareil" qui apparaît dans HostPage est l'autre filet
 *     de sécurité (clic = unlockAudioSync sync depuis gesture).
 *
 * Dismissible : bouton X. Persistance via localStorage
 * (`tutti.safari_banner_dismissed`). Une fois fermée, la bannière ne
 * réapparaît plus pour ce browser.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isStandalone } from '../../lib/audioUnlock.js';

const DISMISS_KEY = 'tutti.safari_banner_dismissed';

function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // Safari = "Safari" présent, mais pas Chrome/Edge/Firefox/CriOS/FxiOS.
  if (!ua.includes('Safari')) return false;
  if (ua.includes('Chrome') || ua.includes('CriOS')) return false;
  if (ua.includes('Edg')) return false;
  if (ua.includes('Firefox') || ua.includes('FxiOS')) return false;
  return true;
}

export function SafariMediaBanner(): JSX.Element | null {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isSafari()) return;
    // fix/pwa-safari-audio-unlock — en PWA standalone, pas de barre Safari →
    // pas d'icône AA → le hint "Réglages du site (icône AA)" est inutile.
    // Le bouton "Forcer audio" dans HostPage prend le relais.
    if (isStandalone()) {
      console.info('[Audio] SafariMediaBanner skip — PWA standalone detected');
      return;
    }
    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') return;
    } catch {
      /* localStorage unavailable (private mode) — show banner anyway */
    }
    setVisible(true);
  }, []);

  if (!visible) return null;

  const dismiss = (): void => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  return (
    <div className="bg-spritz/30 border-b-2 border-spritz-deep">
      <div className="max-w-6xl mx-auto px-4 py-2 flex items-start gap-3">
        <span className="text-xl shrink-0" aria-hidden>
          📱
        </span>
        <p className="flex-1 text-sm text-ink leading-snug">
          <span className="font-display mr-1">{t('preGame.safariBannerTitle')}</span>
          {t('preGame.safariBannerHint')}
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('preGame.safariBannerDismiss')}
          className="shrink-0 text-ink-soft hover:text-ink px-2 text-lg leading-none"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
