/**
 * FeaturesGrid — 6 features en grille 3×2 (ou 2×3 / 1col selon viewport).
 * Stagger en cascade au whileInView.
 */

import { motion } from 'framer-motion';
import { useLandingI18n } from '../../i18n-landing/LandingI18nContext.js';
import { HighlightYellow } from './HighlightYellow.js';

export function FeaturesGrid(): JSX.Element {
  const { t } = useLandingI18n();
  return (
    <section
      id="features"
      className="py-[70px] sm:py-[100px]"
      style={{ background: 'var(--landing-cream-deep)' }}
      aria-labelledby="features-title"
    >
      <div className="landing-container">
        <span className="landing-eyebrow">{t.features.eyebrow}</span>
        <h2 id="features-title" className="landing-section-title">
          {t.features.titleStart}
          <HighlightYellow>{t.features.titleEm}</HighlightYellow>
          {t.features.titleEnd}
        </h2>

        <div className="grid gap-[22px] mt-4 sm:grid-cols-2 lg:grid-cols-3">
          {t.features.items.map((item, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.45, delay: idx * 0.06, ease: 'easeOut' }}
              className="rounded-[14px] p-7 sm:p-[26px] transition-all hover:-translate-y-[2px]"
              style={{
                background: 'var(--landing-cream-deep)',
                border: '1px solid rgba(26, 24, 20, 0.1)',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--landing-ink)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(26, 24, 20, 0.1)';
              }}
            >
              <span
                className="mb-3 block"
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '11px',
                  fontWeight: 500,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--landing-rose)',
                }}
              >
                {item.tag}
              </span>
              <h4
                className="mb-3"
                style={{
                  fontFamily: "'Fraunces', serif",
                  fontSize: '21px',
                  fontWeight: 700,
                  letterSpacing: '-0.01em',
                  lineHeight: 1.2,
                }}
              >
                {item.title}
              </h4>
              <p
                style={{
                  color: 'var(--landing-ink-soft)',
                  fontSize: '15px',
                  lineHeight: 1.55,
                }}
              >
                {item.desc}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
