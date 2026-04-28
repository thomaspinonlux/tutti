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
 */
export function initAuth(): () => void {
  const { setSession, setLoading } = useAuthStore.getState();

  // Bootstrap: lire la session courante
  void supabase.auth.getSession().then(({ data }) => {
    setSession(data.session);
    setLoading(false);
  });

  // Écoute des changements (login, logout, refresh token)
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    setSession(session);
    setLoading(false);
  });

  return () => data.subscription.unsubscribe();
}
