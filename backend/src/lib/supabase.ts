/**
 * Client Supabase côté backend (service role).
 *
 * Le service role bypass RLS — à utiliser uniquement pour des opérations
 * authentifiées côté serveur (création de users, init de workspace, etc.).
 *
 * Pour valider un JWT utilisateur, on utilise `supabaseAdmin.auth.getUser(token)`.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    '[supabase] SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis (cf .env.example)',
  );
}

export const supabaseAdmin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
