/**
 * <Button /> — feat/arcade-buttons-vinyl-buzzer
 *
 * Langage arcade Pop Cocktail :
 *   - bordure 2px ink + ombre DURE 4px 4px 0 ink
 *   - press (:active) : translate(4px,4px) + ombre 0 → l'ombre "s'écrase"
 *   - transition 80ms
 *   - rayons : lg 16px · md 14px · sm 11px
 *   - CTA (variant primary/danger/success) : Fraunces Italic 900
 *
 * Variants (rôles sémantiques, mappés sur les vraies couleurs de marque) :
 *   - primary   : fond ROSE, texte ink — action principale
 *   - secondary : fond cream, bord ink, texte ink
 *   - danger    : fond raspberry (~#CE3A57), texte cream — destructif
 *   - success   : fond basil (green), texte cream — succès + ON
 *   - ghost     : transparent, texte plum, souligné — liens/secondaire
 *   - icon      : carré ~48px, cream + bord + ombre, même press
 *
 * État disabled : opacity 0.38, press neutralisé. Pas de spinner intégré
 * (le caller affiche son loader si besoin) — garde la sémantique simple.
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost' | 'icon';
type Size = 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  // Direction « Électro-Pop Clubbing » (22/11) : plus d'ombre dure décalée.
  // Le bouton principal est corail avec une lueur, les autres sont des
  // surfaces nuit au contour fin ; l'appui enfonce le bouton de 2 px.
  primary:
    'bg-rose text-white border-transparent hover:bg-rose-deep shadow-[0_0_24px_rgba(255,51,102,0.35)] disabled:shadow-none',
  secondary: 'bg-cream-3 text-ink border-hairline hover:bg-cream-4',
  danger: 'bg-raspberry text-white border-transparent hover:bg-raspberry-deep',
  success: 'bg-basil text-[#0E0D17] border-transparent hover:bg-basil-deep',
  ghost: 'bg-transparent text-spritz border-transparent underline underline-offset-4 hover:text-ink',
  icon: 'bg-cream-3 text-ink border-hairline hover:bg-cream-4',
};

// Press arcade : shadow-arcade-* au repos → translate + shadow-arcade-flat
// (= 0 0 0 ink) au :active. La transition 80ms est volontairement courte
// (= sensation immédiate du clic, pas de "molasse").
const PRESS = [
  'transition-all duration-[80ms] ease-out',
  'active:translate-y-[2px]',
].join(' ');

const SIZES: Record<Size, string> = {
  sm: 'min-h-9 px-3 py-1 text-sm rounded-lg',
  md: 'min-h-12 px-5 py-2 text-base rounded-xl',
  lg: 'min-h-14 px-7 py-2 text-lg rounded-xl font-display font-bold uppercase tracking-wide',
};

// icon : carré fixe (forcé à 48×48 quel que soit `size`).
const ICON_OVERRIDE = 'h-12 w-12 p-0 rounded-xl';

// ghost : pas de bordure ni d'ombre (look "lien"), donc on neutralise les
// classes de press qui n'ont pas de sens visuel ici.
const GHOST_OVERRIDE =
  'shadow-none border-0 rounded-md hover:bg-transparent active:translate-y-0';

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', size = 'md', className, children, ...rest },
  ref,
) {
  const isIcon = variant === 'icon';
  const isGhost = variant === 'ghost';
  const sizeClass = isIcon ? ICON_OVERRIDE : SIZES[size];
  const overrideClass = isGhost ? GHOST_OVERRIDE : '';
  return (
    <button
      ref={ref}
      className={[
        'inline-flex items-center justify-center text-center font-bold border select-none',
        PRESS,
        VARIANTS[variant],
        sizeClass,
        overrideClass,
        'disabled:opacity-[0.38] disabled:cursor-not-allowed',
        'disabled:active:translate-y-0',
        className ?? '',
      ].join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
});
