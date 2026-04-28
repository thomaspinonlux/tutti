/**
 * <OAuthProviders /> — boutons de connexion via providers OAuth.
 *
 * V1 : email/password seul. Aucun provider activé.
 * V2 (commercialisation) : Google OAuth.
 * Apple OAuth : pas prévu (compte Apple Developer 99$/an, dispro pour le test).
 *
 * Pour activer Google plus tard :
 *   1. Activer le provider dans le dashboard Supabase + configurer client_id
 *   2. Ajouter `{ id: 'google', label: 'Google', enabled: true }` à PROVIDERS
 *   3. La logique de redirect OAuth + initialize est déjà en place
 *
 * Architecture : zéro modification du flow auth/initialize côté backend
 * pour ajouter un provider — le hook `useOAuthSignIn` est agnostique.
 */

import type { Provider } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase.js';

interface OAuthProvider {
  id: Provider;
  label: string;
  enabled: boolean;
}

const PROVIDERS: OAuthProvider[] = [
  // À activer en V2 :
  // { id: 'google', label: 'Continuer avec Google', enabled: true },
];

interface Props {
  /** URL où Supabase redirige après l'OAuth callback. */
  redirectTo?: string;
}

export function OAuthProviders({ redirectTo }: Props): JSX.Element | null {
  const enabled = PROVIDERS.filter((p) => p.enabled);
  if (enabled.length === 0) return null;

  const handleOAuth = async (providerId: Provider): Promise<void> => {
    await supabase.auth.signInWithOAuth({
      provider: providerId,
      options: {
        redirectTo: redirectTo ?? `${window.location.origin}/admin`,
      },
    });
  };

  return (
    <div className="space-y-2 mt-4">
      <p className="text-xs font-mono text-ink/60 uppercase tracking-wider text-center">ou avec</p>
      {enabled.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => void handleOAuth(p.id)}
          className="w-full px-4 py-2 border-2 border-ink rounded bg-white hover:bg-cream transition-colors font-medium"
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
