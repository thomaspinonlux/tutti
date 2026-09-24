/**
 * PricingSection — fond ink, 3 colonnes tarifaires + note bas.
 */

import { useLandingI18n } from '../../i18n-landing/LandingI18nContext.js';
import { HighlightYellow } from './HighlightYellow.js';
import { PricingColumn } from './PricingColumn.js';

export function PricingSection(): JSX.Element {
  const { t } = useLandingI18n();
  return (
    <section
      id="pricing"
      className="py-[70px] sm:py-[100px]"
      style={{ background: 'var(--landing-ink)', color: 'var(--landing-cream)' }}
      aria-labelledby="pricing-title"
    >
      <div className="landing-container">
        <span className="landing-eyebrow" style={{ color: 'var(--landing-yellow)' }}>
          {t.pricing.eyebrow}
        </span>
        <h2
          id="pricing-title"
          className="landing-section-title"
          style={{ color: 'var(--landing-cream)' }}
        >
          {t.pricing.titleStart}
          <HighlightYellow>{t.pricing.titleEm}</HighlightYellow>
          {t.pricing.titleEnd}
        </h2>
        <p className="landing-section-intro" style={{ color: 'rgba(245, 239, 224, 0.7)' }}>
          {t.pricing.intro}
        </p>

        {/* feat/offre-de-lancement — la remise se voit avant les prix. */}
        {t.pricing.offer && (
          <div className="flex flex-col items-center gap-2 mb-8 text-center">
            <span
              className="inline-block rounded-full px-4 py-1"
              style={{
                background: 'var(--landing-yellow)',
                color: 'var(--landing-ink)',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '12px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              {t.pricing.offer.badge}
            </span>
            <p style={{ fontSize: '14px', opacity: 0.75, maxWidth: '560px' }}>
              {t.pricing.offer.text}
            </p>
          </div>
        )}

        <div
          className={`grid gap-5 mb-14 ${
            t.pricing.columns.length === 2 ? 'md:grid-cols-2 max-w-3xl mx-auto' : 'md:grid-cols-3'
          }`}
        >
          {t.pricing.columns.map((col, idx) => (
            <PricingColumn
              key={col.name}
              name={col.name}
              tag={col.tag}
              rows={col.rows}
              highlighted={col.highlighted}
              bestDealLabel={t.pricing.bestDeal}
              delay={idx * 0.1}
            />
          ))}
        </div>

        <p
          className="mx-auto text-center"
          style={{
            fontSize: '13px',
            opacity: 0.6,
            maxWidth: '720px',
            lineHeight: 1.6,
          }}
          dangerouslySetInnerHTML={{ __html: t.pricing.note }}
        />
      </div>
    </section>
  );
}
