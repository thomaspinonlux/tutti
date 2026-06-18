/**
 * computeRoundResults — agrège les 3 classements de fin de manche depuis
 * ScoreEvent (round ranking, cumul, joueur le plus rapide).
 *
 * Extrait de la route GET /sessions/:id/rounds/:roundId/results (host) pour
 * être réutilisé par le screen-state : la TV (publique) ne peut pas appeler
 * la route auth, donc on embarque ces données dans le payload ROUND_PODIUM
 * (même pattern que le mirror du reveal).
 */
import { prisma } from './prisma.js';

export interface RoundRankingEntry {
  participant_id: string;
  pseudo: string;
  points: number;
  rank: number;
}
export interface CumulativeRankingEntry {
  participant_id: string;
  pseudo: string;
  total_points: number;
  rank: number;
}
export interface FastestPlayer {
  participant_id: string;
  pseudo: string;
  avg_buzz_ms: number;
  first_buzz_count: number;
  buzz_count: number;
}
export interface RoundResultsData {
  round_ranking: RoundRankingEntry[];
  cumulative_ranking: CumulativeRankingEntry[];
  fastest_player: FastestPlayer | null;
}

export async function computeRoundResults(
  sessionId: string,
  roundId: string,
): Promise<RoundResultsData> {
  const participants = await prisma.participant.findMany({
    where: { session_id: sessionId },
    select: { id: true, pseudo: true },
  });
  const pseudoById = new Map(participants.map((p) => [p.id, p.pseudo]));

  // 1. Round ranking : SUM(points) GROUP BY participant WHERE session_round_id = X
  const roundAggregate = await prisma.scoreEvent.groupBy({
    by: ['participant_id'],
    where: { session_round_id: roundId, session_id: sessionId },
    _sum: { points: true },
  });
  const round_ranking = roundAggregate
    .map((r) => ({
      participant_id: r.participant_id,
      pseudo: pseudoById.get(r.participant_id) ?? '?',
      points: r._sum.points ?? 0,
    }))
    .sort((a, b) => b.points - a.points)
    .map((r, idx) => ({ ...r, rank: idx + 1 }));

  // 2. Cumulative ranking : SUM(points) GROUP BY participant WHERE session_id = X
  const cumulAggregate = await prisma.scoreEvent.groupBy({
    by: ['participant_id'],
    where: { session_id: sessionId },
    _sum: { points: true },
  });
  const cumulative_ranking = cumulAggregate
    .map((r) => ({
      participant_id: r.participant_id,
      pseudo: pseudoById.get(r.participant_id) ?? '?',
      total_points: r._sum.points ?? 0,
    }))
    .sort((a, b) => b.total_points - a.total_points)
    .map((r, idx) => ({ ...r, rank: idx + 1 }));

  // 3. Fastest player du round : meilleure moyenne buzz_time_ms + count des
  //    "premiers buzz" (min buzz_time par track). Min 1 buzz pour être éligible.
  const buzzEvents = await prisma.scoreEvent.findMany({
    where: { session_round_id: roundId, session_id: sessionId, buzz_time_ms: { not: null } },
    select: { participant_id: true, buzz_time_ms: true, round_index: true },
  });
  type FastStat = {
    participant_id: string;
    total_ms: number;
    count: number;
    first_buzz_count: number;
  };
  const fastByPid = new Map<string, FastStat>();
  const minBuzzByTrack = new Map<number, number>();
  for (const ev of buzzEvents) {
    if (ev.buzz_time_ms == null) continue;
    const cur = minBuzzByTrack.get(ev.round_index);
    if (cur === undefined || ev.buzz_time_ms < cur) {
      minBuzzByTrack.set(ev.round_index, ev.buzz_time_ms);
    }
  }
  for (const ev of buzzEvents) {
    if (ev.buzz_time_ms == null) continue;
    const cur = fastByPid.get(ev.participant_id) ?? {
      participant_id: ev.participant_id,
      total_ms: 0,
      count: 0,
      first_buzz_count: 0,
    };
    cur.total_ms += ev.buzz_time_ms;
    cur.count += 1;
    if (minBuzzByTrack.get(ev.round_index) === ev.buzz_time_ms) {
      cur.first_buzz_count += 1;
    }
    fastByPid.set(ev.participant_id, cur);
  }
  const fastestList = Array.from(fastByPid.values())
    .map((s) => ({
      participant_id: s.participant_id,
      pseudo: pseudoById.get(s.participant_id) ?? '?',
      avg_buzz_ms: Math.round(s.total_ms / s.count),
      first_buzz_count: s.first_buzz_count,
      buzz_count: s.count,
    }))
    .sort((a, b) => b.first_buzz_count - a.first_buzz_count || a.avg_buzz_ms - b.avg_buzz_ms);
  const fastest_player = fastestList.length > 0 ? (fastestList[0] ?? null) : null;

  return { round_ranking, cumulative_ranking, fastest_player };
}
