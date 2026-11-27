/**
 * computeRoundResults — agrège les 3 classements de fin de manche depuis
 * ScoreEvent (round ranking, cumul, joueur le plus rapide).
 *
 * Extrait de la route GET /sessions/:id/rounds/:roundId/results (host) pour
 * être réutilisé par le screen-state : la TV (publique) ne peut pas appeler
 * la route auth, donc on embarque ces données dans le payload ROUND_PODIUM
 * (même pattern que le mirror du reveal).
 */
import type { GameMode, Team } from '@tutti/shared';
import { prisma } from './prisma.js';
import { getCumulativeScores } from './scores.js';

/**
 * En mode équipes, une ligne = une ÉQUIPE : `participant_id` porte alors
 * l'identifiant de l'équipe et `pseudo` son nom. Les noms de champs restent
 * ceux du mode solo pour que les écrans existants s'affichent sans changement.
 */
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
/** Une ligne du classement par joueur affiché SOUS celui des équipes. */
export interface RoundPlayerEntry {
  participant_id: string;
  pseudo: string;
  points: number;
  rank: number;
  /** Nom de l'équipe du joueur, pour le situer d'un coup d'œil. */
  equipe: string | null;
}
export interface RoundResultsData {
  /**
   * Mode équipes seulement : le classement de la manche par joueur, montré
   * après celui des équipes (Thomas, 26/11 : « après, tu peux me mettre le
   * classement par joueur, mais avant tout, on met l'équipe »). `null` en solo,
   * où `round_ranking` est déjà par joueur.
   */
  round_ranking_joueurs: RoundPlayerEntry[] | null;
  round_ranking: RoundRankingEntry[];
  cumulative_ranking: CumulativeRankingEntry[];
  fastest_player: FastestPlayer | null;
}

/**
 * fix/podium-par-equipe (26/11) — Thomas, en pleine partie à trois équipes :
 * « tu as mis le podium par joueur et pas par équipe ». Le classement de la
 * manche additionnait les points par TÉLÉPHONE quel que soit le mode : en
 * équipes, la TV et la console annonçaient « Steve, Rocco, Telmo » au lieu de
 * « Canada, Portugal, Turquie ». Le classement général, lui, était déjà par
 * équipe (getCumulativeScores) — d'où deux classements qui ne se parlaient pas.
 *
 * En mode équipes, on additionne donc par équipe, sur l'équipe inscrite sur
 * chaque ligne de points (celle du joueur au moment où il a marqué — la même
 * règle que le classement général). Toutes les équipes sont listées, même à
 * zéro : un podium d'équipes où il en manque une ne se lit pas.
 */
export async function classementMancheParEquipe(
  sessionId: string,
  roundId: string,
  teams: Team[],
): Promise<RoundRankingEntry[]> {
  const parEquipe = await prisma.scoreEvent.groupBy({
    by: ['team_id'],
    where: { session_round_id: roundId, session_id: sessionId, team_id: { not: null } },
    _sum: { points: true },
  });
  const points = new Map<string, number>();
  for (const ligne of parEquipe) {
    if (ligne.team_id) points.set(ligne.team_id, ligne._sum.points ?? 0);
  }
  return teams
    .map((t) => ({ participant_id: t.id, pseudo: t.name, points: points.get(t.id) ?? 0 }))
    .sort((a, b) => b.points - a.points || a.pseudo.localeCompare(b.pseudo))
    .map((r, idx) => ({ ...r, rank: idx + 1 }));
}

/** Classement de la manche par joueur (ceux qui ont marqué), avec leur équipe. */
export async function classementMancheParJoueur(
  sessionId: string,
  roundId: string,
  participants: Array<{ id: string; pseudo: string; team_id: string | null }>,
  teams: Team[],
): Promise<RoundPlayerEntry[]> {
  const parJoueur = await prisma.scoreEvent.groupBy({
    by: ['participant_id'],
    where: { session_round_id: roundId, session_id: sessionId },
    _sum: { points: true },
  });
  const joueurs = new Map(participants.map((p) => [p.id, p]));
  const nomEquipe = new Map(teams.map((t) => [t.id, t.name]));
  return parJoueur
    .map((l) => {
      const j = joueurs.get(l.participant_id);
      return {
        participant_id: l.participant_id,
        pseudo: j?.pseudo ?? '?',
        points: l._sum.points ?? 0,
        equipe: j?.team_id ? (nomEquipe.get(j.team_id) ?? null) : null,
      };
    })
    .sort((a, b) => b.points - a.points || a.pseudo.localeCompare(b.pseudo))
    .map((r, idx) => ({ ...r, rank: idx + 1 }));
}

export async function computeRoundResults(
  sessionId: string,
  roundId: string,
  /** Mode et équipes de la partie. Absent = classement par joueur. */
  partie?: { mode: GameMode; teams: Team[] | null },
): Promise<RoundResultsData> {
  const participants = await prisma.participant.findMany({
    where: { session_id: sessionId },
    select: { id: true, pseudo: true, team_id: true },
  });
  const pseudoById = new Map(participants.map((p) => [p.id, p.pseudo]));
  const equipes =
    partie?.mode === 'TEAMS' && partie.teams && partie.teams.length > 0 ? partie.teams : null;

  let round_ranking: RoundRankingEntry[];
  let cumulative_ranking: CumulativeRankingEntry[];
  let round_ranking_joueurs: RoundPlayerEntry[] | null = null;
  if (equipes) {
    // Le général sort de la même fonction que la TV et le podium final :
    // même ordre, même départage des ex æquo, partout.
    const [manche, general, joueurs] = await Promise.all([
      classementMancheParEquipe(sessionId, roundId, equipes),
      getCumulativeScores({ sessionId, mode: 'TEAMS', teams: equipes, participants }),
      classementMancheParJoueur(sessionId, roundId, participants, equipes),
    ]);
    round_ranking_joueurs = joueurs;
    round_ranking = manche;
    cumulative_ranking = general.map((g, idx) => ({
      participant_id: g.id,
      pseudo: g.label,
      total_points: g.total_points,
      rank: idx + 1,
    }));
  } else {
    // 1. Round ranking : SUM(points) GROUP BY participant WHERE session_round_id = X
    const roundAggregate = await prisma.scoreEvent.groupBy({
      by: ['participant_id'],
      where: { session_round_id: roundId, session_id: sessionId },
      _sum: { points: true },
    });
    round_ranking = roundAggregate
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
    cumulative_ranking = cumulAggregate
      .map((r) => ({
        participant_id: r.participant_id,
        pseudo: pseudoById.get(r.participant_id) ?? '?',
        total_points: r._sum.points ?? 0,
      }))
      .sort((a, b) => b.total_points - a.total_points)
      .map((r, idx) => ({ ...r, rank: idx + 1 }));
  }

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

  return { round_ranking, round_ranking_joueurs, cumulative_ranking, fastest_player };
}
