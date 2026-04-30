/**
 * Matching de réponse pour les questions Tutti Quizz.
 *
 * Selon le QuestionType :
 *   - MCQ        : index dans choices_lang1 (string "0", "1", "2", "3")
 *                  OU le texte exact d'un choix.
 *   - TRUE_FALSE : "true" | "false" (case-insensitive).
 *   - FREE_TEXT  : normalize (lowercase, accents, ponctuation virée) puis
 *                  matche contre answer_lang1 + answer_aliases_lang1
 *                  (ou _lang2 si le joueur joue en langue 2).
 *   - ESTIMATION : answer_lang1 contient un JSON {target, min, max, unit}.
 *                  La distance normalisée (|submitted - target| / range) est
 *                  retournée pour le scoring gradué.
 */

import type { Question, QuestionType, EstimationAnswer } from '@tutti/shared';

// ── Normalisation FREE_TEXT (cf. lib/voiceMatch.ts pour cohérence) ─────────

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

/** Distance normalisée 0..1, < 0.2 considérée comme match pour FREE_TEXT. */
const FREE_TEXT_THRESHOLD = 0.2;

// ── Matching par type ─────────────────────────────────────────────────────

export interface MatchResult {
  is_correct: boolean;
  /** ESTIMATION uniquement : 0 = exact, 1 = hors range. */
  estimation_distance?: number;
}

export function matchAnswer(
  question: Pick<
    Question,
    | 'type'
    | 'answer_lang1'
    | 'answer_lang2'
    | 'answer_aliases_lang1'
    | 'answer_aliases_lang2'
    | 'choices_lang1'
    | 'choices_lang2'
  >,
  submitted: string,
  language: 'lang1' | 'lang2' = 'lang1',
): MatchResult {
  const type = question.type as QuestionType;

  if (type === 'MCQ') {
    const choices =
      language === 'lang2' && question.choices_lang2.length > 0
        ? question.choices_lang2
        : question.choices_lang1;
    const expected =
      language === 'lang2' && question.answer_lang2 ? question.answer_lang2 : question.answer_lang1;
    // Le client peut envoyer soit l'index ("0"), soit le texte du choix.
    const idx = Number.parseInt(submitted, 10);
    if (!Number.isNaN(idx) && idx >= 0 && idx < choices.length) {
      const submittedText = choices[idx]!;
      return { is_correct: normalize(submittedText) === normalize(expected) };
    }
    return { is_correct: normalize(submitted) === normalize(expected) };
  }

  if (type === 'TRUE_FALSE') {
    const expected =
      language === 'lang2' && question.answer_lang2 ? question.answer_lang2 : question.answer_lang1;
    return { is_correct: submitted.toLowerCase().trim() === expected.toLowerCase().trim() };
  }

  if (type === 'FREE_TEXT') {
    const expected =
      language === 'lang2' && question.answer_lang2 ? question.answer_lang2 : question.answer_lang1;
    const aliases =
      language === 'lang2' ? question.answer_aliases_lang2 : question.answer_aliases_lang1;
    const candidates = [expected, ...aliases].map(normalize).filter((s) => s.length > 0);
    const submittedNorm = normalize(submitted);
    if (!submittedNorm) return { is_correct: false };
    for (const candidate of candidates) {
      const dist = levenshtein(submittedNorm, candidate);
      const max = Math.max(submittedNorm.length, candidate.length);
      const ratio = dist / max;
      if (ratio < FREE_TEXT_THRESHOLD) {
        return { is_correct: true };
      }
    }
    return { is_correct: false };
  }

  if (type === 'ESTIMATION') {
    let meta: EstimationAnswer | null = null;
    try {
      meta = JSON.parse(question.answer_lang1) as EstimationAnswer;
    } catch {
      return { is_correct: false, estimation_distance: 1 };
    }
    if (
      typeof meta.target !== 'number' ||
      typeof meta.min !== 'number' ||
      typeof meta.max !== 'number'
    ) {
      return { is_correct: false, estimation_distance: 1 };
    }
    const submittedNum = Number.parseFloat(submitted.replace(',', '.'));
    if (Number.isNaN(submittedNum)) {
      return { is_correct: false, estimation_distance: 1 };
    }
    // Distance normalisée par la plage. Si réponse hors plage, on borne à 1.
    const range = Math.max(1, meta.max - meta.min);
    const diff = Math.abs(submittedNum - meta.target);
    const distance = Math.min(1, diff / range);
    // Un score est attribué dès qu'on est dans la range. is_correct = true
    // si distance < 0.5 (la moitié de la range, arbitraire mais raisonnable).
    return { is_correct: distance < 0.5, estimation_distance: distance };
  }

  return { is_correct: false };
}
