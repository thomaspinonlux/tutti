/**
 * <Modal /> — dialogue Pop Cocktail (overlay + carte centrée).
 * Animations fade-in (overlay) + pop-in (carte) via Tailwind keyframes.
 */

import { useEffect, type ReactNode } from 'react';

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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
        className={`w-full ${SIZES[size]} bg-white border-2 border-ink rounded-lg shadow-pop-xl animate-pop-in p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <h2 id="modal-title" className="font-display text-2xl mb-4 text-ink">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  );
}
