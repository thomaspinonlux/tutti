/**
 * /auth/forgot-password — demande d'envoi d'un email de réinitialisation.
 *
 * Utilise supabase.auth.resetPasswordForEmail() qui envoie un magic link.
 * Le user clique sur le lien → arrive sur /auth/reset-password.
 */

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase.js';
import { LanguageSwitch } from '../components/LanguageSwitch.js';
import { Button, Card, Input, MultiColorBar, TitleHandwritten } from '../components/ui/index.js';

export function ForgotPasswordPage(): JSX.Element {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });
      if (err) {
        setError(err.message);
        return;
      }
      setSent(true);
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
            {t('auth.forgotPasswordTitle')}
          </TitleHandwritten>
          <p className="font-editorial italic text-sm text-ink-soft mb-6">
            {t('auth.forgotPasswordTagline')}
          </p>

          {sent ? (
            <Card tone="basil" size="md" className="text-center">
              <p className="font-display text-2xl mb-2">📬</p>
              <p className="font-medium">{t('auth.forgotPasswordSent')}</p>
              <p className="font-editorial italic text-sm text-ink-soft mt-2">
                {t('auth.forgotPasswordSentHint')}
              </p>
            </Card>
          ) : (
            <form onSubmit={(e) => void submit(e)} className="space-y-4">
              <Input
                label={t('auth.email')}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.emailPlaceholder')}
                required
                autoComplete="email"
                error={error ?? undefined}
              />
              <Button type="submit" disabled={loading || !email.trim()} className="w-full">
                {loading ? t('common.saving') : t('auth.forgotPasswordSubmit')}
              </Button>
            </form>
          )}

          <p className="text-sm text-ink-soft mt-6 text-center">
            <Link to="/auth/login" className="underline hover:text-ink">
              ← {t('auth.linkSignIn')}
            </Link>
          </p>
        </Card>
      </div>
    </main>
  );
}
