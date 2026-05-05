/**
 * Tutti — Landing v2 i18n Context (système maison léger)
 *
 * Init lang :
 *   1. ?lang=fr|en (URL searchParam)
 *   2. localStorage `tutti-landing-lang`
 *   3. navigator.language startsWith 'fr' → fr, sinon en
 *
 * setLang() : update state + localStorage + URL searchParam (sans reload, via
 * history.replaceState).
 *
 * Pas couplé à react-i18next (qui sert l'app admin/host/play). Volontairement
 * isolé pour ne pas polluer locales/fr.json existant.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { translations, type LandingLang, type LandingTranslations } from './translations.js';

const STORAGE_KEY = 'tutti-landing-lang';

interface LandingI18nContextValue {
  lang: LandingLang;
  setLang: (lang: LandingLang) => void;
  t: LandingTranslations;
}

const Context = createContext<LandingI18nContextValue | null>(null);

function detectInitialLang(): LandingLang {
  if (typeof window === 'undefined') return 'fr';
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('lang');
  if (fromUrl === 'fr' || fromUrl === 'en') return fromUrl;
  const fromStorage = window.localStorage.getItem(STORAGE_KEY);
  if (fromStorage === 'fr' || fromStorage === 'en') return fromStorage;
  const navLang = window.navigator.language?.toLowerCase() ?? '';
  return navLang.startsWith('fr') ? 'fr' : 'en';
}

export function LandingI18nProvider({ children }: { children: ReactNode }): JSX.Element {
  const [lang, setLangState] = useState<LandingLang>(() => detectInitialLang());

  // Update <html lang> dès que la langue change pour SEO + a11y screenreader
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
    }
  }, [lang]);

  const setLang = useCallback((next: LandingLang) => {
    setLangState(next);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* storage indispo (private mode) */
      }
      // Update URL searchParam sans reload
      const url = new URL(window.location.href);
      if (next === 'fr') {
        url.searchParams.delete('lang'); // FR par défaut → URL propre
      } else {
        url.searchParams.set('lang', next);
      }
      window.history.replaceState(window.history.state, '', url.toString());
    }
  }, []);

  const value = useMemo<LandingI18nContextValue>(
    () => ({
      lang,
      setLang,
      t: translations[lang],
    }),
    [lang, setLang],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLandingI18n(): LandingI18nContextValue {
  const ctx = useContext(Context);
  if (!ctx) {
    throw new Error('useLandingI18n must be used within LandingI18nProvider');
  }
  return ctx;
}
