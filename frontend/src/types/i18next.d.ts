/**
 * Augmente i18next pour la typage strict des clés de traduction.
 * `t('home.tagline')` est typé en autocomplétion ; faute de frappe = erreur TS.
 */

import 'i18next';
import type fr from '../locales/fr.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: typeof fr;
    };
  }
}
