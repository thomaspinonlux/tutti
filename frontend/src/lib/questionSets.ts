/**
 * Wrapper API /api/question-sets/* — CRUD packs de questions et questions
 * (Tutti Quizz, étape 15).
 */

import type {
  Question,
  QuestionMediaType,
  QuestionSet,
  QuestionSetWithQuestions,
  QuestionType,
} from '@tutti/shared';
import { api } from './api.js';

export async function listQuestionSets(): Promise<QuestionSet[]> {
  const data = await api<{ sets: QuestionSet[] }>('/api/question-sets');
  return data.sets;
}

export async function getQuestionSet(id: string): Promise<QuestionSetWithQuestions> {
  const data = await api<{ set: QuestionSetWithQuestions }>(
    `/api/question-sets/${encodeURIComponent(id)}`,
  );
  return data.set;
}

export interface CreateQuestionSetInput {
  name: string;
  description?: string;
  language_1?: 'fr' | 'en';
  is_bilingual?: boolean;
  language_2?: 'fr' | 'en';
}

export async function createQuestionSet(input: CreateQuestionSetInput): Promise<QuestionSet> {
  const data = await api<{ set: QuestionSet }>('/api/question-sets', {
    method: 'POST',
    body: input,
  });
  return data.set;
}

export interface UpdateQuestionSetInput {
  name?: string;
  description?: string | null;
  cover_url?: string | null;
  is_published?: boolean;
  is_bilingual?: boolean;
  language_1?: 'fr' | 'en';
  language_2?: 'fr' | 'en' | null;
}

export async function updateQuestionSet(
  id: string,
  input: UpdateQuestionSetInput,
): Promise<QuestionSet> {
  const data = await api<{ set: QuestionSet }>(`/api/question-sets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: input,
  });
  return data.set;
}

export async function deleteQuestionSet(id: string): Promise<void> {
  await api(`/api/question-sets/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ─── Questions ────────────────────────────────────────────────────────────

export interface CreateQuestionInput {
  type: QuestionType;
  category?: string | null;
  text_lang1: string;
  text_lang2?: string | null;
  choices_lang1?: string[];
  choices_lang2?: string[];
  answer_lang1: string;
  answer_lang2?: string | null;
  answer_aliases_lang1?: string[];
  answer_aliases_lang2?: string[];
  time_limit_sec?: number;
  points?: number;
  media_type?: QuestionMediaType;
  media_url?: string | null;
}

export async function createQuestion(setId: string, input: CreateQuestionInput): Promise<Question> {
  const data = await api<{ question: Question }>(
    `/api/question-sets/${encodeURIComponent(setId)}/questions`,
    { method: 'POST', body: input },
  );
  return data.question;
}

export async function updateQuestion(
  setId: string,
  questionId: string,
  input: Partial<CreateQuestionInput>,
): Promise<Question> {
  const data = await api<{ question: Question }>(
    `/api/question-sets/${encodeURIComponent(setId)}/questions/${encodeURIComponent(questionId)}`,
    { method: 'PATCH', body: input },
  );
  return data.question;
}

export async function deleteQuestion(setId: string, questionId: string): Promise<void> {
  await api(
    `/api/question-sets/${encodeURIComponent(setId)}/questions/${encodeURIComponent(questionId)}`,
    { method: 'DELETE' },
  );
}

export async function reorderQuestions(setId: string, questionIds: string[]): Promise<void> {
  await api(`/api/question-sets/${encodeURIComponent(setId)}/questions/reorder`, {
    method: 'PATCH',
    body: { questionIds },
  });
}
