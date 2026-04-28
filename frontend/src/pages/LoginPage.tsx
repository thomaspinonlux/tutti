import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { OAuthProviders } from '../components/auth/OAuthProviders.js';

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(
          signInError.message === 'Invalid login credentials'
            ? 'Email ou mot de passe incorrect'
            : signInError.message,
        );
        return;
      }

      navigate('/admin', { replace: true });
    } catch (err: unknown) {
      setError((err as Error).message ?? 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-8 bg-cream text-ink">
      <div className="w-full max-w-md border-2 border-ink rounded-lg p-8 bg-white shadow-[8px_8px_0_0_#1a1410]">
        <h1 className="text-3xl font-bold mb-1">Connexion</h1>
        <p className="text-sm text-ink/60 mb-6 italic">Bon retour parmi nous</p>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <label className="block">
            <span className="text-xs font-mono uppercase tracking-wider text-ink/70 mb-1 block">
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="toi@exemple.com"
              required
              className="w-full px-3 py-2 border-2 border-ink rounded bg-cream/30 focus:bg-white focus:outline-none focus:ring-2 focus:ring-spritz"
            />
          </label>

          <label className="block">
            <span className="text-xs font-mono uppercase tracking-wider text-ink/70 mb-1 block">
              Mot de passe
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 border-2 border-ink rounded bg-cream/30 focus:bg-white focus:outline-none focus:ring-2 focus:ring-spritz"
            />
          </label>

          {error && (
            <p
              role="alert"
              className="text-sm text-raspberry border-l-2 border-raspberry pl-3 py-1 bg-raspberry/5"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-3 bg-spritz text-white border-2 border-ink rounded shadow-[4px_4px_0_0_#1a1410] hover:shadow-[2px_2px_0_0_#1a1410] hover:translate-x-[2px] hover:translate-y-[2px] transition-all font-bold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>

        <OAuthProviders redirectTo={`${window.location.origin}/admin`} />

        <p className="text-sm text-ink/60 mt-6 text-center">
          Pas encore de compte ?{' '}
          <Link to="/auth/signup" className="text-spritz hover:underline font-medium">
            Créer un compte
          </Link>
        </p>
      </div>
    </main>
  );
}
