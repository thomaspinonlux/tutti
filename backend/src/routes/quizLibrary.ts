/**
 * Routes /api/library/quiz-packs/* — accès host à la bibliothèque officielle
 * Quizz Tutti. Lecture seule + endpoint de "lancement" qui crée un
 * QuestionSet clone côté workspace + une session game_type=QUIZZ.
 *
 *   GET  /quiz-packs                                : liste filtrable
 *   GET  /quiz-packs/:id                            : détail + questions
 *   POST /quiz-packs/:id/launch  { session_id? }   : clone + crée session
 *
 * Toutes les routes nécessitent auth (requireAuth + requireWorkspace).
 * + gating can_use_quizz côté backend.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Prisma, QuestionType, MediaType, GameType, GameMode, SessionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireWorkspace } from '../middleware/tenant.js';
import { generateUniqueShortCode } from '../lib/shortCode.js';

const router: Router = Router();
router.use(requireAuth, requireWorkspace);

// ───── GET /quiz-packs ────────────────────────────────────────────────────

const listQuery = z.object({
  locale: z.string().optional(),
  category: z.string().optional(),
  difficulty: z.enum(['easy', 'medium', 'expert', 'EASY', 'MEDIUM', 'EXPERT']).optional(),
});

router.get('/quiz-packs', async (req: Request, res: Response): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'userId manquant' } });
    return;
  }
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'INVALID_QUERY', message: parsed.error.message } });
    return;
  }
  const { locale, category, difficulty } = parsed.data;

  // Premium gating : même logique que playlists. V1 : tout public visible.
  // premium_only sera grisé côté UI si user pas premium ; private exclu.
  const member = await prisma.workspaceMember.findFirst({
    where: { user_id: req.userId, status: 'APPROVED' },
    include: { workspace: true },
  });
  const premium = member?.workspace.plan !== 'FREE' && member !== null;

  const where: Record<string, unknown> = {
    visibility: { in: ['public', 'premium_only'] },
  };
  if (locale) where.locale_primary = locale;
  if (category) where.category = category;
  if (difficulty) where.difficulty = difficulty.toUpperCase();

  const packs = await prisma.officialQuizPack.findMany({
    where,
    orderBy: { updated_at: 'desc' },
    select: {
      id: true,
      slug: true,
      name_fr: true,
      name_en: true,
      description_fr: true,
      description_en: true,
      locale_primary: true,
      category: true,
      difficulty: true,
      visibility: true,
      question_count: true,
      created_at: true,
      updated_at: true,
    },
  });

  res.json({
    packs: packs.map((p) => ({
      ...p,
      created_at: p.created_at.toISOString(),
      updated_at: p.updated_at.toISOString(),
      locked: p.visibility === 'premium_only' && !premium,
    })),
  });
});

// ───── GET /quiz-packs/:id ────────────────────────────────────────────────

router.get(
  '/quiz-packs/:id',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    if (!req.userId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'userId manquant' } });
      return;
    }
    const member = await prisma.workspaceMember.findFirst({
      where: { user_id: req.userId, status: 'APPROVED' },
      include: { workspace: true },
    });
    const premium = member?.workspace.plan !== 'FREE' && member !== null;

    const pack = await prisma.officialQuizPack.findUnique({
      where: { id: req.params.id },
      include: { questions: { orderBy: { position: 'asc' } } },
    });
    if (!pack) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pack introuvable' } });
      return;
    }
    if (pack.visibility === 'private') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pack inaccessible' } });
      return;
    }
    if (pack.visibility === 'premium_only' && !premium) {
      res.status(403).json({ error: { code: 'PREMIUM_REQUIRED', message: 'Plan premium requis' } });
      return;
    }
    res.json({
      pack: {
        ...pack,
        created_at: pack.created_at.toISOString(),
        updated_at: pack.updated_at.toISOString(),
        locked: false,
      },
    });
  },
);

// ───── POST /quiz-packs/:id/launch ────────────────────────────────────────
// Clone l'OfficialQuizPack en QuestionSet workspace-scoped + crée une
// session game_type=QUIZZ avec ce QuestionSet. La session est WAITING.

const launchBody = z.object({
  /** Optionnel : si fourni, attache le QuestionSet à une session existante.
   *  Sinon, crée une nouvelle session WAITING. V1 = create new. */
  language: z.enum(['fr', 'en']).default('fr'),
});

router.post(
  '/quiz-packs/:id/launch',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;
    const parsed = launchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
      return;
    }
    const { language } = parsed.data;

    // Gating can_use_quizz (defense in depth, déjà gated côté UI host).
    const member = await prisma.workspaceMember.findFirst({
      where: { user_id: userId },
      select: { can_use_quizz: true, workspace_id: true },
    });
    if (member && !member.can_use_quizz) {
      res.status(403).json({
        error: { code: 'QUIZZ_NOT_ALLOWED', message: 'Accès Quizz non autorisé' },
      });
      return;
    }

    // Charge pack + questions
    const pack = await prisma.officialQuizPack.findUnique({
      where: { id: req.params.id },
      include: { questions: { orderBy: { position: 'asc' } } },
    });
    if (!pack) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pack introuvable' } });
      return;
    }
    if (pack.questions.length === 0) {
      res.status(400).json({ error: { code: 'EMPTY_PACK', message: 'Pack sans question valide' } });
      return;
    }

    // Establishment du workspace
    const establishment = await prisma.establishment.findFirst({
      where: { workspace_id: workspaceId },
      orderBy: { created_at: 'asc' },
    });
    if (!establishment) {
      res.status(404).json({ error: { code: 'NO_ESTABLISHMENT', message: 'Aucun établissement' } });
      return;
    }

    // Cleanup zombies (cohérence avec POST /sessions)
    await prisma.session.updateMany({
      where: {
        establishment: { workspace_id: workspaceId },
        status: { in: ['WAITING', 'PLAYING'] },
      },
      data: { status: 'ENDED', ended_at: new Date(), is_paused: false },
    });

    // Clone QuestionSet workspace-scoped depuis le pack officiel
    const clonedSet = await prisma.questionSet.create({
      data: {
        establishment_id: establishment.id,
        name: pack.name_fr,
        description: pack.description_fr,
        is_bilingual: true,
        language_1: 'fr',
        language_2: 'en',
        is_generic: false,
        is_published: true,
      },
    });

    // Map des questions OfficialQuizQuestion → Question
    const questionsData: Prisma.QuestionCreateManyInput[] = pack.questions.map((q) => {
      let answer_lang1 = '';
      let answer_lang2 = '';
      let aliases_lang1: string[] = [];
      let aliases_lang2: string[] = [];
      if (q.type === QuestionType.MCQ) {
        // answer = la chaîne du choix correct
        const idx = q.correct_answer_index ?? 0;
        answer_lang1 = q.choices_fr[idx] ?? '';
        answer_lang2 = q.choices_en[idx] ?? '';
      } else if (q.type === QuestionType.TRUE_FALSE) {
        answer_lang1 = q.correct_answer_bool ? 'true' : 'false';
        answer_lang2 = q.correct_answer_bool ? 'true' : 'false';
      } else if (q.type === QuestionType.FREE_TEXT) {
        answer_lang1 = q.correct_answer_fr ?? '';
        answer_lang2 = q.correct_answer_en ?? '';
        aliases_lang1 = q.alternatives_fr;
        aliases_lang2 = q.alternatives_en;
      }
      // feat/quiz-question-media — propagation des champs média structurés
      // depuis l'OfficialQuizQuestion vers le clone workspace. Le gameplay
      // (RoundPlayingScreen mode QUIZZ) embed un IFrame YouTube qui joue
      // [media_start_sec, media_start_sec + media_duration_sec] si AUDIO|VIDEO.
      return {
        set_id: clonedSet.id,
        position: q.position,
        type: q.type,
        category: null,
        text_lang1: q.question_fr,
        text_lang2: q.question_en,
        choices_lang1: q.choices_fr,
        choices_lang2: q.choices_en,
        answer_lang1,
        answer_lang2,
        answer_aliases_lang1: aliases_lang1,
        answer_aliases_lang2: aliases_lang2,
        time_limit_sec: 30,
        points: 100,
        media_type: q.media_type ?? MediaType.NONE,
        media_url: q.media_url,
        media_youtube_id: q.media_youtube_id,
        media_start_sec: q.media_start_sec,
        media_duration_sec: q.media_duration_sec,
      };
    });
    await prisma.question.createMany({ data: questionsData });

    // Crée session game_type=QUIZZ avec ce question_set_id
    const shortCode = await generateUniqueShortCode(establishment.name);
    const session = await prisma.session.create({
      data: {
        establishment_id: establishment.id,
        name: pack.name_fr,
        game_type: GameType.QUIZZ,
        mode: GameMode.SOLO,
        language,
        question_set_id: clonedSet.id,
        has_animator: false,
        short_code: shortCode,
        status: SessionStatus.WAITING,
      },
    });

    res.json({
      session,
      question_set: {
        id: clonedSet.id,
        name: clonedSet.name,
        question_count: questionsData.length,
      },
      pack: { id: pack.id, slug: pack.slug },
    });
  },
);

export default router;
