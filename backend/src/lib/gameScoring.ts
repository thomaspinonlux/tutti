/**
 * Scoring voice-first (Phase C) — Refonte #5 (juin 2026) : artiste OU titre.
 *
 * Règle :
 *   - artiste OU titre matché  → points de POSITION (selon l'ordre d'arrivée
 *     parmi les bonnes réponses, artiste ou titre confondus).
 *   - artiste ET titre (même buzz, sur des mots distincts) → position + 10
 *     (bonus "double réponse").
 *   - rien matché → 0 (le joueur peut rebuzzer, sans limite).
 *
 * Position points :
 *   1ʳᵉ=20  2ᵉ=15  3ᵉ=10  4ᵉ=5  5ᵉ-6ᵉ=3  7ᵉ+=2
 *
 * Bonus vitesse (1ʳᵉ position uniquement) :
 *   bonus = max(0, 10 - secondes_ecoulees)  (0s→+10, 5s→+5, ≥10s→+0)
 *
 * Score max théorique 1ʳᵉ + double + vitesse 0s : 20 + 10 + 10 = 40 pts.
 */

const POSITION_POINTS = [20, 15, 10, 5, 3, 3] as const;
const POSITION_FALLBACK = 2; // 7e et au-delà
/** Bonus "double réponse" : artiste ET titre dans le même buzz. */
export const DOUBLE_BONUS = 10;
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
  /**
   * Points de POSITION (20 pour 1ʳᵉ, 15 pour 2ᵉ, …), attribués dès qu'artiste
   * OU titre est matché. (Champ historiquement nommé `artist_base` ; conservé
   * pour ne pas casser les consommateurs in-memory + ScoreEvent.)
   */
  artist_base: number;
  /**
   * Bonus "double réponse" (+10 si artiste ET titre dans le même buzz, sinon 0).
   * (Champ historiquement nommé `title_bonus`.)
   */
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
 * Calcule le score pour une bonne réponse.
 *   - ni artiste ni titre → 0 partout.
 *   - artiste OU titre    → points de position.
 *   - artiste ET titre    → position + DOUBLE_BONUS (10).
 * Le caller doit déjà avoir appliqué la garde "n-grams distincts" sur
 * matched_title (cf. voiceMatch.same_ngram) avant d'appeler ici.
 */
export function computeAnswerScore(input: ScoringInput): ScoringBreakdown {
  const found = input.matched_artist || input.matched_title;
  if (!found) {
    return { artist_base: 0, title_bonus: 0, speed_bonus: 0, total: 0 };
  }

  // Points de position : dus dès qu'artiste OU titre est trouvé.
  const positionBase = pointsForPosition(input.position);
  // Double réponse : artiste ET titre dans le même buzz.
  const doubleBonus = input.matched_artist && input.matched_title ? DOUBLE_BONUS : 0;

  // Bonus vitesse pour la 1ʳᵉ position uniquement : max(0, 10 - secondes).
  const seconds = Math.floor(input.answered_at_ms / 1000);
  const speedBonus = input.position === 1 ? Math.max(0, SPEED_BONUS_MAX_SECONDS - seconds) : 0;

  return {
    artist_base: positionBase,
    title_bonus: doubleBonus,
    speed_bonus: speedBonus,
    total: positionBase + doubleBonus + speedBonus,
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
