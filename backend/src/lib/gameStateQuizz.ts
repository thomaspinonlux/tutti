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

import type { CurrentQuestionState, QuestionType } from '@tutti/shared';

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
  /** feat/quiz-pause — instant de la mise en pause (null = la question tourne). */
  paused_at_ms: number | null;
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
    paused_at_ms: null,
  };
  activeQuestions.set(sessionId, state);
  return state;
}

export function clearActiveQuestion(sessionId: string): void {
  activeQuestions.delete(sessionId);
  derniersEtats.delete(sessionId);
  dernieresRevelations.delete(sessionId);
}

// ── fix/quiz-telephone-qui-decroche — REPRISE APRÈS COUPURE ─────────────────
//
// Thomas, 08/11 : « si on sort de la page, cela met du temps à se reconnecter
// ou ne voit pas, et on ne peut pas répondre à la question ». Le téléphone ne
// recevait la question QUE par l'événement `quizz:question_start` : un joueur
// absent à cet instant (écran verrouillé, autre appli, réseau qui décroche)
// restait sur « en attente » jusqu'à la question suivante. On garde donc le
// dernier état diffusé et la dernière révélation, pour qu'un écran qui revient
// les redemande (GET /quizz/etat).

/** Révélation diffusée (`quizz:question_revealed`), telle quelle. */
export interface RevelationQuizz {
  question_index: number;
  reveal: { answer: string; answer_alt?: string };
  results: unknown[];
  details?: unknown;
}

const derniersEtats = new Map<string, CurrentQuestionState>();
const dernieresRevelations = new Map<string, RevelationQuizz>();

// ── feat/quiz-pause — PAUSE DU CHRONO ───────────────────────────────────────
//
// Thomas, 08/11 : « mets la pause, on ne sait jamais ». La pause fige le temps
// restant ; à la reprise, l'heure de départ est décalée de la durée de la
// pause : le chrono repart d'où il était et le bonus de rapidité reste juste.

/** Met la question en pause. Rend le temps restant (ms), ou null si impossible. */
export function pauserQuestion(sessionId: string): number | null {
  const state = activeQuestions.get(sessionId);
  if (!state || state.phase !== 'asking' || state.paused_at_ms !== null) return null;
  const maintenant = Date.now();
  state.paused_at_ms = maintenant;
  const restant = Math.max(0, state.started_at_ms + state.time_limit_ms - maintenant);
  const etat = derniersEtats.get(sessionId);
  if (etat && etat.question_index === state.question_index) {
    derniersEtats.set(sessionId, { ...etat, en_pause: true, restant_ms: restant });
  }
  return restant;
}

/** Reprend la question. Rend le nouvel instant de départ et le temps restant. */
export function reprendreQuestion(
  sessionId: string,
): { started_at: string; restant_ms: number } | null {
  const state = activeQuestions.get(sessionId);
  if (!state || state.phase !== 'asking' || state.paused_at_ms === null) return null;
  const maintenant = Date.now();
  state.started_at_ms += maintenant - state.paused_at_ms;
  state.paused_at_ms = null;
  const restant = Math.max(0, state.started_at_ms + state.time_limit_ms - maintenant);
  // Heure de départ « vue par les écrans » : même décalage, pour que leur
  // chrono affiche le même temps restant que le serveur.
  const started_at = new Date(maintenant + restant - state.time_limit_ms).toISOString();
  const etat = derniersEtats.get(sessionId);
  if (etat && etat.question_index === state.question_index) {
    derniersEtats.set(sessionId, { ...etat, started_at, en_pause: false, restant_ms: undefined });
  }
  return { started_at, restant_ms: restant };
}

export function memoriserEtat(sessionId: string, state: CurrentQuestionState): void {
  derniersEtats.set(sessionId, state);
  dernieresRevelations.delete(sessionId);
}

export function memoriserRevelation(sessionId: string, revelation: RevelationQuizz): void {
  dernieresRevelations.set(sessionId, revelation);
}

/**
 * Ce qu'un écran qui revient doit afficher : la question en cours (avec sa
 * phase réelle), la révélation si elle a eu lieu, et — pour un joueur — la
 * réponse qu'il a déjà envoyée. Rien de secret avant la révélation.
 */
export function etatPourReprise(
  sessionId: string,
  participantId: string | null,
): { state: CurrentQuestionState | null; revelation: RevelationQuizz | null; ma_reponse: string | null } {
  const etat = derniersEtats.get(sessionId) ?? null;
  const active = activeQuestions.get(sessionId) ?? null;
  if (!etat || !active || active.question_index !== etat.question_index) {
    return { state: null, revelation: null, ma_reponse: null };
  }
  const revelation = active.phase === 'revealed' ? (dernieresRevelations.get(sessionId) ?? null) : null;
  return {
    state: { ...etat, phase: active.phase, ...(revelation ? { reveal: revelation.reveal } : {}) },
    revelation,
    ma_reponse: participantId ? (active.answers.get(participantId)?.value ?? null) : null,
  };
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
  | { ok: false; reason: 'NO_QUESTION' | 'PHASE_LOCKED' | 'TIME_EXPIRED' | 'ALREADY_ANSWERED' | 'PAUSED' } {
  const state = activeQuestions.get(sessionId);
  if (!state) return { ok: false, reason: 'NO_QUESTION' };
  if (state.phase !== 'asking') return { ok: false, reason: 'PHASE_LOCKED' };
  if (state.paused_at_ms !== null) return { ok: false, reason: 'PAUSED' };
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
