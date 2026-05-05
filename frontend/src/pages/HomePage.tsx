/**
 * Tutti — Landing publique v2.
 *
 * - Si user authentifié : redirect immédiat vers /admin/dashboard
 * - Sinon : rendu landing complète (Hero, Products, How, Features, Pricing,
 *   UseCases, FAQ, Cta, Footer) avec i18n maison FR/EN
 *
 * IMPORTANT structure DOM :
 *   <div data-scope="landing"> ← variables CSS scopées (cf landing.css)
 *     <ColorBand />              ← position: fixed
 *     <Nav />                    ← position: sticky top: 6px
 *     <main>...</main>
 *     <Footer />
 *   </div>
 *
 * ColorBand et Nav sont frères directs sous data-scope="landing". Aucun parent
 * (App.tsx, BrowserRouter, Routes) n'applique transform/filter/will-change qui
 * casserait le sticky/fixed. Vérifié.
 */

import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.js';
import { LandingI18nProvider } from '../i18n-landing/LandingI18nContext.js';
import { ColorBand } from '../components/landing/ColorBand.js';
import { Nav } from '../components/landing/Nav.js';
import { Hero } from '../components/landing/Hero.js';
import { ProductsSection } from '../components/landing/ProductsSection.js';
import { HowItWorks } from '../components/landing/HowItWorks.js';
import { FeaturesGrid } from '../components/landing/FeaturesGrid.js';
import { PricingSection } from '../components/landing/PricingSection.js';
import { UseCasesSection } from '../components/landing/UseCasesSection.js';
import { FAQ } from '../components/landing/FAQ.js';
import { CtaSection } from '../components/landing/CtaSection.js';
import { Footer } from '../components/landing/Footer.js';

export function HomePage(): JSX.Element {
  const { session } = useAuthStore();
  if (session) {
    return <Navigate to="/admin/dashboard" replace />;
  }
  return (
    <LandingI18nProvider>
      <div data-scope="landing" className="min-h-screen">
        <ColorBand />
        <Nav />
        <main>
          <Hero />
          <ProductsSection />
          <HowItWorks />
          <FeaturesGrid />
          <PricingSection />
          <UseCasesSection />
          <FAQ />
          <CtaSection />
        </main>
        <Footer />
      </div>
    </LandingI18nProvider>
  );
}
