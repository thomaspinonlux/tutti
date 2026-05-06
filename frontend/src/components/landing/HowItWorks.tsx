/**
 * HowItWorks — 3 steps (icon + numéro + titre + desc).
 * Step icon background couleur différente par étape (orange / rose / blue).
 * Stagger horizontal au whileInView.
 */

import { motion } from 'framer-motion';
import { useLandingI18n } from '../../i18n-landing/LandingI18nContext.js';
import { HighlightYellow } from './HighlightYellow.js';

const STEP_ICON_BG = [
  'rgba(238, 108, 42, 0.15)', // orange
  'rgba(201, 59, 107, 0.15)', // rose
  'rgba(59, 107, 201, 0.15)', // blue
];

export function HowItWorks(): JSX.Element {
  const { t } = useLandingI18n();
  return (
    <section id="how" className="py-[70px] sm:py-[100px]" aria-labelledby="how-title">
      <div className="landing-container">
        <span className="landing-eyebrow">{t.how.eyebrow}</span>
        <h2 id="how-title" className="landing-section-title">
          {t.how.titleStart}
          <HighlightYellow>{t.how.titleEm}</HighlightYellow>
          {t.how.titleEnd}
        </h2>
        <p className="landing-section-intro">{t.how.intro}</p>

        <div className="grid gap-5 md:gap-6 md:grid-cols-3 mt-4">
          {t.how.steps.map((step, idx) => (
            <motion.div
              key={step.num}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.5, delay: idx * 0.1, ease: 'easeOut' }}
              className="relative rounded-2xl border-[1.5px] p-7 sm:p-8 transition-transform hover:-translate-y-[2px]"
              style={{
                background: 'var(--landing-cream-deep)',
                borderColor: 'var(--landing-ink)',
                boxShadow: '0 4px 0 var(--landing-ink)',
              }}
            >
              <span
                aria-hidden="true"
                className="absolute right-[22px] top-[18px]"
                style={{
                  fontFamily: "'Fraunces', serif",
                  fontWeight: 900,
                  fontSize: '88px',
                  lineHeight: 1,
                  color: 'var(--landing-rose)',
                  opacity: 0.16,
                }}
              >
                {step.num}
              </span>
              <div
                aria-hidden="true"
                className="mb-5 flex items-center justify-center rounded-2xl"
                style={{
                  width: 56,
                  height: 56,
                  background: STEP_ICON_BG[idx] ?? STEP_ICON_BG[0],
                  fontSize: '28px',
                }}
              >
                {step.icon}
              </div>
              <h3
                className="mb-3"
                style={{
                  fontFamily: "'Fraunces', serif",
                  fontSize: '22px',
                  fontWeight: 700,
                  letterSpacing: '-0.01em',
                }}
              >
                {step.title}
              </h3>
              <p
                style={{
                  color: 'var(--landing-ink-soft)',
                  fontSize: '15px',
                  lineHeight: 1.6,
                }}
              >
                {step.desc}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
