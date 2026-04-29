/**
 * <Button /> — bouton Pop Cocktail.
 * Bordure noire épaisse + ombre décalée fixe qui rétrécit au hover.
 *
 * Variants :
 *   - primary  : fond spritz (orange), texte cream
 *   - secondary: fond cream, texte ink
 *   - danger   : fond raspberry, texte cream
 *   - ghost    : transparent, bordure seule
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-spritz text-cream border-ink hover:bg-spritz-deep',
  secondary: 'bg-cream text-ink border-ink hover:bg-cream-2',
  danger: 'bg-raspberry text-cream border-ink hover:bg-raspberry-deep',
  ghost: 'bg-transparent text-ink border-ink hover:bg-cream-2',
};

const SIZES: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm shadow-pop-sm hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5',
  md: 'px-5 py-2.5 text-base shadow-pop hover:shadow-pop-sm hover:translate-x-0.5 hover:translate-y-0.5',
  lg: 'px-7 py-3.5 text-lg shadow-pop-lg hover:shadow-pop hover:translate-x-1 hover:translate-y-1',
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', size = 'md', className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center font-bold border-2 rounded transition-all ${VARIANTS[variant]} ${SIZES[size]} disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-pop disabled:hover:translate-x-0 disabled:hover:translate-y-0 ${className ?? ''}`}
      {...rest}
    >
      {children}
    </button>
  );
});
