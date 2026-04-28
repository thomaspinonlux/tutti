/**
 * <OAuthProviders /> — boutons de connexion via providers OAuth.
 *
 * V1 : email/password seul. Tous les providers ont `enabled: false`.
 * V2 (commercialisation) : passer Google à `enabled: true` après avoir
 *   activé le provider dans le dashboard Supabase.
 *
 * Apple OAuth : pas dans la liste — compte Apple Developer 99$/an
 *   disproportionné pour le test V1. À ajouter manuellement si pertinent.
 *
 * Architecture : zéro modification du flow auth/initialize côté backend
 * pour activer un provider — il suffit de basculer le booléen `enabled`
 * et de configurer le provider dans Supabase.
 */

import type { Provider } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase.js';

interface OAuthProvider {
  id: Provider;
  label: string;
  /** Si false : non affiché. Pour activer = true + config Supabase dashboard. */
  enabled: boolean;
}

const PROVIDERS: OAuthProvider[] = [
  { id: 'google', label: 'Continuer avec Google', enabled: false },
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
