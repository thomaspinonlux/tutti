import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase.js';
import { api, ApiError } from '../lib/api.js';
import { OAuthProviders } from '../components/auth/OAuthProviders.js';
import { LanguageSwitch } from '../components/LanguageSwitch.js';
import { Button, Card, Input, MultiColorBar, TitleHandwritten } from '../components/ui/index.js';

export function SignupPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const referrerCode = (params.get('ref') ?? '').trim().toUpperCase();
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
        body: {
          workspaceName: referrerCode ? 'invited' : workspaceName.trim(),
          ...(referrerCode ? { referrerCode } : {}),
        },
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
    <main className="min-h-screen flex flex-col">
      <MultiColorBar height="md" />

      <div className="flex-1 flex items-center justify-center p-8 relative">
        <div className="absolute top-6 right-6">
          <LanguageSwitch />
        </div>

        <Card size="lg" className="w-full max-w-md">
          <TitleHandwritten as="h2" className="mb-1">
            {t('auth.signupTitle')}
          </TitleHandwritten>
          <p className="font-editorial italic text-sm text-ink-soft mb-6">
            {t('auth.signupTagline')}
          </p>

          {referrerCode && (
            <div className="mb-4 p-3 border-2 border-basil rounded bg-basil/10 text-sm">
              <p className="font-display text-lg">🎉 {t('auth.invitedTitle')}</p>
              <p className="font-mono text-xs text-ink-soft mt-1">
                {t('auth.invitedHint', { code: referrerCode })}
              </p>
            </div>
          )}

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            {!referrerCode && (
              <Input
                label={t('auth.workspaceName')}
                type="text"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder={t('auth.workspaceNamePlaceholder')}
                required
                minLength={2}
                autoComplete="organization"
              />
            )}
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
              placeholder={t('auth.passwordPlaceholder')}
              required
              minLength={8}
              autoComplete="new-password"
              error={error ?? undefined}
            />

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? t('auth.signupSubmitting') : t('auth.signupSubmit')}
            </Button>
          </form>

          <OAuthProviders redirectTo={`${window.location.origin}/admin`} />

          <p className="text-sm text-ink-soft mt-6 text-center">
            {t('auth.haveAccount')}{' '}
            <Link to="/auth/login" className="text-spritz-deep hover:underline font-medium">
              {t('auth.linkSignIn')}
            </Link>
          </p>
        </Card>
      </div>

      <MultiColorBar height="md" />
    </main>
  );
}
