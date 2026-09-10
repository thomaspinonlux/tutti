/**
 * Calcul des scores cumulés sur l'ensemble d'une session multi-round.
 *
 * En mode SOLO  : agrégation par participant_id.
 * En mode TEAMS : agrégation par team_id (les events sans team_id sont
 * écartés du classement par équipe — cas rare, ne devrait pas arriver).
 */

import type { CumulativeScore, GameMode, Team } from '@tutti/shared';
import { ScoreEventType } from '@prisma/client';
import { prisma } from './prisma.js';

interface ComputeArgs {
  sessionId: string;
  mode: GameMode;
  teams: Team[] | null;
  participants: Array<{ id: string; pseudo: string; team_id: string | null }>;
}

/**
 * feat/departage-ex-aequo — À TOTAL ÉGAL, L'ORDRE N'ÉTAIT PLUS ARBITRAIRE.
 *
 * Le tri ne portait que sur `total_points` : deux équipes à 45 points
 * s'affichaient dans l'ordre où la base les avait rendues, c'est-à-dire
 * l'ordre de création des équipes, et le « 1ᵉʳ » annoncé à la salle pouvait
 * changer d'un rafraîchissement à l'autre. Départage, dans cet ordre :
 *
 *   1. total de points (inchangé) ;
 *   2. nombre de 1ʳᵉˢ places sur un morceau — celui qui a trouvé le premier
 *      le plus souvent passe devant ;
 *   3. temps de buzz moyen, le plus rapide devant ;
 *   4. ordre alphabétique — dernier recours, pour que l'affichage soit stable
 *      d'un rafraîchissement à l'autre plutôt qu'aléatoire.
 *
 * Une 1ʳᵉ place se lit sans ambiguïté dans les points : `pointsForPosition`
 * (gameScoring.ts) ne rend 20 que pour la position 1, et seul le type
 * ARTIST_FOUND porte ces points de position. En mode QUIZZ ces deux critères
 * sont neutres (pas de position, pas de temps de buzz) : le départage tombe
 * alors sur l'ordre alphabétique, ce qui reste stable.
 */
interface Departage {
  premieresPlaces: number;
  buzzMoyenMs: number;
}
const DEPARTAGE_NEUTRE: Departage = { premieresPlaces: 0, buzzMoyenMs: Number.POSITIVE_INFINITY };

function comparer(
  a: CumulativeScore,
  b: CumulativeScore,
  dep: Map<string, Departage>,
): number {
  if (b.total_points !== a.total_points) return b.total_points - a.total_points;
  const da = dep.get(a.id) ?? DEPARTAGE_NEUTRE;
  const db = dep.get(b.id) ?? DEPARTAGE_NEUTRE;
  if (db.premieresPlaces !== da.premieresPlaces) return db.premieresPlaces - da.premieresPlaces;
  if (da.buzzMoyenMs !== db.buzzMoyenMs) return da.buzzMoyenMs - db.buzzMoyenMs;
  return a.label.localeCompare(b.label, 'fr');
}

/** Points de position d'une 1ʳᵉ place — cf. POSITION_POINTS[0] dans gameScoring.ts. */
const POINTS_PREMIERE_PLACE = 20;

/**
 * Agrégats de départage, par participant (SOLO) ou par équipe (TEAMS).
 * Deux branches distinctes plutôt qu'une clause `by` dynamique : Prisma type
 * le résultat d'après la clé de regroupement, un `by` variable perdrait ce
 * typage et obligerait à forcer la main au compilateur.
 */
async function chargerDepartageSolo(sessionId: string): Promise<Map<string, Departage>> {
  const [premieres, buzz] = await Promise.all([
    prisma.scoreEvent.groupBy({
      by: ['participant_id'],
      where: {
        session_id: sessionId,
        type: ScoreEventType.ARTIST_FOUND,
        points: POINTS_PREMIERE_PLACE,
      },
      _count: { _all: true },
    }),
    prisma.scoreEvent.groupBy({
      by: ['participant_id'],
      where: {
        session_id: sessionId,
        type: ScoreEventType.ARTIST_FOUND,
        buzz_time_ms: { not: null },
      },
      _avg: { buzz_time_ms: true },
    }),
  ]);
  const out = new Map<string, Departage>();
  for (const l of premieres) {
    entree(out, l.participant_id).premieresPlaces = l._count._all;
  }
  for (const l of buzz) {
    entree(out, l.participant_id).buzzMoyenMs = l._avg.buzz_time_ms ?? Number.POSITIVE_INFINITY;
  }
  return out;
}

async function chargerDepartageEquipes(sessionId: string): Promise<Map<string, Departage>> {
  const [premieres, buzz] = await Promise.all([
    prisma.scoreEvent.groupBy({
      by: ['team_id'],
      where: {
        session_id: sessionId,
        team_id: { not: null },
        type: ScoreEventType.ARTIST_FOUND,
        points: POINTS_PREMIERE_PLACE,
      },
      _count: { _all: true },
    }),
    prisma.scoreEvent.groupBy({
      by: ['team_id'],
      where: {
        session_id: sessionId,
        team_id: { not: null },
        type: ScoreEventType.ARTIST_FOUND,
        buzz_time_ms: { not: null },
      },
      _avg: { buzz_time_ms: true },
    }),
  ]);
  const out = new Map<string, Departage>();
  for (const l of premieres) {
    if (!l.team_id) continue;
    entree(out, l.team_id).premieresPlaces = l._count._all;
  }
  for (const l of buzz) {
    if (!l.team_id) continue;
    entree(out, l.team_id).buzzMoyenMs = l._avg.buzz_time_ms ?? Number.POSITIVE_INFINITY;
  }
  return out;
}

function entree(m: Map<string, Departage>, id: string): Departage {
  let v = m.get(id);
  if (!v) {
    v = { ...DEPARTAGE_NEUTRE };
    m.set(id, v);
  }
  return v;
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
  // de partie. La base sait le faire en une requête. Les deux agrégats de
  // départage suivent le même principe et partent en parallèle.
  if (mode === 'SOLO') {
    const [parParticipant, departage] = await Promise.all([
      prisma.scoreEvent.groupBy({
        by: ['participant_id'],
        where: { session_id: sessionId },
        _sum: { points: true },
      }),
      chargerDepartageSolo(sessionId),
    ]);
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
      .sort((a, b) => comparer(a, b, departage));
  }

  // TEAMS — même principe : addition côté base.
  const [parEquipe, departage] = await Promise.all([
    prisma.scoreEvent.groupBy({
      by: ['team_id'],
      where: { session_id: sessionId, team_id: { not: null } },
      _sum: { points: true },
    }),
    chargerDepartageEquipes(sessionId),
  ]);
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
    .sort((a, b) => comparer(a, b, departage));
}
