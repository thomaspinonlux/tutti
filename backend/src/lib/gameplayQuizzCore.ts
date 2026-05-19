/**
 * Helpers métier partagés Tutti Quizz V0 — utilisés par les routes host
 * (gameplayQuizz.ts) ET master (sessionMaster.ts → quizz/*).
 *
 * Logique :
 *   - findQuestionAtIndex   : récupère une Question DB par (set_id, position)
 *   - buildAndBroadcastQuestion : construit le CurrentQuestionState + broadcast
 *                                 quizz:question_start
 *   - scheduleAutoReveal    : programme le timeout serveur d'auto-reveal
 *   - clearAutoReveal       : annule le timeout
 *   - revealCurrentQuestion : passe la question en revealed, score les réponses,
 *                             persiste les ScoreEvents, broadcast le reveal
 *
 * V0 : pas de SessionRound pour QUIZZ — on travaille directement sur
 * Session.question_set_id et un index incrémental.
 */

import { ScoreEventType, type Question } from '@prisma/client';
import type { CurrentQuestionState, QuestionType } from '@tutti/shared';
import { prisma } from './prisma.js';
import { broadcastToSession } from '../socket/index.js';
import { getActiveQuestion, revealAnswers } from './gameStateQuizz.js';
import { computeQuestionScore } from './quizzScoring.js';
import { matchAnswer } from './quizzMatch.js';

// Stockage des timers d'auto-reveal par session_id.
const revealTimers = new Map<string, NodeJS.Timeout>();

export async function findQuestionAtIndex(
  questionSetId: string,
  index: number,
): Promise<Question | null> {
  return prisma.question.findFirst({
    where: { set_id: questionSetId, position: index },
  });
}

/**
 * Construit le CurrentQuestionState à partir d'une Question DB et du
 * is_bilingual du set, puis broadcast 'quizz:question_start'.
 *
 * Pour les questions ESTIMATION, parse answer_lang1 en JSON pour exposer
 * estimation_min/max/unit aux clients (sans révéler target).
 */
export function buildAndBroadcastQuestion(
  sessionId: string,
  question: Question,
  isBilingual: boolean,
): CurrentQuestionState {
  const state: CurrentQuestionState = {
    round_id: '', // pas de round V0 pour QUIZZ
    question_index: question.position,
    question_id: question.id,
    text: question.text_lang1,
    text_alt: isBilingual ? (question.text_lang2 ?? undefined) : undefined,
    type: question.type as QuestionType,
    category: question.category,
    choices: question.choices_lang1,
    choices_alt: isBilingual ? question.choices_lang2 : undefined,
    media_type: question.media_type as CurrentQuestionState['media_type'],
    media_url: question.media_url,
    media_youtube_id: question.media_youtube_id,
    media_start_sec: question.media_start_sec,
    media_duration_sec: question.media_duration_sec,
    started_at: new Date().toISOString(),
    time_limit_sec: question.time_limit_sec,
    points: question.points,
    phase: 'asking',
  };

  if (question.type === 'ESTIMATION') {
    try {
      const meta = JSON.parse(question.answer_lang1) as {
        target?: number;
        min?: number;
        max?: number;
        unit?: string;
      };
      state.estimation_min = meta.min;
      state.estimation_max = meta.max;
      state.estimation_unit = meta.unit;
    } catch {
      /* fallback : pas de bornes */
    }
  }

  broadcastToSession(sessionId, 'quizz:question_start', { state });
  return state;
}

export function scheduleAutoReveal(
  sessionId: string,
  timeLimitMs: number,
  doReveal: () => void,
): void {
  const existing = revealTimers.get(sessionId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    revealTimers.delete(sessionId);
    doReveal();
  }, timeLimitMs);
  revealTimers.set(sessionId, timer);
}

export function clearAutoReveal(sessionId: string): void {
  const existing = revealTimers.get(sessionId);
  if (existing) {
    clearTimeout(existing);
    revealTimers.delete(sessionId);
  }
}

/**
 * Reveal de la question active : applique le scoring, persiste les
 * ScoreEvent CORRECT_ANSWER (pour les bonnes réponses uniquement, V0),
 * broadcast quizz:question_revealed avec results triés.
 */
export async function revealCurrentQuestion(sessionId: string): Promise<void> {
  clearAutoReveal(sessionId);
  const active = getActiveQuestion(sessionId);
  if (!active || active.phase === 'revealed') return;

  const question = await prisma.question.findUnique({ where: { id: active.question_id } });
  if (!question) return;

  // V0 simple : on score toujours en langue 1 (lang1).
  const playerLang = 'lang1' as const;
  const state = revealAnswers(
    sessionId,
    ({ value, submitted_at_ms, started_at_ms, time_limit_ms, base_points }) => {
      const matchResult = matchAnswer(question, value, playerLang);
      const score = computeQuestionScore({
        is_correct: matchResult.is_correct,
        estimation_distance: matchResult.estimation_distance,
        base_points,
        submitted_at_ms,
        started_at_ms,
        time_limit_ms,
      });
      return { is_correct: score.is_correct, score: score.score };
    },
  );
  if (!state) return;

  const participants = await prisma.participant.findMany({
    where: { session_id: sessionId, is_kicked: false },
    select: { id: true, pseudo: true, team_id: true },
  });
  const participantsById = new Map(participants.map((p) => [p.id, p]));

  const events: Promise<unknown>[] = [];
  for (const ans of state.answers.values()) {
    if (ans.score && ans.score > 0) {
      const p = participantsById.get(ans.participant_id);
      events.push(
        prisma.scoreEvent.create({
          data: {
            session_id: sessionId,
            session_round_id: null,
            participant_id: ans.participant_id,
            team_id: p?.team_id ?? null,
            round_index: state.question_index,
            type: ScoreEventType.CORRECT_ANSWER,
            points: ans.score,
            answer: ans.value.slice(0, 200),
          },
        }),
      );
    }
  }
  await Promise.all(events);

  const results = [...state.answers.values()].map((ans) => {
    const p = participantsById.get(ans.participant_id);
    return {
      participant_id: ans.participant_id,
      pseudo: p?.pseudo ?? '?',
      team_id: p?.team_id ?? null,
      is_correct: ans.is_correct ?? false,
      answered_at_ms: ans.submitted_at_ms - state.started_at_ms,
      score: ans.score ?? 0,
      submitted: ans.value,
    };
  });
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.answered_at_ms - b.answered_at_ms;
  });

  const reveal = {
    answer: question.answer_lang1,
    answer_alt: question.answer_lang2 ?? undefined,
  };

  broadcastToSession(sessionId, 'quizz:question_revealed', {
    question_index: state.question_index,
    reveal,
    results,
  });
}
