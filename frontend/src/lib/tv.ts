/**
 * lib/tv.ts — feat/tv-join-code-multidevice
 *
 * Résolution du code de salon "Écran TV" côté client (2e device).
 */

import { api } from './api.js';

export interface TvResolveResult {
  workspace_id: string;
  join_code: string;
  session_name: string | null;
}

/** Alphabet non ambigu (miroir backend lib/tvCode.ts). */
const TV_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Normalise une saisie : uppercase + retire les chars hors alphabet. */
export function normalizeTvCode(input: string): string {
  return input
    .toUpperCase()
    .split('')
    .filter((c) => TV_ALPHABET.includes(c))
    .join('')
    .slice(0, 5);
}

/** Résout un code → workspace + join_code. Throw si code mort (404). */
export async function resolveTvCode(code: string): Promise<TvResolveResult> {
  return api<TvResolveResult>(`/api/tv/${encodeURIComponent(code)}`);
}
