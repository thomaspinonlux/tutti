import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase.js';
import { api, ApiError } from '../lib/api.js';
import { OAuthProviders } from '../components/auth/OAuthProviders.js';
import { LanguageSwitch } from '../components/LanguageSwitch.js';

export function SignupPage(): JSX.Element {
  const { t } = useTranslation();
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
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });

      if (signUpError) {
        setError(signUpError.message);
        return;
      }
      if (!data.session) {
        setError(t('auth.confirmEmailNotice'));
        return;
      }

      await api('/api/auth/initialize', {
        method: 'POST',
        body: { workspaceName: workspaceName.trim() },
      });

      navigate('/admin', { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      setError(msg ?? t('auth.unknownError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-8 bg-cream text-ink relative">
      <div className="absolute top-4 right-4">
        <LanguageSwitch />
      </div>

      <div className="w-full max-w-md border-2 border-ink rounded-lg p-8 bg-white shadow-[8px_8px_0_0_#1a1410]">
        <h1 className="text-3xl font-bold mb-1">{t('auth.signupTitle')}</h1>
        <p className="text-sm text-ink/60 mb-6 italic">{t('auth.signupTagline')}</p>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <Field
            label={t('auth.workspaceName')}
            type="text"
            value={workspaceName}
            onChange={setWorkspaceName}
            placeholder={t('auth.workspaceNamePlaceholder')}
            required
            minLength={2}
          />
          <Field
            label={t('auth.email')}
            type="email"
            value={email}
            onChange={setEmail}
            placeholder={t('auth.emailPlaceholder')}
            required
          />
          <Field
            label={t('auth.password')}
            type="password"
            value={password}
            onChange={setPassword}
            placeholder={t('auth.passwordPlaceholder')}
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
            {loading ? t('auth.signupSubmitting') : t('auth.signupSubmit')}
          </button>
        </form>

        <OAuthProviders redirectTo={`${window.location.origin}/admin`} />

        <p className="text-sm text-ink/60 mt-6 text-center">
          {t('auth.haveAccount')}{' '}
          <Link to="/auth/login" className="text-spritz hover:underline font-medium">
            {t('auth.linkSignIn')}
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
