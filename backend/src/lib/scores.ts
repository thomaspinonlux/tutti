/**
 * Calcul des scores cumulés sur l'ensemble d'une session multi-round.
 *
 * En mode SOLO  : agrégation par participant_id.
 * En mode TEAMS : agrégation par team_id (les events sans team_id sont
 * écartés du classement par équipe — cas rare, ne devrait pas arriver).
 */

import type { CumulativeScore, GameMode, Team } from '@tutti/shared';
import { prisma } from './prisma.js';

interface ComputeArgs {
  sessionId: string;
  mode: GameMode;
  teams: Team[] | null;
  participants: Array<{ id: string; pseudo: string; team_id: string | null }>;
}

export async function getCumulativeScores({
  sessionId,
  mode,
  teams,
  participants,
}: ComputeArgs): Promise<CumulativeScore[]> {
  // perf/classement — L'ADDITION EST FAITE PAR LA BASE.
  // On chargeait toutes les lignes de points de la soirée pour les additionner
  // ici, à chaque bonne réponse, chaque pause et chaque calcul d'écran : sur
  // une soirée de plusieurs manches cela faisait des milliers de lignes
  // transportées par seconde, et c'est ce qui rendait l'affichage lent en fin
  // de partie. La base sait le faire en une requête.
  if (mode === 'SOLO') {
    const parParticipant = await prisma.scoreEvent.groupBy({
      by: ['participant_id'],
      where: { session_id: sessionId },
      _sum: { points: true },
    });
    const totals = new Map<string, number>();
    for (const ligne of parParticipant) {
      totals.set(ligne.participant_id, ligne._sum.points ?? 0);
    }
    return participants
      .map((p) => ({
        id: p.id,
        label: p.pseudo,
        color: null,
        total_points: totals.get(p.id) ?? 0,
      }))
      .sort((a, b) => b.total_points - a.total_points);
  }

  // TEAMS — même principe : addition côté base.
  const parEquipe = await prisma.scoreEvent.groupBy({
    by: ['team_id'],
    where: { session_id: sessionId, team_id: { not: null } },
    _sum: { points: true },
  });
  const totals = new Map<string, number>();
  for (const ligne of parEquipe) {
    if (!ligne.team_id) continue;
    totals.set(ligne.team_id, ligne._sum.points ?? 0);
  }
  return (teams ?? [])
    .map((t) => ({
      id: t.id,
      label: t.name,
      color: t.color,
      total_points: totals.get(t.id) ?? 0,
    }))
    .sort((a, b) => b.total_points - a.total_points);
}
