/**
 * Helper i18n côté backend.
 *
 * Utilisé pour les messages d'erreur API et (futur) les emails transactionnels.
 * La langue est résolue via le header `Accept-Language` (V2+) ou défaut FR.
 *
 * Usage :
 *   import { t } from '../lib/i18n.js';
 *   res.status(401).json({ error: { code: 'X', message: t('errors.unauthorized_missing_token', req) } });
 */

import type { Request } from 'express';
import fr from '../locales/fr.json' with { type: 'json' };
import en from '../locales/en.json' with { type: 'json' };

const RESOURCES = { fr, en } as const;
type SupportedLocale = keyof typeof RESOURCES;
const DEFAULT_LOCALE: SupportedLocale = 'fr';

export function detectLocale(req?: Request): SupportedLocale {
  const accept = req?.headers['accept-language'];
  if (typeof accept !== 'string') return DEFAULT_LOCALE;
  // Match basique : prend la première langue listée qu'on supporte.
  const candidates = accept
    .split(',')
    .map((part) => part.split(';')[0]?.trim().toLowerCase().split('-')[0] ?? '');
  for (const c of candidates) {
    if (c in RESOURCES) return c as SupportedLocale;
  }
  return DEFAULT_LOCALE;
}

/**
 * Récupère une string de traduction par clé pointée (ex: 'errors.not_found').
 * Si la clé n'existe pas, retourne la clé elle-même (failsafe).
 */
export function t(key: string, req?: Request): string {
  const locale = detectLocale(req);
  const dict = RESOURCES[locale];
  return resolveKey(dict, key) ?? resolveKey(RESOURCES[DEFAULT_LOCALE], key) ?? key;
}

function resolveKey(obj: unknown, key: string): string | null {
  const parts = key.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (typeof cur !== 'object' || cur === null) return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'string' ? cur : null;
}
