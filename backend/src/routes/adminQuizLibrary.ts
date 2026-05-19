/**
 * Routes /api/admin/library/quiz-packs/* — gestion super-admin de la
 * bibliothèque officielle Quizz Tutti.
 *
 *   - GET    /quiz-packs                                : liste + filtre visibility/q
 *   - GET    /quiz-packs/:id                            : détail + questions
 *   - PATCH  /quiz-packs/:id                            : update name/desc/visibility
 *   - PATCH  /quiz-packs/:packId/questions/:questionId  : update question media
 *     (feat/quiz-question-media)
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { MediaType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireSuperAdmin } from '../middleware/tenant.js';

const router: Router = Router();
router.use(requireAuth, requireSuperAdmin);

// ───── GET /quiz-packs ────────────────────────────────────────────────────

const listQuery = z.object({
  visibility: z.enum(['public', 'premium_only', 'private']).optional(),
  q: z.string().optional(),
});

router.get('/quiz-packs', async (req: Request, res: Response): Promise<void> => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'INVALID_QUERY', message: parsed.error.message } });
    return;
  }
  const { visibility, q } = parsed.data;
  const where: Record<string, unknown> = {};
  if (visibility) where.visibility = visibility;
  if (q && q.trim()) {
    const term = q.trim();
    where.OR = [
      { name_fr: { contains: term, mode: 'insensitive' } },
      { name_en: { contains: term, mode: 'insensitive' } },
      { category: { contains: term, mode: 'insensitive' } },
      { slug: { contains: term, mode: 'insensitive' } },
    ];
  }
  const packs = await prisma.officialQuizPack.findMany({
    where,
    orderBy: { updated_at: 'desc' },
    select: {
      id: true,
      slug: true,
      name_fr: true,
      name_en: true,
      category: true,
      difficulty: true,
      locale_primary: true,
      visibility: true,
      question_count: true,
      created_at: true,
      updated_at: true,
    },
  });
  res.json({ packs });
});

// ───── GET /quiz-packs/:id ────────────────────────────────────────────────

router.get(
  '/quiz-packs/:id',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const pack = await prisma.officialQuizPack.findUnique({
      where: { id: req.params.id },
      include: { questions: { orderBy: { position: 'asc' } } },
    });
    if (!pack) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pack introuvable' } });
      return;
    }
    res.json({ pack });
  },
);

// ───── PATCH /quiz-packs/:id ─────────────────────────────────────────────

const patchBody = z.object({
  name_fr: z.string().min(1).max(200).optional(),
  name_en: z.string().min(1).max(200).optional(),
  description_fr: z.string().max(2000).nullable().optional(),
  description_en: z.string().max(2000).nullable().optional(),
  visibility: z.enum(['public', 'premium_only', 'private']).optional(),
});

router.patch(
  '/quiz-packs/:id',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
      return;
    }
    const exists = await prisma.officialQuizPack.findUnique({ where: { id: req.params.id } });
    if (!exists) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pack introuvable' } });
      return;
    }
    const pack = await prisma.officialQuizPack.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    res.json({ pack });
  },
);

// ───── PATCH /quiz-packs/:packId/questions/:questionId ───────────────────
//
// feat/quiz-question-media — édition des champs média structurés d'une
// question (extrait audio/vidéo YouTube). Validation contraintes :
//   - media_type='AUDIO'|'VIDEO' → media_youtube_id requis (11 chars)
//   - media_type='NONE'|'IMAGE'  → tous les champs YT mis à null
//   - duration max 30s (UX gameplay quizz : on ne joue pas plus long)
//   - start_sec ≥ 0
//
// Pas de propagation vers les sessions déjà clonées (clone immutable
// post-launch). Re-lancer le pack après édition pour bénéficier des
// changements côté workspace Question.

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const patchQuestionBody = z
  .object({
    media_type: z.enum(['NONE', 'AUDIO', 'VIDEO', 'IMAGE']).optional(),
    media_youtube_id: z
      .string()
      .nullable()
      .optional()
      .refine((v) => v == null || YT_ID_RE.test(v), {
        message: 'youtube_id doit faire 11 caractères [A-Za-z0-9_-]',
      }),
    media_start_sec: z.number().int().min(0).max(86_400).nullable().optional(),
    media_duration_sec: z.number().int().min(1).max(30).nullable().optional(),
    media_url: z.string().url().nullable().optional(),
  })
  .refine(
    (v) => {
      if (v.media_type === 'AUDIO' || v.media_type === 'VIDEO') {
        return v.media_youtube_id !== null && v.media_youtube_id !== undefined;
      }
      return true;
    },
    { message: 'media_youtube_id requis quand media_type=AUDIO|VIDEO' },
  );

router.patch(
  '/quiz-packs/:packId/questions/:questionId',
  async (req: Request<{ packId: string; questionId: string }>, res: Response): Promise<void> => {
    const parsed = patchQuestionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
      return;
    }
    const exists = await prisma.officialQuizQuestion.findFirst({
      where: { id: req.params.questionId, pack_id: req.params.packId },
      select: { id: true },
    });
    if (!exists) {
      res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', message: 'Question introuvable dans ce pack' } });
      return;
    }
    // Si media_type passé à NONE/IMAGE → reset les champs YT structurés.
    const data: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.media_type === 'NONE' || parsed.data.media_type === 'IMAGE') {
      data.media_youtube_id = null;
      data.media_start_sec = null;
      data.media_duration_sec = null;
    }
    // Cast string → enum MediaType (Prisma exige l'enum exact).
    if (parsed.data.media_type) {
      data.media_type = parsed.data.media_type as MediaType;
    }
    const question = await prisma.officialQuizQuestion.update({
      where: { id: req.params.questionId },
      data,
    });
    res.json({ question });
  },
);

export default router;
