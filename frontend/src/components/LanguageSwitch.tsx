/**
 * <LanguageSwitch /> — toggle FR / EN, persiste dans localStorage.
 *
 * Affiché en haut à droite des pages publiques + admin.
 * S'étend automatiquement aux nouvelles langues ajoutées dans i18n/index.ts
 * (via SUPPORTED_LOCALES).
 */

import { useTranslation } from 'react-i18next';
import { SUPPORTED_LOCALES, type SupportedLocale } from '../i18n/index.js';

interface Props {
  className?: string;
}

export function LanguageSwitch({ className }: Props): JSX.Element {
  const { i18n, t } = useTranslation();
  const current = (SUPPORTED_LOCALES as readonly string[]).includes(i18n.resolvedLanguage ?? '')
    ? (i18n.resolvedLanguage as SupportedLocale)
    : 'fr';

  const handleChange = (locale: SupportedLocale): void => {
    void i18n.changeLanguage(locale);
  };

  return (
    <div
      className={`inline-flex items-center gap-1 border-2 border-ink rounded bg-white p-0.5 ${className ?? ''}`}
      role="group"
      aria-label={t('language.switchLabel')}
    >
      {SUPPORTED_LOCALES.map((locale) => {
        const isActive = current === locale;
        return (
          <button
            key={locale}
            type="button"
            onClick={() => handleChange(locale)}
            aria-pressed={isActive}
            className={`px-2 py-1 text-xs font-mono uppercase rounded transition-colors ${
              isActive ? 'bg-ink text-cream' : 'text-ink hover:bg-cream'
            }`}
          >
            {locale}
          </button>
        );
      })}
    </div>
  );
}
