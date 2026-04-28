/**
 * Configuration i18next pour Tutti.
 *
 * Langues V1 : FR (défaut) + EN.
 * Pour ajouter une langue : déposer un fichier locales/<code>.json,
 * l'importer ici dans `resources` et l'ajouter à `SUPPORTED_LOCALES`.
 *
 * Détection au boot :
 *   1. localStorage `i18nextLng` (préférence utilisateur explicite)
 *   2. Langue du navigateur (navigator.language)
 *   3. Fallback sur 'fr'
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import fr from '../locales/fr.json';
import en from '../locales/en.json';

export const SUPPORTED_LOCALES = ['fr', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      fr: { translation: fr },
      en: { translation: en },
    },
    fallbackLng: 'fr',
    supportedLngs: SUPPORTED_LOCALES,
    interpolation: {
      escapeValue: false, // React échappe déjà
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
  });

export default i18n;
