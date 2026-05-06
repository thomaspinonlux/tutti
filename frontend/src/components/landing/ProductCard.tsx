/**
 * Product card — réutilisée pour Tracks et Quizz.
 * Variant change : couleur du tag, du nom italique, des bullets ✓, du hover CTA.
 */

import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

interface ProductCardProps {
  variant: 'tracks' | 'quizz';
  tag: string;
  nameStart: string;
  nameEm: string;
  desc: string;
  features: string[];
  cta: string;
  ctaHref: string;
  delay?: number;
}

export function ProductCard({
  variant,
  tag,
  nameStart,
  nameEm,
  desc,
  features,
  cta,
  ctaHref,
  delay = 0,
}: ProductCardProps): JSX.Element {
  const accent = variant === 'tracks' ? 'var(--landing-rose)' : 'var(--landing-orange)';
  const tagBg = variant === 'tracks' ? 'rgba(201, 59, 107, 0.1)' : 'rgba(238, 108, 42, 0.12)';

  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.55, delay, ease: 'easeOut' }}
      className="flex flex-col rounded-[18px] border-[1.5px] p-9 sm:p-10 transition-transform hover:-translate-y-[3px]"
      style={{
        background: 'var(--landing-cream)',
        borderColor: 'var(--landing-ink)',
        boxShadow: '0 4px 0 var(--landing-ink)',
      }}
    >
      <span
        className="self-start inline-flex items-center gap-2 rounded-full px-[14px] py-[6px] mb-5"
        style={{
          background: tagBg,
          color: accent,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '11px',
          fontWeight: 500,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}
      >
        {tag}
      </span>

      <h3
        className="mb-4"
        style={{
          fontFamily: "'Fraunces', serif",
          fontSize: 'clamp(28px, 3.5vw, 38px)',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
        }}
      >
        {nameStart}
        <em
          style={{
            fontStyle: 'italic',
            color: accent,
            fontWeight: 900,
            fontFamily: "'Fraunces', serif",
          }}
        >
          {nameEm}
        </em>
      </h3>

      <p
        className="mb-7"
        style={{
          fontSize: '16px',
          color: 'var(--landing-ink-soft)',
          lineHeight: 1.6,
        }}
      >
        {desc}
      </p>

      <ul className="mb-7 list-none p-0">
        {features.map((feat, idx) => (
          <li
            key={idx}
            className="relative pl-7"
            style={{
              padding: '10px 0 10px 28px',
              fontSize: '15px',
              color: 'var(--landing-ink-soft)',
              borderBottom:
                idx === features.length - 1 ? 'none' : '1px dashed rgba(26, 24, 20, 0.1)',
            }}
          >
            <span
              aria-hidden="true"
              className="absolute left-0 font-bold"
              style={{ color: accent }}
            >
              ✓
            </span>
            {feat}
          </li>
        ))}
      </ul>

      <Link
        to={ctaHref}
        className="self-start inline-flex items-center gap-2 rounded-full px-[22px] py-3 transition-colors"
        style={{
          background: 'var(--landing-ink)',
          color: 'var(--landing-cream)',
          fontWeight: 600,
          fontSize: '14px',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLAnchorElement).style.background = accent;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLAnchorElement).style.background = 'var(--landing-ink)';
        }}
      >
        {cta}
      </Link>
    </motion.article>
  );
}
