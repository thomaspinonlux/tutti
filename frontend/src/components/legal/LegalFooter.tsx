/**
 * <LegalFooter /> — feat/youtube-compliance
 *
 * Footer minimaliste pour l'espace admin (AdminLayout) + pages auth.
 * Affiche : © Kleos Sàrl + liens Privacy + Terms (FR/EN selon i18n).
 *
 * Le landing a son propre Footer riche (cf. components/landing/Footer.tsx)
 * — celui-ci est intentionnellement léger pour ne pas distraire dans le
 * dashboard. Conformité YouTube API Services : les liens légaux doivent
 * être présents sur toutes les pages.
 */

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function LegalFooter(): JSX.Element {
  const { i18n } = useTranslation();
  const isFr = i18n.language?.startsWith('fr') ?? true;
  return (
    <footer className="border-t border-ink/10 bg-cream-2/30 mt-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-10 py-4 flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-ink-soft">
        <span>© 2026 Kleos Sàrl — Luxembourg</span>
        <nav className="flex items-center gap-4">
          <Link to="/privacy" className="hover:text-ink hover:underline">
            {isFr ? 'Politique de confidentialité' : 'Privacy Policy'}
          </Link>
          <Link to="/terms" className="hover:text-ink hover:underline">
            {isFr ? "Conditions d'utilisation" : 'Terms of Service'}
          </Link>
          <a
            href="mailto:contact@tuttiparty.app"
            className="hover:text-ink hover:underline hidden sm:inline"
          >
            contact@tuttiparty.app
          </a>
        </nav>
      </div>
    </footer>
  );
}
