/**
 * Store Zustand pour l'auth/session courante.
 *
 * Source de vérité : Supabase client (qui persiste en localStorage).
 * Ce store mirror l'état Supabase pour permettre les re-renders React.
 *
 * Le hook `useAuthInit` (à appeler une fois dans App.tsx) écoute les
 * changements via `supabase.auth.onAuthStateChange` et met à jour le store.
 */

import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  setSession: (session: Session | null) => void;
  setLoading: (loading: boolean) => void;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  loading: true,
  setSession: (session) =>
    set({
      session,
      user: session?.user ?? null,
    }),
  setLoading: (loading) => set({ loading }),
  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null });
  },
}));

/**
 * À appeler une fois au démarrage (dans App.tsx).
 * Initialise le store avec la session existante (si stockée en localStorage)
 * et écoute les changements d'auth.
 *
 * fix/prod-bugs-csp-covers-voice-auth — robust contre les refresh tokens
 * invalides (expirés / révoqués / format changé après hotfix Supabase).
 * Avant le fix, l'erreur "AuthApiError: Invalid Refresh Token: Refresh
 * Token Not Found" s'affichait en boucle dans la console au boot car
 * `getSession()` rejette quand le refresh échoue. On catch, on signOut
 * pour vider localStorage proprement, et on continue en non-authentifié.
 */
export function initAuth(): () => void {
  const { setSession, setLoading } = useAuthStore.getState();

  // Bootstrap: lire la session courante avec gestion gracieuse des tokens invalides.
  void supabase.auth
    .getSession()
    .then(({ data, error }) => {
      if (error) {
        const msg = error.message || '';
        // Reset propre si refresh token expiré/invalide. signOut() vire le
        // localStorage Supabase et évite que la prochaine getSession()
        // retombe sur le même token cassé.
        if (msg.includes('Refresh Token') || msg.includes('refresh_token')) {
          console.info('[Auth] Stale refresh token detected — clearing and continuing anonymous');
          void supabase.auth.signOut().catch(() => {
            /* ignore signOut errors when there's nothing to sign out */
          });
          setSession(null);
        } else {
          console.warn('[Auth] getSession error:', msg);
          setSession(data?.session ?? null);
        }
      } else {
        setSession(data.session);
      }
      setLoading(false);
    })
    .catch((err: unknown) => {
      // Filet de sécurité pour les erreurs hors-protocole (réseau down).
      console.warn('[Auth] getSession threw:', err instanceof Error ? err.message : String(err));
      setSession(null);
      setLoading(false);
    });

  // Écoute des changements (login, logout, refresh token)
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'TOKEN_REFRESHED' && !session) {
      console.info('[Auth] TOKEN_REFRESHED with null session — refresh likely failed');
    }
    setSession(session);
    setLoading(false);
  });

  return () => data.subscription.unsubscribe();
}
