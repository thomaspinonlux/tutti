import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../stores/auth.js';
import { LanguageSwitch } from '../components/LanguageSwitch.js';
import { Button, MultiColorBar, TitleHandwritten, Underline } from '../components/ui/index.js';

export function HomePage(): JSX.Element {
  const { t } = useTranslation();
  const { session } = useAuthStore();

  return (
    <main className="min-h-screen flex flex-col">
      <MultiColorBar height="md" />

      <div className="flex-1 flex flex-col items-center justify-center p-8 relative">
        <div className="absolute top-6 right-6">
          <LanguageSwitch />
        </div>

        <TitleHandwritten as="h1" className="mb-4 text-center">
          <Underline>{t('common.brand')}</Underline>
        </TitleHandwritten>
        <p className="font-editorial italic text-lg text-ink-2 mb-10 max-w-md text-center">
          {t('home.tagline')}
        </p>

        <div className="flex flex-wrap gap-4 justify-center">
          {session ? (
            <Link to="/admin">
              <Button variant="primary" size="lg">
                {t('home.goToDashboard')}
              </Button>
            </Link>
          ) : (
            <>
              <Link to="/auth/signup">
                <Button variant="primary" size="lg">
                  {t('home.createAccount')}
                </Button>
              </Link>
              <Link to="/auth/login">
                <Button variant="secondary" size="lg">
                  {t('home.signIn')}
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>

      <MultiColorBar height="md" />
    </main>
  );
}
