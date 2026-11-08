/**
 * feat/quiz-pause — applique l'événement `quizz:pause` à la question affichée,
 * et calcule le temps restant (figé pendant la pause).
 */
import type { CurrentQuestionState } from '@tutti/shared';

export interface MessagePause {
  question_index: number;
  en_pause: boolean;
  restant_ms: number;
  started_at?: string;
}

export function appliquerPause(
  q: CurrentQuestionState | null,
  m: MessagePause,
): CurrentQuestionState | null {
  if (!q || q.question_index !== m.question_index) return q;
  return m.en_pause
    ? { ...q, en_pause: true, restant_ms: m.restant_ms }
    : { ...q, en_pause: false, restant_ms: undefined, started_at: m.started_at ?? q.started_at };
}

/** Temps restant (ms) d'une question, pause comprise. */
export function tempsRestantMs(q: CurrentQuestionState, maintenant: number): number {
  if (q.en_pause) return Math.max(0, q.restant_ms ?? 0);
  return Math.max(0, new Date(q.started_at).getTime() + q.time_limit_sec * 1000 - maintenant);
}
