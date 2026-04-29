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
  spritz: 'bg-spritz text-cream',
  basil: 'bg-basil text-cream',
  raspberry: 'bg-raspberry text-cream',
  lemon: 'bg-lemon text-ink',
  plum: 'bg-plum text-cream',
  ink: 'bg-ink text-cream',
  cream: 'bg-cream-2 text-ink',
};

export function Badge({ tone = 'spritz', children, className, tilt = 0 }: Props): JSX.Element {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 text-xs font-mono uppercase tracking-wider font-bold border-2 border-ink rounded ${TONES[tone]} ${className ?? ''}`}
      style={tilt !== 0 ? { transform: `rotate(${tilt}deg)` } : undefined}
    >
      {children}
    </span>
  );
}
