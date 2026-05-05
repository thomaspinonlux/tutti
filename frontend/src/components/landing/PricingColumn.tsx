/**
 * Une colonne tarifaire (Tracks / All-Access / Quizz).
 * Variant `highlighted` : fond cream, badge "Best deal" / "Le préféré".
 */

import { motion } from 'framer-motion';

interface PricingRow {
  label: string;
  amount: string;
}

interface PricingColumnProps {
  name: string;
  tag: string;
  rows: PricingRow[];
  highlighted?: boolean;
  bestDealLabel: string;
  delay?: number;
}

export function PricingColumn({
  name,
  tag,
  rows,
  highlighted = false,
  bestDealLabel,
  delay = 0,
}: PricingColumnProps): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, delay, ease: 'easeOut' }}
      className="relative rounded-[18px] transition-all p-7 sm:p-[26px]"
      style={{
        background: highlighted ? 'var(--landing-cream)' : 'rgba(245, 239, 224, 0.04)',
        border: highlighted
          ? '1px solid var(--landing-cream)'
          : '1px solid rgba(245, 239, 224, 0.15)',
        color: highlighted ? 'var(--landing-ink)' : 'var(--landing-cream)',
      }}
    >
      {highlighted && (
        <span
          className="absolute left-1/2 top-[-12px] -translate-x-1/2 whitespace-nowrap rounded-full px-[14px] py-1"
          style={{
            background: 'var(--landing-rose)',
            color: 'var(--landing-cream)',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '10px',
            fontWeight: 600,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          {bestDealLabel}
        </span>
      )}

      <div
        className="pb-5 mb-5"
        style={{
          borderBottom: highlighted
            ? '1px dashed rgba(26, 24, 20, 0.15)'
            : '1px dashed rgba(245, 239, 224, 0.2)',
        }}
      >
        <div
          className="mb-1"
          style={{
            fontFamily: "'Fraunces', serif",
            fontSize: '28px',
            fontWeight: 700,
            letterSpacing: '-0.01em',
            lineHeight: 1.1,
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '10px',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            opacity: 0.7,
          }}
        >
          {tag}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {rows.map((row, idx) => (
          <div
            key={idx}
            className="flex items-baseline justify-between py-2"
            style={{ minHeight: '38px' }}
          >
            <span style={{ fontSize: '14px', opacity: 0.85 }}>{row.label}</span>
            <span
              style={{
                fontFamily: "'Fraunces', serif",
                fontWeight: 700,
                fontSize: '22px',
                letterSpacing: '-0.01em',
              }}
            >
              {row.amount}
              <sup style={{ fontSize: '12px', fontWeight: 500, opacity: 0.7, marginLeft: 1 }}>
                €
              </sup>
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
