/**
 * Nav landing — sticky top: 6px (sous la color-band).
 * - logo wordmark dark à gauche
 * - liens d'ancres + LangSwitch + CTA mini à droite
 * - sub-880px : nav links cachés sauf LangSwitch + CTA
 *
 * IMPORTANT : ce composant doit être frère direct de ColorBand sous le wrapper
 * data-scope="landing" pour préserver le sticky (aucun parent transform/filter
 * /will-change au-dessus).
 */

import { Link } from 'react-router-dom';
import { useLandingI18n } from '../../i18n-landing/LandingI18nContext.js';
import { LangSwitch } from './LangSwitch.js';

export function Nav(): JSX.Element {
  const { t } = useLandingI18n();
  return (
    <nav
      className="sticky z-50 border-b backdrop-blur"
      style={{
        top: '6px',
        backgroundColor: 'rgba(245, 239, 224, 0.92)',
        borderColor: 'rgba(26, 24, 20, 0.08)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      <div className="landing-container flex items-center justify-between py-[14px]">
        <a href="#" className="flex items-center h-11" aria-label={t.nav.home}>
          <img src="/logo-wordmark-dark.svg" alt="Tutti" className="h-full w-auto" />
        </a>
        <div className="flex items-center gap-3 sm:gap-4 md:gap-8">
          <a
            href="#products"
            className="hidden md:inline text-sm font-medium transition-colors hover:[color:var(--landing-rose)]"
            style={{ color: 'var(--landing-ink-soft)' }}
          >
            {t.nav.products}
          </a>
          <a
            href="#how"
            className="hidden md:inline text-sm font-medium transition-colors hover:[color:var(--landing-rose)]"
            style={{ color: 'var(--landing-ink-soft)' }}
          >
            {t.nav.howItWorks}
          </a>
          <a
            href="#pricing"
            className="hidden md:inline text-sm font-medium transition-colors hover:[color:var(--landing-rose)]"
            style={{ color: 'var(--landing-ink-soft)' }}
          >
            {t.nav.pricing}
          </a>
          <a
            href="#faq"
            className="hidden md:inline text-sm font-medium transition-colors hover:[color:var(--landing-rose)]"
            style={{ color: 'var(--landing-ink-soft)' }}
          >
            {t.nav.faq}
          </a>
          <LangSwitch />
          <Link to="/auth/login" className="landing-cta-mini">
            {t.nav.signin}
          </Link>
        </div>
      </div>
    </nav>
  );
}
