import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../stores/auth.js';
import { LanguageSwitch } from '../components/LanguageSwitch.js';

export function HomePage(): JSX.Element {
  const { t } = useTranslation();
  const { session } = useAuthStore();

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 bg-cream text-ink relative">
      <div className="absolute top-4 right-4">
        <LanguageSwitch />
      </div>

      <h1 className="text-6xl font-bold mb-2">{t('common.brand')}</h1>
      <p className="text-lg text-ink/70 mb-8 italic">{t('home.tagline')}</p>

      <div className="flex gap-4">
        {session ? (
          <Link
            to="/admin"
            className="px-6 py-3 bg-spritz text-white border-2 border-ink rounded shadow-[6px_6px_0_0_#1a1410] hover:shadow-[3px_3px_0_0_#1a1410] hover:translate-x-[3px] hover:translate-y-[3px] transition-all font-bold"
          >
            {t('home.goToDashboard')}
          </Link>
        ) : (
          <>
            <Link
              to="/auth/signup"
              className="px-6 py-3 bg-spritz text-white border-2 border-ink rounded shadow-[6px_6px_0_0_#1a1410] hover:shadow-[3px_3px_0_0_#1a1410] hover:translate-x-[3px] hover:translate-y-[3px] transition-all font-bold"
            >
              {t('home.createAccount')}
            </Link>
            <Link
              to="/auth/login"
              className="px-6 py-3 bg-white text-ink border-2 border-ink rounded shadow-[6px_6px_0_0_#1a1410] hover:shadow-[3px_3px_0_0_#1a1410] hover:translate-x-[3px] hover:translate-y-[3px] transition-all font-bold"
            >
              {t('home.signIn')}
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
