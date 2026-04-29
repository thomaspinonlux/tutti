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
      className={`px-3 py-1 text-sm border-2 border-ink rounded-full transition-colors ${
        active ? 'bg-ink text-cream' : 'bg-cream text-ink hover:bg-cream-2'
      } ${className ?? ''}`}
    >
      {children}
    </button>
  );
}
