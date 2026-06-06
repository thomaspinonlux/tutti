/**
 * <ContentBlockerHintBanner /> — feat/detect-content-blocker-youtube
 *
 * Banner informatif affiché une seule fois sur le Dashboard pour prévenir
 * les utilisateurs Safari que les Content Blockers peuvent bloquer YouTube.
 *
 * Activation : navigator.userAgent matche Safari (pas Chrome/Edge/Firefox)
 *              ET pas déjà dismissé via localStorage `tutti.contentBlockerHintDismissed`.
 *
 * "J'ai vérifié" → setItem flag → banner disparaît + ne réapparaît jamais
 * (sauf clear localStorage).
 *
 * Note : pédagogique, n'EST PAS la détection runtime (cf. ContentBlockerWarning
 * qui s'affiche pendant la partie si onReady ne fire pas en 5s).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const STORAGE_KEY = 'tutti.contentBlockerHintDismissed';

/** Détecte Safari (macOS + iOS), exclut Chrome/Edge/Firefox (qui contiennent
 *  "Safari" dans leur UA legacy). */
function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|FxiOS|CriOS/.test(ua);
}

export function ContentBlockerHintBanner(): JSX.Element | null {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      // localStorage peut throw en mode privé strict — on cache par défaut.
      return true;
    }
  });

  if (dismissed) return null;
  if (!isSafari()) return null;

  const handleDismiss = (): void => {
    try {
      window.localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      /* ignore — banner se cache au moins pour cette session. */
    }
    setDismissed(true);
  };

  return (
    <div
      role="region"
      aria-label={t('onboarding.contentBlocker.title')}
      className="mb-6 border-2 border-ink rounded-lg bg-lemon/30 p-4 shadow-pop-sm"
    >
      <div className="flex items-start gap-3">
        <div className="text-2xl leading-none shrink-0" aria-hidden>
          💡
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display text-base text-ink mb-1">
            {t('onboarding.contentBlocker.title')}
          </p>
          <p className="font-mono text-xs text-ink-soft leading-relaxed">
            {t('onboarding.contentBlocker.body')}
          </p>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={handleDismiss}
          className="px-3 py-1.5 font-mono text-xs uppercase tracking-wider border-2 border-ink rounded bg-cream hover:bg-cream-2 transition-colors"
        >
          {t('onboarding.contentBlocker.checked')}
        </button>
      </div>
    </div>
  );
}
