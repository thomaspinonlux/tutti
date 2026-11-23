/**
 * <Badge /> — étiquette colorée pour équipes, statuts, tags.
 * Légèrement penchée (-1° à +2°) pour casser la rigidité.
 */

import type { ReactNode } from 'react';

type Tone = 'spritz' | 'basil' | 'raspberry' | 'lemon' | 'plum' | 'ink' | 'cream';

interface Props {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  /** Légère rotation (-2° à +2°). Défaut : 0. */
  tilt?: number;
}

const TONES: Record<Tone, string> = {
  spritz: 'bg-spritz/15 text-spritz border-spritz/40',
  basil: 'bg-basil/15 text-basil border-basil/40',
  raspberry: 'bg-raspberry/20 text-[#ff8fa3] border-raspberry/50',
  lemon: 'bg-lemon/15 text-lemon border-lemon/40',
  plum: 'bg-plum/25 text-[#c4a1ff] border-plum/60',
  ink: 'bg-cream-4 text-ink border-hairline',
  cream: 'bg-cream-3 text-ink border-hairline',
};

export function Badge({ tone = 'spritz', children, className, tilt = 0 }: Props): JSX.Element {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 text-xs font-mono uppercase tracking-wider font-bold border rounded-full ${TONES[tone]} ${className ?? ''}`}
      style={tilt !== 0 ? { transform: `rotate(${tilt}deg)` } : undefined}
    >
      {children}
    </span>
  );
}
