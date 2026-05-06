/**
 * Section "Deux produits, une plateforme" — 2 ProductCard côte-à-côte.
 * Stagger : tracks à gauche (delay 0), quizz à droite (delay 0.15s).
 */

import { useLandingI18n } from '../../i18n-landing/LandingI18nContext.js';
import { HighlightYellow } from './HighlightYellow.js';
import { ProductCard } from './ProductCard.js';

export function ProductsSection(): JSX.Element {
  const { t } = useLandingI18n();
  return (
    <section
      id="products"
      className="py-[70px] sm:py-[100px]"
      style={{
        background:
          'linear-gradient(180deg, var(--landing-cream) 0%, var(--landing-cream-deep) 100%)',
      }}
      aria-labelledby="products-title"
    >
      <div className="landing-container">
        <span className="landing-eyebrow">{t.products.eyebrow}</span>
        <h2 id="products-title" className="landing-section-title">
          {t.products.titleStart}
          <HighlightYellow>{t.products.titleEm}</HighlightYellow>
          {t.products.titleEnd}
        </h2>
        <p className="landing-section-intro">{t.products.intro}</p>

        <div className="grid gap-5 md:gap-7 md:grid-cols-2">
          <ProductCard
            variant="tracks"
            tag={t.products.tracks.tag}
            nameStart={t.products.tracks.nameStart}
            nameEm={t.products.tracks.nameEm}
            desc={t.products.tracks.desc}
            features={t.products.tracks.features}
            cta={t.products.tracks.cta}
            ctaHref="/auth/login?product=tracks"
            delay={0}
          />
          <ProductCard
            variant="quizz"
            tag={t.products.quizz.tag}
            nameStart={t.products.quizz.nameStart}
            nameEm={t.products.quizz.nameEm}
            desc={t.products.quizz.desc}
            features={t.products.quizz.features}
            cta={t.products.quizz.cta}
            ctaHref="/auth/login?product=quizz"
            delay={0.15}
          />
        </div>
      </div>
    </section>
  );
}
