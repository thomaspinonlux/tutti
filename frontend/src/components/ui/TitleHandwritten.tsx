/**
 * <TitleHandwritten /> — titre Caprasimo avec souligné jaune en biais
 * (style affiche imprimée, signature Pop Cocktail).
 *
 * Usage :
 *   <TitleHandwritten>Bienvenue chez <Underline>Tutti</Underline></TitleHandwritten>
 */

import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  as?: 'h1' | 'h2' | 'h3';
  className?: string;
}

const AS_STYLES = {
  // Syne est plus large que l'ancienne police de titre : un cran plus petit
  // pour que les titres tiennent sur un téléphone.
  h1: 'text-4xl md:text-5xl',
  h2: 'text-2xl md:text-3xl',
  h3: 'text-xl md:text-2xl',
} as const;

export function TitleHandwritten({ children, as = 'h1', className }: Props): JSX.Element {
  const Tag = as;
  return (
    <Tag
      className={`font-display font-extrabold leading-[1.05] tracking-tight text-ink [overflow-wrap:anywhere] ${AS_STYLES[as]} ${className ?? ''}`}
    >
      {children}
    </Tag>
  );
}

/**
 * <Underline /> — soulignement jaune oblique en arrière-plan, à utiliser
 * dans <TitleHandwritten> autour des mots-clés.
 */
export function Underline({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span className="relative inline-block pb-2">
      <span className="relative">{children}</span>
      {/* Le trait de marqueur jaune devient un filet néon sous le titre. */}
      <span
        aria-hidden
        className="absolute bottom-0 left-0 h-1 w-full rounded-full bg-gradient-to-r from-rose via-lemon to-spritz"
      />
    </span>
  );
}

/**
 * <Swirl /> — accent rotatif raspberry pour mots d'impact.
 */
export function Swirl({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span className="inline-block bg-gradient-to-r from-rose via-lemon to-spritz bg-clip-text text-transparent">
      {children}
    </span>
  );
}
