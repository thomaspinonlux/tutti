/**
 * Types de base partagés entre frontend et backend.
 * Étendus au fil des étapes du plan de dev.
 */

// ───── API health-check (étape 1) ─────────────────────────────────────────

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  uptime: number;
  version: string;
}

// ───── Locale ─────────────────────────────────────────────────────────────

export type Locale = 'fr' | 'en';

export const SUPPORTED_LOCALES = ['fr', 'en'] as const;
export const DEFAULT_LOCALE: Locale = 'fr';

// ───── Erreur API standardisée ────────────────────────────────────────────

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}
