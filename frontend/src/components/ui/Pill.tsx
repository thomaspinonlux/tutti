/**
 * <Pill /> — bouton de filtre (option : actif / inactif).
 * Plus arrondi qu'un bouton standard.
 */

import type { ReactNode } from 'react';

interface Props {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}

export function Pill({ active = false, onClick, children, className }: Props): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1 text-sm border rounded-full transition-colors ${
        active
          ? 'border-spritz bg-spritz/15 text-spritz'
          : 'border-hairline bg-cream-2 text-ink hover:bg-cream-3'
      } ${className ?? ''}`}
    >
      {children}
    </button>
  );
}
