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
  h1: 'text-5xl md:text-6xl',
  h2: 'text-3xl md:text-4xl',
  h3: 'text-2xl md:text-3xl',
} as const;

export function TitleHandwritten({ children, as = 'h1', className }: Props): JSX.Element {
  const Tag = as;
  return (
    <Tag
      className={`font-display leading-[0.95] tracking-tight text-ink ${AS_STYLES[as]} ${className ?? ''}`}
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
    <span className="relative inline-block">
      <span
        aria-hidden
        className="absolute bottom-1 left-0 w-full h-3 bg-lemon -z-10"
        style={{ transform: 'skew(-8deg)' }}
      />
      <span className="relative">{children}</span>
    </span>
  );
}

/**
 * <Swirl /> — accent rotatif raspberry pour mots d'impact.
 */
export function Swirl({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span className="inline-block text-raspberry" style={{ transform: 'rotate(-3deg)' }}>
      {children}
    </span>
  );
}
