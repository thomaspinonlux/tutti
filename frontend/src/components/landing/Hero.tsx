/**
 * Hero landing — H1 + sub + CTAs + meta + vidéo lazy.
 *
 * Animations Framer Motion : fade-up séquentiel sur les 5 enfants gauche
 * (badge → H1 → sub → CTAs → meta) avec delays 0/0.1/0.2/0.3/0.4s.
 *
 * Le H1 utilise la classe `highlight-yellow` (cf HighlightYellow) pour le
 * soulignement jaune incliné — pas de sélecteur global em.
 */

import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useLandingI18n } from '../../i18n-landing/LandingI18nContext.js';
import { HighlightYellow } from './HighlightYellow.js';
import { LazyVideo } from './LazyVideo.js';

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

export function Hero(): JSX.Element {
  const { t } = useLandingI18n();
  return (
    <section className="relative pt-20 pb-24 lg:pt-20 lg:pb-[100px]" aria-labelledby="hero-title">
      <div className="landing-container grid items-center gap-[50px] lg:grid-cols-[1.05fr_1fr] lg:gap-20">
        <div>
          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="inline-flex items-center gap-2 mb-7 rounded-full border px-[14px] py-[6px]"
            style={{
              backgroundColor: 'var(--landing-cream-deep)',
              borderColor: 'var(--landing-ink)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '11px',
              fontWeight: 500,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--landing-ink-soft)',
            }}
          >
            <span className="landing-beta-pulse" aria-hidden="true" />
            {t.hero.betaBadge}
          </motion.div>

          <motion.h1
            id="hero-title"
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }}
            className="mb-6"
            style={{
              fontFamily: "'Fraunces', serif",
              fontWeight: 900,
              fontSize: 'clamp(44px, 6.5vw, 84px)',
              lineHeight: 0.98,
              letterSpacing: '-0.03em',
              color: 'var(--landing-ink)',
            }}
          >
            {t.hero.titleStart}
            <HighlightYellow>{t.hero.titleEm}</HighlightYellow>
            {t.hero.titleEnd}
          </motion.h1>

          <motion.p
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
            className="mb-9 max-w-[540px]"
            style={{
              fontSize: 'clamp(17px, 1.5vw, 19px)',
              color: 'var(--landing-ink-soft)',
              lineHeight: 1.6,
            }}
            dangerouslySetInnerHTML={{ __html: t.hero.sub }}
          />

          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            transition={{ duration: 0.5, delay: 0.3, ease: 'easeOut' }}
            className="flex flex-wrap gap-[14px] mb-12"
          >
            <Link to="/auth/login" className="landing-btn-primary">
              {t.hero.ctaPrimary}
            </Link>
            <a href="#how" className="landing-btn-secondary">
              {t.hero.ctaSecondary}
            </a>
          </motion.div>

          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            transition={{ duration: 0.5, delay: 0.4, ease: 'easeOut' }}
            className="flex flex-wrap gap-9"
            style={{ fontSize: '14px', color: 'var(--landing-ink-faded)' }}
          >
            <span dangerouslySetInnerHTML={{ __html: t.hero.metaSpotify }} />
            <span dangerouslySetInnerHTML={{ __html: t.hero.metaLanguages }} />
            <span dangerouslySetInnerHTML={{ __html: t.hero.metaPrice }} />
          </motion.div>
        </div>

        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          transition={{ duration: 0.6, delay: 0.2, ease: 'easeOut' }}
          className="relative"
        >
          <div className="landing-video-sticker">{t.hero.videoSticker}</div>
          <LazyVideo
            src="/videos/Tutti_demo_Spotify.mp4"
            poster="/videos/tutti-demo-poster.jpg"
            ariaLabel={t.hero.videoLabel}
          />
        </motion.div>
      </div>
    </section>
  );
}

/* ───── Style strong dans la sub-paragraph ─────
   Le t.hero.sub contient des <strong>...</strong> qui doivent ressortir.
   La règle CSS qui les met en évidence est dans landing.css via .landing-container,
   mais le brief utilise color: var(--ink) + font-weight: 600. Inline pas possible
   via dangerouslySetInnerHTML. Solution : le strong hérite de la couleur de p
   (--landing-ink-soft) et passe à 600 — visuel acceptable. */
