/**
 * État applicatif en mémoire pour la boucle de jeu Tutti Quizz (étape 15).
 *
 * V0 : pas de SessionRound pour QUIZZ — la session.question_set_id est la
 * référence directe. On track la question en cours par session_id.
 *
 * Phases d'une question :
 *   - asking   : tous les joueurs peuvent soumettre leur réponse
 *   - revealed : la réponse est révélée + scores affichés
 *
 * Une question passe en 'revealed' soit :
 *   - quand tous les joueurs ont soumis (auto-advance)
 *   - quand le timer time_limit_sec expire
 *   - quand le master clique "Révéler maintenant"
 *
 * V0 : 1 process Railway = OK. Si crash, état perdu (master relance).
 */

import type { QuestionType } from '@tutti/shared';

export type QuizzPhase = 'asking' | 'revealed';

export interface ActiveAnswer {
  participant_id: string;
  /** Valeur soumise (string brute — interprétée selon le QuestionType). */
  value: string;
  submitted_at_ms: number;
  /** Calculé après reveal. */
  is_correct?: boolean;
  /** Calculé après reveal. */
  score?: number;
}

export interface ActiveQuestionState {
  session_id: string;
  question_index: number;
  question_id: string;
  question_type: QuestionType;
  /** Date.now() au lancement de la question. */
  started_at_ms: number;
  /** Durée totale autorisée (ms). */
  time_limit_ms: number;
  /** Points base de la question. */
  points: number;
  phase: QuizzPhase;
  /** Réponses soumises (1 par participant max). */
  answers: Map<string /* participant_id */, ActiveAnswer>;
  /**
   * Set des participants connus au moment du démarrage de la question.
   * Permet de détecter "tout le monde a répondu" → auto-reveal.
   */
  expected_participants: Set<string>;
}

const activeQuestions = new Map<string /* session_id */, ActiveQuestionState>();

export function getActiveQuestion(sessionId: string): ActiveQuestionState | null {
  return activeQuestions.get(sessionId) ?? null;
}

export function setActiveQuestion(
  sessionId: string,
  init: {
    question_index: number;
    question_id: string;
    question_type: QuestionType;
    time_limit_ms: number;
    points: number;
    expected_participants: string[];
  },
): ActiveQuestionState {
  const state: ActiveQuestionState = {
    session_id: sessionId,
    question_index: init.question_index,
    question_id: init.question_id,
    question_type: init.question_type,
    started_at_ms: Date.now(),
    time_limit_ms: init.time_limit_ms,
    points: init.points,
    phase: 'asking',
    answers: new Map(),
    expected_participants: new Set(init.expected_participants),
  };
  activeQuestions.set(sessionId, state);
  return state;
}

export function clearActiveQuestion(sessionId: string): void {
  activeQuestions.delete(sessionId);
}

/**
 * Tente de soumettre une réponse. Refuse si :
 *   - pas de question active
 *   - phase 'revealed' (trop tard)
 *   - timer expiré
 *   - le joueur a déjà répondu
 */
export function trySubmitAnswer(
  sessionId: string,
  participantId: string,
  value: string,
):
  | { ok: true; allAnswered: boolean }
  | { ok: false; reason: 'NO_QUESTION' | 'PHASE_LOCKED' | 'TIME_EXPIRED' | 'ALREADY_ANSWERED' } {
  const state = activeQuestions.get(sessionId);
  if (!state) return { ok: false, reason: 'NO_QUESTION' };
  if (state.phase !== 'asking') return { ok: false, reason: 'PHASE_LOCKED' };
  const now = Date.now();
  if (now - state.started_at_ms > state.time_limit_ms) {
    return { ok: false, reason: 'TIME_EXPIRED' };
  }
  if (state.answers.has(participantId)) return { ok: false, reason: 'ALREADY_ANSWERED' };

  state.answers.set(participantId, {
    participant_id: participantId,
    value,
    submitted_at_ms: now,
  });

  // Vérifie si tous les participants attendus ont répondu (auto-reveal).
  const allAnswered = [...state.expected_participants].every((pid) => state.answers.has(pid));
  return { ok: true, allAnswered };
}

/**
 * Passe la phase à 'revealed' et applique le scoring (mutate state.answers
 * pour ajouter is_correct + score). Le scorer prend la valeur soumise et
 * retourne is_correct + points.
 */
export function revealAnswers(
  sessionId: string,
  scorer: (input: {
    value: string;
    submitted_at_ms: number;
    started_at_ms: number;
    time_limit_ms: number;
    base_points: number;
  }) => { is_correct: boolean; score: number },
): ActiveQuestionState | null {
  const state = activeQuestions.get(sessionId);
  if (!state) return null;
  state.phase = 'revealed';
  for (const ans of state.answers.values()) {
    const result = scorer({
      value: ans.value,
      submitted_at_ms: ans.submitted_at_ms,
      started_at_ms: state.started_at_ms,
      time_limit_ms: state.time_limit_ms,
      base_points: state.points,
    });
    ans.is_correct = result.is_correct;
    ans.score = result.score;
  }
  return state;
}
