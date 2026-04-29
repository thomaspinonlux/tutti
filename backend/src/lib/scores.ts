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
  const events = await prisma.scoreEvent.findMany({
    where: { session_id: sessionId },
    select: { participant_id: true, team_id: true, points: true },
  });

  if (mode === 'SOLO') {
    const totals = new Map<string, number>();
    for (const e of events) {
      totals.set(e.participant_id, (totals.get(e.participant_id) ?? 0) + e.points);
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

  // TEAMS
  const totals = new Map<string, number>();
  for (const e of events) {
    if (!e.team_id) continue;
    totals.set(e.team_id, (totals.get(e.team_id) ?? 0) + e.points);
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
