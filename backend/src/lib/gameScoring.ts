/**
 * Scoring voice-first (Phase C) — Refonte #4
 *
 * Nouveau barème (mai 2026) :
 *
 * Position points (artiste trouvé) :
 *   1ʳᵉ      : 20 pts
 *   2ᵉ      : 15 pts
 *   3ᵉ      : 10 pts
 *   4ᵉ      :  5 pts
 *   5ᵉ-6ᵉ   :  3 pts
 *   7ᵉ et + :  2 pts
 *
 * Bonus titre (toutes positions confondues, cumulable) :
 *   +5 pts
 *
 * Bonus vitesse 1ʳᵉ position uniquement :
 *   bonus = max(0, 10 - secondes_ecoulees)
 *   - réponse à 0s  : +10
 *   - réponse à 5s  : +5
 *   - réponse ≥ 10s :  +0
 *
 * Score max théorique 1ʳᵉ + titre + vitesse 0s : 20 + 10 + 5 = 35 pts.
 */

const POSITION_POINTS = [20, 15, 10, 5, 3, 3] as const;
const POSITION_FALLBACK = 2; // 7e et au-delà
export const TITLE_BONUS = 5;
export const SPEED_BONUS_MAX_SECONDS = 10; // bonus = max(0, 10 - seconds_elapsed)

export interface ScoringInput {
  matched_artist: boolean;
  matched_title: boolean;
  /** 1, 2, 3, ... (ordre d'arrivée parmi les bonnes réponses du track). */
  position: number;
  /** Délai écoulé depuis le démarrage du track (ms). */
  answered_at_ms: number;
}

export interface ScoringBreakdown {
  /** Points de la position (20 pour 1ʳᵉ, 15 pour 2ᵉ, etc.). */
  artist_base: number;
  /** Bonus titre (+5 si matched_title, sinon 0). */
  title_bonus: number;
  /** Bonus vitesse — uniquement pour la 1ʳᵉ position. */
  speed_bonus: number;
  total: number;
}

/**
 * Renvoie les points de position pour une 1-based position d'arrivée.
 *   pos=1 → 20, pos=2 → 15, pos=3 → 10, pos=4 → 5,
 *   pos=5 → 3,  pos=6 → 3,  pos≥7 → 2.
 */
export function pointsForPosition(position: number): number {
  if (position < 1) return 0;
  // POSITION_POINTS index 0 = 1ère position
  return POSITION_POINTS[position - 1] ?? POSITION_FALLBACK;
}

/**
 * Calcule le score pour une bonne réponse. Si matched_artist === false,
 * retourne 0 partout (l'artiste est obligatoire pour scorer).
 */
export function computeAnswerScore(input: ScoringInput): ScoringBreakdown {
  if (!input.matched_artist) {
    return { artist_base: 0, title_bonus: 0, speed_bonus: 0, total: 0 };
  }

  const artistBase = pointsForPosition(input.position);
  const titleBonus = input.matched_title ? TITLE_BONUS : 0;

  // Bonus vitesse pour la 1ʳᵉ position uniquement : max(0, 10 - secondes).
  const seconds = Math.floor(input.answered_at_ms / 1000);
  const speedBonus = input.position === 1 ? Math.max(0, SPEED_BONUS_MAX_SECONDS - seconds) : 0;

  return {
    artist_base: artistBase,
    title_bonus: titleBonus,
    speed_bonus: speedBonus,
    total: artistBase + titleBonus + speedBonus,
  };
}

/**
 * Compat — anciennes constantes utilisées ailleurs dans le code base.
 * @deprecated utiliser pointsForPosition() ou computeAnswerScore().
 */
export const ARTIST_BASE_BY_POSITION: Record<number, number> = {
  1: pointsForPosition(1),
  2: pointsForPosition(2),
  3: pointsForPosition(3),
};
export const ARTIST_BASE_FALLBACK = POSITION_FALLBACK;
export const SPEED_BONUS_MAX = SPEED_BONUS_MAX_SECONDS;
export const SPEED_BONUS_DECAY_PER_SEC = 1;
