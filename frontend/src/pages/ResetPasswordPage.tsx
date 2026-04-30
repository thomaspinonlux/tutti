/**
 * /auth/reset-password — landing après clic sur magic link de récupération.
 *
 * Supabase auto-établit la session lors du clic sur le lien (recovery flow).
 * On affiche un form pour saisir le nouveau mot de passe → updateUser.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase.js';
import { LanguageSwitch } from '../components/LanguageSwitch.js';
import { Button, Card, Input, MultiColorBar, TitleHandwritten } from '../components/ui/index.js';

export function ResetPasswordPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  // Vérifie la session active (Supabase récupère le token depuis l'URL hash)
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
    });
  }, []);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (password.length < 8) {
      setError(t('auth.passwordTooShort'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) {
        setError(err.message);
        return;
      }
      setDone(true);
      window.setTimeout(() => navigate('/admin', { replace: true }), 1500);
    } catch (err: unknown) {
      setError((err as Error).message);
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
            {t('auth.resetPasswordTitle')}
          </TitleHandwritten>
          <p className="font-editorial italic text-sm text-ink-soft mb-6">
            {t('auth.resetPasswordTagline')}
          </p>

          {hasSession === false && (
            <Card tone="cream" size="md" className="mb-4">
              <p className="text-sm">{t('auth.resetSessionMissing')}</p>
              <Link
                to="/auth/forgot-password"
                className="text-sm underline mt-2 inline-block hover:text-ink"
              >
                {t('auth.requestNewLink')}
              </Link>
            </Card>
          )}

          {done ? (
            <Card tone="basil" size="md" className="text-center">
              <p className="font-display text-2xl mb-1">✓</p>
              <p className="font-medium">{t('auth.resetPasswordDone')}</p>
            </Card>
          ) : (
            <form onSubmit={(e) => void submit(e)} className="space-y-4">
              <Input
                label={t('auth.newPassword')}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth.passwordPlaceholder')}
                required
                minLength={8}
                autoComplete="new-password"
                disabled={hasSession === false}
              />
              <Input
                label={t('auth.confirmPassword')}
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('auth.passwordPlaceholder')}
                required
                minLength={8}
                autoComplete="new-password"
                disabled={hasSession === false}
                error={error ?? undefined}
              />
              <Button
                type="submit"
                disabled={loading || hasSession === false || !password || !confirmPassword}
                className="w-full"
              >
                {loading ? t('common.saving') : t('auth.resetPasswordSubmit')}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </main>
  );
}
