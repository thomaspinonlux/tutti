/**
 * Hook React pour détecter le breakpoint Tailwind courant via matchMedia.
 *
 * Usage typique : choisir entre rendu inline (xl+) et rendu en modale
 * (sub-xl) pour un panneau secondaire — cf. PlaylistEditPage.
 *
 * Référence : docs/RESPONSIVE.md
 */

import { useEffect, useState } from 'react';

const QUERIES = {
  sm: '(min-width: 640px)',
  md: '(min-width: 768px)',
  lg: '(min-width: 1024px)',
  xl: '(min-width: 1280px)',
  '2xl': '(min-width: 1536px)',
} as const;

export type Breakpoint = keyof typeof QUERIES;
export const BREAKPOINTS: readonly Breakpoint[] = ['sm', 'md', 'lg', 'xl', '2xl'];

type Matches = Record<Breakpoint, boolean>;

function readInitialMatches(): Matches {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return { sm: false, md: false, lg: false, xl: false, '2xl': false };
  }
  const acc: Partial<Matches> = {};
  for (const [bp, q] of Object.entries(QUERIES)) {
    acc[bp as Breakpoint] = window.matchMedia(q).matches;
  }
  return acc as Matches;
}

export interface BreakpointState {
  /** True si la viewport courante atteint au minimum ce breakpoint. */
  isAtLeast: (bp: Breakpoint) => boolean;
  /** Plus grand breakpoint atteint (ex. 'lg' à 1100 px). null en mobile pur. */
  current: Breakpoint | null;
}

export function useBreakpoint(): BreakpointState {
  const [matches, setMatches] = useState<Matches>(readInitialMatches);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const cleanups: Array<() => void> = [];
    for (const [bp, q] of Object.entries(QUERIES)) {
      const mql = window.matchMedia(q);
      const handler = (e: MediaQueryListEvent): void => {
        setMatches((prev) => ({ ...prev, [bp as Breakpoint]: e.matches }));
      };
      mql.addEventListener('change', handler);
      cleanups.push(() => mql.removeEventListener('change', handler));
    }
    return () => {
      for (const c of cleanups) c();
    };
  }, []);

  let current: Breakpoint | null = null;
  for (const bp of BREAKPOINTS) {
    if (matches[bp]) current = bp;
  }

  return {
    isAtLeast: (bp) => matches[bp],
    current,
  };
}
