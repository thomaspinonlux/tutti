/**
 * UseCases — 10 tags rotatifs (rotation alternée -1°/+1° via CSS nth-child).
 */

import { motion } from 'framer-motion';
import { useLandingI18n } from '../../i18n-landing/LandingI18nContext.js';
import { HighlightYellow } from './HighlightYellow.js';

export function UseCasesSection(): JSX.Element {
  const { t } = useLandingI18n();
  return (
    <section className="py-[70px] sm:py-[100px]" aria-labelledby="usecases-title">
      <div className="landing-container">
        <span className="landing-eyebrow">{t.useCases.eyebrow}</span>
        <h2 id="usecases-title" className="landing-section-title">
          {t.useCases.titleStart}
          <HighlightYellow>{t.useCases.titleEm}</HighlightYellow>
          {t.useCases.titleEnd}
        </h2>
        <p className="landing-section-intro">{t.useCases.intro}</p>

        <div className="flex flex-wrap gap-3">
          {t.useCases.tags.map((tag, idx) => (
            <motion.span
              key={tag}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.3, delay: idx * 0.04, ease: 'easeOut' }}
              className="landing-use-tag rounded-full px-5 py-[10px]"
              style={{
                border: '1.5px solid var(--landing-ink)',
                fontSize: '15px',
                fontWeight: 500,
                background: 'var(--landing-cream)',
                color: 'var(--landing-ink)',
                cursor: 'default',
              }}
            >
              {tag}
            </motion.span>
          ))}
        </div>
      </div>
    </section>
  );
}
