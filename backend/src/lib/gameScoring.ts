/**
 * Calcul des points pour la boucle de jeu Tutti Tracks (étape 10, Phase A).
 *
 * V1 :
 *   - ARTIST_FOUND  = 100 points
 *   - TITLE_BONUS   = +50 points (cumulable avec ARTIST_FOUND)
 *   - SPEED_BONUS   = pas en V1 (étape 11+ avec Whisper réel)
 *   - MVP_BONUS     = pas en V1 (étape 13)
 *
 * Échelle : un buzz "artiste seul" = 100 ; "artiste + titre" = 150.
 */

export const POINTS_ARTIST = 100;
export const POINTS_TITLE_BONUS = 50;

export interface ScoringResult {
  artist_points: number;
  title_points: number;
  total: number;
  matched_artist: boolean;
  matched_title: boolean;
}

export function computeBuzzPoints(input: {
  matched_artist: boolean;
  matched_title: boolean;
}): ScoringResult {
  const artist_points = input.matched_artist ? POINTS_ARTIST : 0;
  const title_points = input.matched_artist && input.matched_title ? POINTS_TITLE_BONUS : 0;
  return {
    artist_points,
    title_points,
    total: artist_points + title_points,
    matched_artist: input.matched_artist,
    matched_title: input.matched_title,
  };
}
