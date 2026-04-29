/**
 * <Confetti /> — explosion de confettis multicolores Pop Cocktail.
 *
 * Utilise canvas-confetti (léger, pas de dépendance React lourde).
 * Couleurs alignées sur la palette : spritz, basil, raspberry, lemon, plum.
 *
 * Usage :
 *   <Confetti trigger={isCorrect} />     // explose à chaque true
 *   import { fireConfetti } from './Confetti'; fireConfetti();   // imperatif
 */

import { useEffect } from 'react';
import confetti from 'canvas-confetti';

const POP_COLORS = ['#ee6c2a', '#4a8b3f', '#c8336e', '#e8c547', '#6e3a6e'];

/**
 * Tire une salve de confettis depuis un point cible.
 * Par défaut : centre-bas de l'écran.
 */
export function fireConfetti(opts?: { x?: number; y?: number; particleCount?: number }): void {
  const { x = 0.5, y = 0.7, particleCount = 80 } = opts ?? {};
  void confetti({
    particleCount,
    spread: 70,
    startVelocity: 35,
    origin: { x, y },
    colors: POP_COLORS,
    scalar: 1.1,
  });
}

interface Props {
  /** Quand cette valeur change vers `true`, déclenche une salve. */
  trigger?: boolean;
  /** Tire en boucle pendant N ms (utile pour le podium). */
  durationMs?: number;
}

export function Confetti({ trigger, durationMs }: Props): null {
  useEffect(() => {
    if (!trigger) return;
    fireConfetti();
    if (!durationMs) return;
    const intervalId = window.setInterval(() => fireConfetti({ particleCount: 40 }), 600);
    const timeoutId = window.setTimeout(() => window.clearInterval(intervalId), durationMs);
    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [trigger, durationMs]);
  return null;
}
