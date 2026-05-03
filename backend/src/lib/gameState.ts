/**
 * État applicatif en mémoire pour la boucle de jeu (Phase C — voice-first).
 *
 * V1 : 1 process Railway = OK. Si le process redémarre, l'état du round
 * en cours est perdu (le master doit relancer la manche). Pour la prod
 * scaling horizontale, déplacer dans Redis.
 *
 * Modèle "Kahoot-like" multi-buzz parallèle :
 *   - Plusieurs joueurs peuvent buzzer en parallèle, chacun ouvre sa
 *     fenêtre micro indépendante (10s par défaut).
 *   - Phase 1 : compétition libre, n'importe qui peut buzzer.
 *   - Phase 2 : 15s après la 1ʳᵉ bonne réponse — les autres ont encore
 *     le droit de buzzer pour les points dégressifs.
 *   - Phase 3 : phase festive — buzzers désactivés, musique continue
 *     jusqu'à la fin naturelle, master clique "Suivant" quand il veut.
 *   - Phase 3-no-reveal : skip-track (master) — pas de reveal du tout.
 *   - Phase 3-revealed   : master a cliqué "Donner la réponse" — reveal
 *                          + 0 pt à tous + musique continue.
 */

import type { GameTrackPhase } from '@tutti/shared';

export type { GameTrackPhase };

/** Buzz en cours pour un joueur (mic ouvert, en attente de l'audio). */
export interface ActiveBuzz {
  participant_id: string;
  buzzed_at_ms: number; // Date.now() au moment du buzz
  expires_at_ms: number; // buzzed_at_ms + buzz_window_seconds * 1000
}

/** Bonne réponse enregistrée pendant le track (pour scoring dégressif). */
export interface CorrectAnswer {
  participant_id: string;
  pseudo: string;
  team_id: string | null;
  /** Position dans l'ordre d'arrivée (1ʳᵉ = 1, 2ᵉ = 2, etc.). */
  position: number;
  /** Délai écoulé depuis le démarrage du track (ms). */
  answered_at_ms: number;
  matched_artist: boolean;
  matched_title: boolean;
  /** Score total attribué (base dégressive + bonus titre + bonus vitesse). */
  score: number;
  /** Refonte #4 — détail breakdown pour affichage clarifié UI. */
  score_position: number;
  score_title_bonus: number;
  score_speed_bonus: number;
}

export interface ActiveTrackState {
  round_id: string;
  track_index: number;
  track_id: string;
  /** Date.now() au lancement du track. */
  started_at_ms: number;
  /** Phase courante. */
  phase: GameTrackPhase;
  /**
   * Date.now() au démarrage de la phase 2 (1ʳᵉ bonne réponse). null tant
   * qu'on est en phase 1.
   */
  phase2_started_at_ms: number | null;
  /** Buzzes ouverts (non encore résolus par voice-answer). */
  active_buzzes: Map<string /* participant_id */, ActiveBuzz>;
  /** Bonnes réponses enregistrées dans l'ordre d'arrivée. */
  correct_answers: CorrectAnswer[];
  /**
   * Dernier buzz par participant (pour cooldown 1s anti-spam tap).
   * Pas pénalisant — juste un garde-fou technique.
   */
  last_buzz_at_ms: Map<string /* participant_id */, number>;
}

const activeTracks = new Map<string /* round_id */, ActiveTrackState>();

const PER_PARTICIPANT_BUZZ_COOLDOWN_MS = 1000;
const PHASE_2_DURATION_MS = 15_000;

export function getActiveTrack(roundId: string): ActiveTrackState | null {
  return activeTracks.get(roundId) ?? null;
}

export function setActiveTrack(
  roundId: string,
  init: Pick<ActiveTrackState, 'round_id' | 'track_index' | 'track_id' | 'started_at_ms'>,
): void {
  activeTracks.set(roundId, {
    ...init,
    phase: 'phase1',
    phase2_started_at_ms: null,
    active_buzzes: new Map(),
    correct_answers: [],
    last_buzz_at_ms: new Map(),
  });
}

/**
 * "Recommencer le morceau" — reset l'état pour repartir de phase1 sans
 * changer de track. Conserve track_id/track_index, vide buzzes/answers.
 * Renvoie le state remis à zéro ou null si pas de track actif.
 */
export function restartActiveTrack(roundId: string): ActiveTrackState | null {
  const state = activeTracks.get(roundId);
  if (!state) return null;
  const fresh: ActiveTrackState = {
    round_id: state.round_id,
    track_index: state.track_index,
    track_id: state.track_id,
    started_at_ms: Date.now(),
    phase: 'phase1',
    phase2_started_at_ms: null,
    active_buzzes: new Map(),
    correct_answers: [],
    last_buzz_at_ms: new Map(),
  };
  activeTracks.set(roundId, fresh);
  return fresh;
}

export function clearActiveTrack(roundId: string): void {
  activeTracks.delete(roundId);
}

/**
 * Vérifie si un participant peut ouvrir un nouveau buzz et, si oui,
 * enregistre le buzz. Retourne le buzz créé, ou null avec une raison.
 *
 * Multi-buzz parallèle = pas de blocage des autres participants. Le
 * cooldown 1s est PAR participant (anti-tap-répété).
 */
export function tryOpenBuzz(
  roundId: string,
  participantId: string,
  buzzWindowMs: number,
): { buzz: ActiveBuzz } | { error: 'NO_TRACK' | 'PHASE_LOCKED' | 'COOLDOWN' | 'ALREADY_BUZZING' } {
  const state = activeTracks.get(roundId);
  if (!state) return { error: 'NO_TRACK' };
  if (
    state.phase === 'phase3' ||
    state.phase === 'phase3-revealed' ||
    state.phase === 'phase3-skipped'
  ) {
    return { error: 'PHASE_LOCKED' };
  }
  const now = Date.now();
  const lastBuzz = state.last_buzz_at_ms.get(participantId);
  if (lastBuzz !== undefined && now - lastBuzz < PER_PARTICIPANT_BUZZ_COOLDOWN_MS) {
    return { error: 'COOLDOWN' };
  }
  // Si une fenêtre micro est déjà ouverte pour ce joueur, on refuse —
  // il finit son enregistrement courant d'abord.
  const existing = state.active_buzzes.get(participantId);
  if (existing && existing.expires_at_ms > now) {
    return { error: 'ALREADY_BUZZING' };
  }
  const buzz: ActiveBuzz = {
    participant_id: participantId,
    buzzed_at_ms: now,
    expires_at_ms: now + buzzWindowMs,
  };
  state.active_buzzes.set(participantId, buzz);
  state.last_buzz_at_ms.set(participantId, now);
  return { buzz };
}

/**
 * Ferme un buzz (mic fermé côté client, audio uploadé). Retourne le buzz
 * fermé pour calculer answered_at_ms. Si le buzz n'existe pas ou est déjà
 * expiré, retourne null.
 */
export function closeBuzz(roundId: string, participantId: string): ActiveBuzz | null {
  const state = activeTracks.get(roundId);
  if (!state) return null;
  const buzz = state.active_buzzes.get(participantId);
  if (!buzz) return null;
  state.active_buzzes.delete(participantId);
  return buzz;
}

/**
 * Vérifie si le participant a déjà une réponse correcte enregistrée pour
 * ce track. Si oui, on ne lui réattribue pas de points (un seul score
 * par track par joueur).
 */
export function hasCorrectAnswer(roundId: string, participantId: string): boolean {
  const state = activeTracks.get(roundId);
  if (!state) return false;
  return state.correct_answers.some((a) => a.participant_id === participantId);
}

/**
 * Enregistre une bonne réponse et retourne la position (1, 2, 3, ...) +
 * les infos pour calculer le score. Si c'est la 1ʳᵉ bonne réponse,
 * démarre la phase 2.
 */
export function registerCorrectAnswer(
  roundId: string,
  args: {
    participant_id: string;
    pseudo: string;
    team_id: string | null;
    matched_artist: boolean;
    matched_title: boolean;
    score: number;
    score_position: number;
    score_title_bonus: number;
    score_speed_bonus: number;
  },
): { entry: CorrectAnswer; isFirst: boolean } | null {
  const state = activeTracks.get(roundId);
  if (!state) return null;
  if (
    state.phase === 'phase3' ||
    state.phase === 'phase3-revealed' ||
    state.phase === 'phase3-skipped'
  ) {
    return null; // phase festive, plus de score
  }

  const now = Date.now();
  const isFirst = state.correct_answers.length === 0;

  // Démarrage phase 2 si c'est la 1ʳᵉ bonne réponse.
  if (isFirst) {
    state.phase = 'phase2';
    state.phase2_started_at_ms = now;
  } else {
    // Vérif que le buzz est arrivé pendant la phase 2 (pas plus de 15s
    // après la 1ʳᵉ bonne réponse).
    if (state.phase2_started_at_ms === null) return null;
    if (now - state.phase2_started_at_ms > PHASE_2_DURATION_MS) {
      // Phase 2 expirée → on n'enregistre pas de nouvelle bonne réponse
      // (le serveur va passer en phase 3 via un setTimeout, mais il y a
      // peut-être une race avec ce voice-answer arrivé tardivement).
      return null;
    }
  }

  const entry: CorrectAnswer = {
    participant_id: args.participant_id,
    pseudo: args.pseudo,
    team_id: args.team_id,
    position: state.correct_answers.length + 1,
    answered_at_ms: now - state.started_at_ms,
    matched_artist: args.matched_artist,
    matched_title: args.matched_title,
    score: args.score,
    score_position: args.score_position,
    score_title_bonus: args.score_title_bonus,
    score_speed_bonus: args.score_speed_bonus,
  };
  state.correct_answers.push(entry);
  return { entry, isFirst };
}

/** Passe en phase 3 (festive normal après expiration de la phase 2). */
export function setPhase3(roundId: string): boolean {
  const state = activeTracks.get(roundId);
  if (!state) return false;
  state.phase = 'phase3';
  return true;
}

/** Passe en phase 3-revealed (master a appuyé sur "Donner la réponse"). */
export function setPhase3Revealed(roundId: string): boolean {
  const state = activeTracks.get(roundId);
  if (!state) return false;
  state.phase = 'phase3-revealed';
  return true;
}

/** Passe en phase 3-skipped (master a appuyé sur "Sauter"). */
export function setPhase3Skipped(roundId: string): boolean {
  const state = activeTracks.get(roundId);
  if (!state) return false;
  state.phase = 'phase3-skipped';
  return true;
}

export const TIMINGS = {
  PHASE_2_DURATION_MS,
  PER_PARTICIPANT_BUZZ_COOLDOWN_MS,
};
