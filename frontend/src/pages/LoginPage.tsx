import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase.js';
import { OAuthProviders } from '../components/auth/OAuthProviders.js';
import { LanguageSwitch } from '../components/LanguageSwitch.js';
import { Button, Card, Input, MultiColorBar, TitleHandwritten } from '../components/ui/index.js';

export function LoginPage(): JSX.Element {
  const { t } = useTranslation();
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
            ? t('auth.invalidCredentials')
            : signInError.message,
        );
        return;
      }

      navigate('/admin', { replace: true });
    } catch (err: unknown) {
      setError((err as Error).message ?? t('auth.unknownError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col">
      <MultiColorBar height="md" />

      <div className="flex-1 flex items-center justify-center p-8 relative">
        <div className="absolute top-6 right-6">
          <LanguageSwitch />
        </div>

        <Card size="lg" className="w-full max-w-md">
          <TitleHandwritten as="h2" className="mb-1">
            {t('auth.loginTitle')}
          </TitleHandwritten>
          <p className="font-editorial italic text-sm text-ink-soft mb-6">
            {t('auth.loginTagline')}
          </p>

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <Input
              label={t('auth.email')}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('auth.emailPlaceholder')}
              required
              autoComplete="email"
            />
            <Input
              label={t('auth.password')}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              error={error ?? undefined}
            />

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? t('auth.loginSubmitting') : t('auth.loginSubmit')}
            </Button>
          </form>

          <OAuthProviders redirectTo={`${window.location.origin}/admin`} />

          <p className="text-sm text-ink-soft mt-6 text-center">
            {t('auth.noAccount')}{' '}
            <Link to="/auth/signup" className="text-spritz-deep hover:underline font-medium">
              {t('auth.linkSignUp')}
            </Link>
          </p>
          <p className="text-xs text-ink-soft mt-2 text-center">
            <Link to="/auth/forgot-password" className="hover:underline">
              {t('auth.forgotPasswordLink')}
            </Link>
          </p>
        </Card>
      </div>

      <MultiColorBar height="md" />
    </main>
  );
}
