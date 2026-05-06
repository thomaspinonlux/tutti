/**
 * CTA finale — titre + sub + bouton, fond cream avec ♪ et ? décoratifs.
 */

import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useLandingI18n } from '../../i18n-landing/LandingI18nContext.js';
import { HighlightYellow } from './HighlightYellow.js';

export function CtaSection(): JSX.Element {
  const { t } = useLandingI18n();
  return (
    <section className="landing-cta-section py-[80px] sm:py-[100px] text-center">
      <div className="landing-container">
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="mx-auto mb-6 max-w-[720px]"
          style={{
            fontFamily: "'Fraunces', serif",
            fontSize: 'clamp(36px, 5vw, 60px)',
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
          }}
        >
          {t.cta.titleStart}
          <HighlightYellow>{t.cta.titleEm}</HighlightYellow>
          {t.cta.titleEnd}
        </motion.h2>
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }}
          className="mx-auto mb-10 max-w-[460px]"
          style={{ fontSize: '17px', color: 'var(--landing-ink-soft)' }}
        >
          {t.cta.sub}
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
        >
          <Link to="/auth/login" className="landing-btn-primary">
            {t.cta.button}
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
