/**
 * <Modal /> — dialogue Pop Cocktail (overlay + carte centrée).
 * Animations fade-in (overlay) + pop-in (carte) via Tailwind keyframes.
 */

import { useEffect, type ReactNode } from 'react';
import { Icone } from './Icone.js';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  /** Largeur max : 'sm' (400) | 'md' (560) | 'lg' (720) */
  size?: 'sm' | 'md' | 'lg';
}

const SIZES = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' } as const;

export function Modal({ open, onClose, title, children, size = 'md' }: Props): JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
        className={`relative w-full ${SIZES[size]} bg-panel border border-hairline rounded-2xl animate-pop-in p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* fix/parcours-sans-impasse — une croix, toujours : sur téléphone la
            fenêtre couvre l'écran et il ne reste presque rien à toucher autour
            pour la fermer. Et une hauteur bornée : un contenu plus haut que
            l'écran était coupé, ses boutons du bas hors d'atteinte. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-lg text-xl text-ink-soft hover:bg-cream-3 hover:text-ink"
        >
          <Icone nom="croix" />
        </button>
        {title && (
          <h2 id="modal-title" className="font-display text-2xl mb-4 pr-12 text-ink">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  );
}
