/**
 * config/levelWeights.ts — feat/thematic-level-cumulative-weighted
 *
 * « CURSEUR » réglable du filtre de niveau cumulatif + pondéré sur les
 * playlists THÉMATIQUES. Source unique, modifiable sans toucher la logique de
 * tirage (lib/gameplayCore.ts) ni la route de lancement (routes/library.ts).
 *
 * Modèle CUMULATIF (inclusif vers le bas) : un niveau choisi inclut tous les
 * tiers en dessous. Les CLÉS de chaque entrée définissent le pool cumulé
 * (tiers clonés) ; les VALEURS sont les proportions-cibles du tirage (part de
 * chaque tier dans les 15 tracks tirées) :
 *
 *   Facile   (EASY)   → pool {EASY}                  → 100% EASY
 *   Moyen    (MEDIUM) → pool {EASY, MEDIUM}          → 25% EASY / 75% MEDIUM
 *   Difficile(EXPERT) → pool {EASY, MEDIUM, EXPERT}  → 10% E / 20% M / 70% EXPERT
 *   Mix               → pool complet, tirage PLAT (pas de pondération)
 *
 * Les proportions sont des cibles : si un tier n'a pas assez de tracks, le
 * reste est redistribué sur les autres tiers du pool (cf. pickWeighted).
 *
 * Pour régler : changer les nombres ci-dessous. Ils n'ont pas besoin de
 * sommer à 1 (normalisés au tirage), mais c'est plus lisible ainsi.
 */

export type Tier = 'EASY' | 'MEDIUM' | 'EXPERT';

/** Le niveau choisi est exprimé par son tier « sommet » (EASY|MEDIUM|EXPERT). */
export const LEVEL_WEIGHTS: Record<Tier, Partial<Record<Tier, number>>> = {
  EASY: { EASY: 1.0 },
  MEDIUM: { EASY: 0.25, MEDIUM: 0.75 },
  EXPERT: { EASY: 0.1, MEDIUM: 0.2, EXPERT: 0.7 },
};

/**
 * Tiers du pool cumulé pour un niveau = les clés de son objet de poids.
 * Ex. cumulativeTiers('EXPERT') = ['EASY','MEDIUM','EXPERT'].
 */
export function cumulativeTiers(level: Tier): Tier[] {
  return Object.keys(LEVEL_WEIGHTS[level]) as Tier[];
}
