/**
 * Client Supabase côté frontend (anon key).
 *
 * - Sessions persistées dans localStorage (par défaut)
 * - Auto-refresh des access tokens
 * - Utilisé directement pour signUp / signInWithPassword / signInWithOAuth
 *
 * Pour les appels API métier vers notre backend, utiliser `lib/api.ts` qui
 * inclut automatiquement le JWT dans le header Authorization.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // En dev, on warn plutôt que crash, pour permettre les pages publiques.
  // eslint-disable-next-line no-console
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY non définies — auth indisponible',
  );
}

export const supabase: SupabaseClient = createClient(SUPABASE_URL ?? '', SUPABASE_ANON_KEY ?? '', {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
