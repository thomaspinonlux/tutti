import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { api, ApiError } from '../lib/api.js';
import { OAuthProviders } from '../components/auth/OAuthProviders.js';

export function SignupPage(): JSX.Element {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // 1. Création du user Supabase Auth
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });

      if (signUpError) {
        setError(signUpError.message);
        return;
      }
      if (!data.session) {
        // Email confirmation activée côté Supabase : on prévient l'utilisateur
        setError('Confirme ton email pour activer le compte, puis connecte-toi via /auth/login.');
        return;
      }

      // 2. Bootstrap du tenant (workspace + member + establishment)
      await api('/api/auth/initialize', {
        method: 'POST',
        body: { workspaceName: workspaceName.trim() },
      });

      // 3. Redirection vers l'admin
      navigate('/admin', { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      setError(msg ?? 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-8 bg-cream text-ink">
      <div className="w-full max-w-md border-2 border-ink rounded-lg p-8 bg-white shadow-[8px_8px_0_0_#1a1410]">
        <h1 className="text-3xl font-bold mb-1">Créer un compte</h1>
        <p className="text-sm text-ink/60 mb-6 italic">Tutti — démarre ta soirée en 1 minute</p>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <Field
            label="Nom de ton workspace"
            type="text"
            value={workspaceName}
            onChange={setWorkspaceName}
            placeholder="Le Komptoir"
            required
            minLength={2}
          />
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="toi@exemple.com"
            required
          />
          <Field
            label="Mot de passe"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="Au moins 8 caractères"
            required
            minLength={8}
          />

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
            {loading ? 'Création…' : 'Créer mon compte'}
          </button>
        </form>

        <OAuthProviders redirectTo={`${window.location.origin}/admin`} />

        <p className="text-sm text-ink/60 mt-6 text-center">
          Déjà un compte ?{' '}
          <Link to="/auth/login" className="text-spritz hover:underline font-medium">
            Se connecter
          </Link>
        </p>
      </div>
    </main>
  );
}

interface FieldProps {
  label: string;
  type: 'text' | 'email' | 'password';
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
}

function Field({
  label,
  type,
  value,
  onChange,
  placeholder,
  required,
  minLength,
}: FieldProps): JSX.Element {
  return (
    <label className="block">
      <span className="text-xs font-mono uppercase tracking-wider text-ink/70 mb-1 block">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        className="w-full px-3 py-2 border-2 border-ink rounded bg-cream/30 focus:bg-white focus:outline-none focus:ring-2 focus:ring-spritz"
      />
    </label>
  );
}
