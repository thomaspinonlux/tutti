/**
 * <Card /> — bloc de contenu Pop Cocktail.
 * Fond blanc, bordure ink épaisse, ombre décalée fixe.
 * Variants colorées pour les accents (équipes, stats, podium).
 */

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

type Tone = 'default' | 'spritz' | 'basil' | 'raspberry' | 'lemon' | 'plum' | 'cream';
type Size = 'sm' | 'md' | 'lg';

interface Props extends HTMLAttributes<HTMLDivElement> {
  tone?: Tone;
  size?: Size;
  children: ReactNode;
}

const TONES: Record<Tone, string> = {
  default: 'bg-white',
  spritz: 'bg-spritz/10',
  basil: 'bg-basil/10',
  raspberry: 'bg-raspberry/10',
  lemon: 'bg-lemon/15',
  plum: 'bg-plum/10',
  cream: 'bg-cream-2',
};

const SIZES: Record<Size, string> = {
  sm: 'p-4 shadow-pop',
  md: 'p-6 shadow-pop-lg',
  lg: 'p-8 shadow-pop-xl',
};

export const Card = forwardRef<HTMLDivElement, Props>(function Card(
  { tone = 'default', size = 'md', className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`border-2 border-ink rounded-lg ${TONES[tone]} ${SIZES[size]} ${className ?? ''}`}
      {...rest}
    >
      {children}
    </div>
  );
});
