/**
 * Helper : <em> stylé avec soulignement jaune incliné en arrière-plan.
 * - Classe `.highlight-yellow` scopée (cf landing.css), pas de sélecteur
 *   global em pour éviter les collisions avec le reste de l'app.
 * - Fraunces 900 italic auto-hébergé (cf @font-face dans index.html).
 * - Variant `orange` : remplace la couleur du texte par orange (utilisé pour
 *   les titres Quizz qui sont orange et non rose).
 */

import type { ReactNode } from 'react';

interface HighlightYellowProps {
  children: ReactNode;
  variant?: 'rose' | 'orange';
}

export function HighlightYellow({ children, variant = 'rose' }: HighlightYellowProps): JSX.Element {
  return (
    <em
      className={`highlight-yellow${variant === 'orange' ? ' highlight-orange' : ''}`}
      style={{ fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontWeight: 900 }}
    >
      {children}
    </em>
  );
}
