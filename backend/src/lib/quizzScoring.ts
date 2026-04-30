/**
 * Scoring Tutti Quizz V0.
 *
 * Barème :
 *   - MCQ / TRUE_FALSE / FREE_TEXT : binary
 *     * Réponse correcte → base_points + bonus vitesse
 *     * Réponse incorrecte → 0 point
 *
 *   - ESTIMATION : score gradué selon proximité de la cible
 *     * Réponse exacte (= target) → base_points + bonus vitesse
 *     * Réponse proche → base_points * (1 - écart_normalisé)
 *     * Réponse hors range → 0 point
 *
 * Bonus vitesse pour les bonnes réponses :
 *   bonus = base_points * 0.5 * (time_remaining_ratio)
 *   → réponse instantanée (0s) = +50% bonus
 *   → réponse à mi-timer = +25% bonus
 *   → réponse à la fin = 0% bonus
 *   Ratio = (time_limit_ms - elapsed) / time_limit_ms
 */

export const SPEED_BONUS_RATIO = 0.5;

export interface ScoreInput {
  is_correct: boolean;
  /** ESTIMATION uniquement : 0..1, 0 = exact, 1 = hors range. */
  estimation_distance?: number;
  base_points: number;
  submitted_at_ms: number;
  started_at_ms: number;
  time_limit_ms: number;
}

export interface ScoreResult {
  is_correct: boolean;
  score: number;
  speed_bonus: number;
  base_score: number;
}

export function computeQuestionScore(input: ScoreInput): ScoreResult {
  // Calcul du base_score
  let baseScore = 0;
  if (input.estimation_distance !== undefined) {
    // ESTIMATION : score gradué
    const proximity = Math.max(0, 1 - input.estimation_distance);
    baseScore = Math.round(input.base_points * proximity);
  } else if (input.is_correct) {
    baseScore = input.base_points;
  }

  if (baseScore === 0) {
    return { is_correct: false, score: 0, speed_bonus: 0, base_score: 0 };
  }

  // Bonus vitesse — proportionnel au temps restant
  const elapsed = input.submitted_at_ms - input.started_at_ms;
  const timeRemainingRatio = Math.max(0, 1 - elapsed / input.time_limit_ms);
  const speedBonus = Math.round(input.base_points * SPEED_BONUS_RATIO * timeRemainingRatio);

  return {
    is_correct: true,
    score: baseScore + speedBonus,
    speed_bonus: speedBonus,
    base_score: baseScore,
  };
}
