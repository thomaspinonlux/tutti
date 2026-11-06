/**
 * manches.ts — feat/compteur-manches-completes
 * Une manche « complète » = terminée APRÈS avoir joué tous ses morceaux
 * (current_track_index a atteint le nombre de morceaux de la manche).
 * Une manche lancée puis arrêtée au bout de 2 chansons ne compte pas.
 */
interface MancheMinimale {
  status: string;
  current_track_index: number;
  playlist?: { tracks_count?: number } | null;
}

export function estMancheComplete(r: MancheMinimale): boolean {
  const total = r.playlist?.tracks_count ?? 0;
  return r.status === 'ENDED' && total > 0 && r.current_track_index >= total;
}

export function compterManchesCompletes(rounds: readonly MancheMinimale[] | null | undefined): number {
  return (rounds ?? []).filter(estMancheComplete).length;
}
