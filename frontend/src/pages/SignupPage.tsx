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
  // feat/signup-firstname-lastname — remplace workspaceName par identité user.
  // Le workspace est auto-généré côté backend ("Workspace de Prénom Nom").
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // feat/youtube-compliance — checkbox required (CGU + Privacy + YouTube ToS).
  // Le bouton submit est disabled tant que false. Backend stocke timestamp.
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const fn = firstName.trim();
      const ln = lastName.trim();
      // Supabase user_metadata est la source unique d'identité user (pas de
      // model User Prisma dans Tutti). Stocké en raw_user_meta_data DB, lu
      // côté backend via supabaseAdmin.auth.admin.getUserById().
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            first_name: fn,
            last_name: ln,
            // full_name = convention Supabase reconnue par les OAuth providers
            // (Google/Microsoft set ce champ aussi) → cohérence cross-provider.
            full_name: `${fn} ${ln}`.trim(),
          },
        },
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
          first_name: fn,
          last_name: ln,
          acceptedTerms: true, // checkbox required côté UI, true ici
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label={t('auth.firstName')}
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder={t('auth.firstNamePlaceholder')}
                required
                minLength={1}
                maxLength={60}
                autoComplete="given-name"
              />
              <Input
                label={t('auth.lastName')}
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder={t('auth.lastNamePlaceholder')}
                required
                minLength={1}
                maxLength={60}
                autoComplete="family-name"
              />
            </div>
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

            {/* feat/youtube-compliance — checkbox d'acceptation CGU + Privacy
                + YouTube ToS. Required, bouton submit disabled si non cochée. */}
            <label className="flex items-start gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                required
                className="mt-1 shrink-0 w-4 h-4 accent-spritz-deep"
              />
              <span
                className="leading-snug text-ink-2"
                // i18n inline (texte avec liens JSX = pas adapté à t() trad
                // dict simple). Trans component i18next aurait été plus
                // robuste, mais ce string est trop court pour le justifier.
              >
                {t('auth.termsLabelPrefix')}{' '}
                <Link to="/terms" className="text-spritz-deep hover:underline" target="_blank">
                  {t('auth.termsLink')}
                </Link>{' '}
                {t('auth.termsAnd')}{' '}
                <Link to="/privacy" className="text-spritz-deep hover:underline" target="_blank">
                  {t('auth.privacyLink')}
                </Link>
                . {t('auth.termsYouTubeSuffix')}{' '}
                <a
                  href="https://www.youtube.com/t/terms"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-spritz-deep hover:underline"
                >
                  {t('auth.termsYouTubeLink')}
                </a>
                .
              </span>
            </label>

            <Button type="submit" disabled={loading || !acceptedTerms} className="w-full">
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
