/**
 * Scoring voice-first (Phase C) : barème dégressif + bonus titre + bonus vitesse.
 *
 * Barème de base par position d'arrivée (artiste trouvé) :
 *   1ʳᵉ : 150 pts
 *   2ᵉ  : 100 pts
 *   3ᵉ  :  75 pts
 *   4ᵉ+ :  50 pts
 *
 * Bonus titre (si l'artiste ET le titre sont reconnus dans la même fenêtre,
 * peu importe l'ordre dans le transcript) :
 *   +50 pts (toutes positions confondues)
 *
 * Bonus vitesse pour la 1ʳᵉ position uniquement :
 *   bonus = max(0, 50 - secondes_ecoulees * 2)
 *   - réponse à 5s   : +40
 *   - réponse à 15s  : +20
 *   - réponse ≥ 25s  :  +0
 *
 * Score max théorique sur un morceau (1ʳᵉ + titre + vitesse 5s) :
 *   150 + 50 + 40 = 240 points.
 */

export const ARTIST_BASE_BY_POSITION: Record<number, number> = {
  1: 150,
  2: 100,
  3: 75,
  // 4+ : 50 (hors map, fallback dans la fonction)
};
export const ARTIST_BASE_FALLBACK = 50;
export const TITLE_BONUS = 50;
export const SPEED_BONUS_MAX = 50;
export const SPEED_BONUS_DECAY_PER_SEC = 2;

export interface ScoringInput {
  matched_artist: boolean;
  matched_title: boolean;
  /** 1, 2, 3, ... (ordre d'arrivée parmi les bonnes réponses du track). */
  position: number;
  /** Délai écoulé depuis le démarrage du track (ms). */
  answered_at_ms: number;
}

export interface ScoringBreakdown {
  artist_base: number;
  title_bonus: number;
  speed_bonus: number;
  total: number;
}

/**
 * Calcule le score pour une bonne réponse. Si matched_artist === false,
 * retourne 0 partout (l'artiste est obligatoire pour scorer).
 */
export function computeAnswerScore(input: ScoringInput): ScoringBreakdown {
  if (!input.matched_artist) {
    return { artist_base: 0, title_bonus: 0, speed_bonus: 0, total: 0 };
  }

  const artistBase = ARTIST_BASE_BY_POSITION[input.position] ?? ARTIST_BASE_FALLBACK;

  const titleBonus = input.matched_title ? TITLE_BONUS : 0;

  // Bonus vitesse pour la 1ʳᵉ position uniquement.
  const seconds = input.answered_at_ms / 1000;
  const speedBonusRaw = SPEED_BONUS_MAX - seconds * SPEED_BONUS_DECAY_PER_SEC;
  const speedBonus = input.position === 1 ? Math.max(0, Math.round(speedBonusRaw)) : 0;

  return {
    artist_base: artistBase,
    title_bonus: titleBonus,
    speed_bonus: speedBonus,
    total: artistBase + titleBonus + speedBonus,
  };
}
