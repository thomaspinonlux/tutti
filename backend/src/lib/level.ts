/**
 * Calcul automatique du niveau d'une playlist selon la moyenne de popularité
 * des morceaux qu'elle contient.
 *
 * Logique : plus un morceau est populaire, plus il est facile à reconnaître.
 *   - moyenne >= 70 → EASY
 *   - 45 <= moyenne < 70 → MEDIUM
 *   - moyenne < 45 → EXPERT
 *
 * Si aucune popularité n'est disponible (provider 'demo' avec popularity null),
 * on retombe sur MEDIUM par défaut.
 */

import type { Level } from '@tutti/shared';

export function computeLevelFromPopularities(values: Array<number | null | undefined>): Level {
  const known = values.filter((v): v is number => typeof v === 'number');
  if (known.length === 0) return 'MEDIUM';
  const avg = known.reduce((s, v) => s + v, 0) / known.length;
  if (avg >= 70) return 'EASY';
  if (avg >= 45) return 'MEDIUM';
  return 'EXPERT';
}
