/**
 * scripts/import-official-quiz.ts
 *
 * Import bibliothèque officielle Quizz Tutti — feat/official-quiz-library.
 *
 * Lit récursivement data/official-library/quizz/ (sous-dossiers inclus,
 * fichiers .json) et upsert chaque pack + questions associées dans la DB
 * (OfficialQuizPack + OfficialQuizQuestion).
 *
 * Format JSON source attendu (top-level) :
 *   - id (= slug), name_fr, name_en, description_fr/en, category,
 *     difficulty (mix/easy/medium/hard), locale_primary, question_count
 *   - questions[] : position, type (multiple_choice|true_false|fill_blank),
 *     question_fr/en, answers_fr/en (MCQ), correct_answer_index (MCQ),
 *     correct_answer (TRUE_FALSE bool),
 *     correct_answer_fr/en + alternatives_fr/en (FILL_BLANK),
 *     explanation_fr/en, difficulty, media (null|url)
 *
 * Validation : skip + log warn pour question avec champs obligatoires
 * manquants (question_fr/en + type + réponse correcte).
 *
 * Usage : pnpm --filter @tutti/backend run import:official-quiz
 *
 * Variables d'env : DATABASE_URL / DIRECT_URL.
 */

import 'dotenv/config';
import * as dotenv from 'dotenv';
import { join, basename } from 'node:path';
import { readFile, readdir, stat } from 'node:fs/promises';
import { Prisma, QuestionType } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';

dotenv.config({
  path: join(process.cwd(), '..', 'credentials.env.local'),
  override: false,
});

type DifficultyDb = 'EASY' | 'MEDIUM' | 'EXPERT';

interface SourceQuestion {
  position: number;
  type: 'multiple_choice' | 'true_false' | 'fill_blank' | string;
  question_fr: string;
  question_en: string;
  answers_fr?: string[];
  answers_en?: string[];
  correct_answer_index?: number;
  correct_answer?: boolean;
  correct_answer_fr?: string;
  correct_answer_en?: string;
  alternatives_fr?: string[];
  alternatives_en?: string[];
  explanation_fr?: string;
  explanation_en?: string;
  difficulty?: string;
  media?: string | null;
}

interface SourcePack {
  id?: string;
  slug?: string;
  name_fr: string;
  name_en: string;
  description_fr?: string | null;
  description_en?: string | null;
  locale_primary: string;
  category?: string | null;
  difficulty?: string;
  visibility?: 'public' | 'premium_only' | 'private';
  question_count?: number;
  questions: SourceQuestion[];
}

interface FileReport {
  filename: string;
  slug: string;
  total: number;
  inserted: number;
  rejected: number;
  rejectReasons: string[];
}

const QUIZ_DIR = join(process.cwd(), 'data', 'official-library', 'quizz');

function normalizeDifficulty(d: string | undefined): DifficultyDb {
  if (!d) return 'MEDIUM';
  const u = d.toUpperCase();
  if (u === 'EASY' || u === 'MEDIUM' || u === 'EXPERT') return u;
  if (u === 'HARD') return 'EXPERT'; // mapping JSON 'hard' → DB 'EXPERT'
  if (u === 'MIX') return 'MEDIUM';
  return 'MEDIUM';
}

function mapType(t: string): QuestionType | null {
  switch (t) {
    case 'multiple_choice':
      return QuestionType.MCQ;
    case 'true_false':
      return QuestionType.TRUE_FALSE;
    case 'fill_blank':
      return QuestionType.FREE_TEXT;
    default:
      return null;
  }
}

/** Liste récursive des fichiers .json sous quiz/ (descend sous-dossiers). */
async function collectJsonFiles(dir: string, acc: string[] = []): Promise<string[]> {
  const entries = await readdir(dir);
  for (const e of entries) {
    const full = join(dir, e);
    const s = await stat(full);
    if (s.isDirectory()) {
      await collectJsonFiles(full, acc);
    } else if (e.endsWith('.json')) {
      acc.push(full);
    }
  }
  return acc;
}

function validateQuestion(q: SourceQuestion): string | null {
  if (!q.position || typeof q.position !== 'number') return 'position manquante';
  if (!q.question_fr || !q.question_en) return 'question_fr/en manquant';
  const type = mapType(q.type);
  if (!type) return `type invalide ('${q.type}')`;
  if (type === QuestionType.MCQ) {
    if (!Array.isArray(q.answers_fr) || q.answers_fr.length < 2) {
      return 'MCQ : answers_fr < 2';
    }
    if (typeof q.correct_answer_index !== 'number') {
      return 'MCQ : correct_answer_index manquant';
    }
  } else if (type === QuestionType.TRUE_FALSE) {
    if (typeof q.correct_answer !== 'boolean') {
      return 'TRUE_FALSE : correct_answer (bool) manquant';
    }
  } else if (type === QuestionType.FREE_TEXT) {
    if (!q.correct_answer_fr || !q.correct_answer_en) {
      return 'FILL_BLANK : correct_answer_fr/en manquant';
    }
  }
  return null;
}

async function processFile(filePath: string): Promise<FileReport> {
  const filename = basename(filePath);
  const raw = await readFile(filePath, 'utf-8');
  const source = JSON.parse(raw) as SourcePack;
  const slug = source.slug ?? source.id ?? '';
  if (!slug || !Array.isArray(source.questions)) {
    throw new Error(`${filename}: format invalide (slug/id ou questions manquant)`);
  }

  const report: FileReport = {
    filename,
    slug,
    total: source.questions.length,
    inserted: 0,
    rejected: 0,
    rejectReasons: [],
  };

  // Filter + map valid questions
  const validQuestions: Array<{ q: SourceQuestion; type: QuestionType }> = [];
  for (const q of source.questions) {
    const err = validateQuestion(q);
    if (err) {
      report.rejected += 1;
      report.rejectReasons.push(`#${q.position ?? '?'} ${err}`);
      console.warn(`[Quiz] ${slug} #${q.position}: ${err}`);
      continue;
    }
    const type = mapType(q.type)!;
    validQuestions.push({ q, type });
  }

  // Upsert pack
  const packData = {
    name_fr: source.name_fr,
    name_en: source.name_en,
    description_fr: source.description_fr ?? null,
    description_en: source.description_en ?? null,
    locale_primary: source.locale_primary,
    category: source.category ?? null,
    difficulty: normalizeDifficulty(source.difficulty),
    visibility: source.visibility ?? 'public',
    question_count: validQuestions.length,
  };
  const pack = await prisma.officialQuizPack.upsert({
    where: { slug },
    create: { slug, ...packData },
    update: packData,
  });

  // Replace questions (delete + createMany pour idempotence)
  await prisma.officialQuizQuestion.deleteMany({ where: { pack_id: pack.id } });
  if (validQuestions.length > 0) {
    await prisma.officialQuizQuestion.createMany({
      data: validQuestions.map(({ q, type }) => ({
        pack_id: pack.id,
        position: q.position,
        type,
        question_fr: q.question_fr,
        question_en: q.question_en,
        choices_fr: type === QuestionType.MCQ ? (q.answers_fr ?? []) : [],
        choices_en: type === QuestionType.MCQ ? (q.answers_en ?? []) : [],
        correct_answer_index: type === QuestionType.MCQ ? (q.correct_answer_index ?? null) : null,
        correct_answer_bool: type === QuestionType.TRUE_FALSE ? (q.correct_answer ?? null) : null,
        correct_answer_fr: type === QuestionType.FREE_TEXT ? (q.correct_answer_fr ?? null) : null,
        correct_answer_en: type === QuestionType.FREE_TEXT ? (q.correct_answer_en ?? null) : null,
        alternatives_fr: type === QuestionType.FREE_TEXT ? (q.alternatives_fr ?? []) : [],
        alternatives_en: type === QuestionType.FREE_TEXT ? (q.alternatives_en ?? []) : [],
        explanation_fr: q.explanation_fr ?? null,
        explanation_en: q.explanation_en ?? null,
        difficulty: normalizeDifficulty(q.difficulty),
        media_url: q.media ?? null,
      })) as Prisma.OfficialQuizQuestionCreateManyInput[],
    });
  }

  report.inserted = validQuestions.length;
  return report;
}

function printReport(reports: FileReport[], durationMs: number): void {
  console.info('\n══════════════════════════════════════════════════════════════════════');
  console.info('  RAPPORT FINAL — IMPORT BIBLIOTHÈQUE QUIZZ OFFICIELLE TUTTI');
  console.info('══════════════════════════════════════════════════════════════════════\n');
  let totalQ = 0;
  let totalIns = 0;
  let totalRej = 0;
  for (const r of reports) {
    totalQ += r.total;
    totalIns += r.inserted;
    totalRej += r.rejected;
    console.info(`📁 ${r.filename}  (slug: ${r.slug})`);
    console.info(`   Questions : ${r.total} total, ${r.inserted} insérées, ${r.rejected} rejetées`);
    if (r.rejectReasons.length > 0) {
      for (const reason of r.rejectReasons) {
        console.info(`   ⚠️ ${reason}`);
      }
    }
    console.info('');
  }
  console.info('──────────────────────────────────────────────────────────────────────');
  console.info(`  TOTAL  : ${reports.length} packs, ${totalQ} questions`);
  console.info(`  Insérées : ${totalIns}, Rejetées : ${totalRej}`);
  console.info(`  Durée : ${(durationMs / 1000).toFixed(1)}s`);
  console.info('══════════════════════════════════════════════════════════════════════\n');
}

async function main(): Promise<void> {
  console.info(`[Quiz] Lecture des packs dans ${QUIZ_DIR}\n`);
  const startedAt = Date.now();
  const files = await collectJsonFiles(QUIZ_DIR);
  console.info(`[Quiz] ${files.length} fichiers JSON trouvés\n`);
  const reports: FileReport[] = [];
  for (const f of files) {
    try {
      const r = await processFile(f);
      reports.push(r);
    } catch (err) {
      console.error(`[FATAL] ${basename(f)} a échoué:`, err);
    }
  }
  printReport(reports, Date.now() - startedAt);
}

main()
  .catch((err) => {
    console.error('[FATAL]', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
