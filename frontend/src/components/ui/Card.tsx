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
  // Direction « Électro-Pop Clubbing » (22/11) : une surface nuit, un filet
  // fin ; le ton colore le contour et teinte légèrement le fond.
  default: 'bg-panel border-hairline',
  spritz: 'bg-spritz/[0.07] border-spritz/40',
  basil: 'bg-basil/[0.08] border-basil/40',
  raspberry: 'bg-raspberry/[0.12] border-raspberry/50',
  lemon: 'bg-lemon/[0.07] border-lemon/40',
  plum: 'bg-plum/[0.14] border-plum/60',
  cream: 'bg-cream-2 border-hairline',
};

const SIZES: Record<Size, string> = {
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
};

export const Card = forwardRef<HTMLDivElement, Props>(function Card(
  { tone = 'default', size = 'md', className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`border rounded-2xl ${TONES[tone]} ${SIZES[size]} ${className ?? ''}`}
      {...rest}
    >
      {children}
    </div>
  );
});
