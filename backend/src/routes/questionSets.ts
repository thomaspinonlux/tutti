/**
 * Routes /api/question-sets/* — CRUD packs de questions et questions
 * (Tutti Quizz, étape 15).
 *
 *   GET    /                          : liste packs du tenant + count
 *   POST   /                          : crée un nouveau pack
 *   GET    /:id                       : détails pack + questions ordonnées
 *   PATCH  /:id                       : édit name/description/bilingue/published
 *   DELETE /:id                       : supprime
 *
 *   POST   /:id/questions             : ajoute une question
 *   PATCH  /:id/questions/reorder     : nouvel ordre via { questionIds: [...] }
 *   PATCH  /:id/questions/:qid        : édit une question
 *   DELETE /:id/questions/:qid        : supprime une question
 *
 * Multi-tenant strict : tous les endpoints vérifient que le pack appartient
 * à un establishment du workspace courant. Les packs avec is_generic=true
 * et establishment_id=null seront partagés (V1.1, pas encore traités ici).
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { QuestionType, MediaType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireWorkspace } from '../middleware/tenant.js';

const router: Router = Router();

router.use(requireAuth, requireWorkspace);

// ─── Helpers ──────────────────────────────────────────────────────────────

async function getCurrentEstablishment(workspaceId: string): Promise<{ id: string } | null> {
  return prisma.establishment.findFirst({
    where: { workspace_id: workspaceId },
    orderBy: { created_at: 'asc' },
    select: { id: true },
  });
}

async function ensureOwnSet(setId: string, workspaceId: string) {
  return prisma.questionSet.findFirst({
    where: {
      id: setId,
      establishment: { workspace_id: workspaceId },
    },
    select: { id: true, establishment_id: true },
  });
}

// ─── GET / — liste ────────────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.workspaceId!;
  try {
    const sets = await prisma.questionSet.findMany({
      where: { establishment: { workspace_id: workspaceId } },
      orderBy: { created_at: 'desc' },
      include: { _count: { select: { questions: true } } },
    });
    res.json({
      sets: sets.map((s) => ({
        id: s.id,
        establishment_id: s.establishment_id,
        name: s.name,
        description: s.description,
        cover_url: s.cover_url,
        is_bilingual: s.is_bilingual,
        language_1: s.language_1,
        language_2: s.language_2,
        is_generic: s.is_generic,
        is_published: s.is_published,
        created_at: s.created_at,
        questions_count: s._count.questions,
      })),
    });
  } catch (err: unknown) {
    console.error('[GET /question-sets] error:', err);
    res
      .status(500)
      .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur récupération packs' } });
  }
});

// ─── POST / — création ────────────────────────────────────────────────────

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  language_1: z.enum(['fr', 'en']).default('fr'),
  is_bilingual: z.boolean().default(false),
  language_2: z.enum(['fr', 'en']).optional(),
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.workspaceId!;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Body invalide',
        details: parsed.error.flatten(),
      },
    });
    return;
  }
  if (parsed.data.is_bilingual && !parsed.data.language_2) {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'language_2 requis si is_bilingual' } });
    return;
  }
  try {
    const est = await getCurrentEstablishment(workspaceId);
    if (!est) {
      res.status(404).json({ error: { code: 'NO_ESTABLISHMENT', message: 'Aucun établissement' } });
      return;
    }
    const set = await prisma.questionSet.create({
      data: {
        establishment_id: est.id,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        is_bilingual: parsed.data.is_bilingual,
        language_1: parsed.data.language_1,
        language_2: parsed.data.is_bilingual ? (parsed.data.language_2 ?? null) : null,
      },
    });
    res.status(201).json({ set });
  } catch (err: unknown) {
    console.error('[POST /question-sets] error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur création pack' } });
  }
});

// ─── GET /:id — détails ───────────────────────────────────────────────────

router.get('/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const workspaceId = req.workspaceId!;
  const id = req.params.id;
  try {
    const set = await prisma.questionSet.findFirst({
      where: { id, establishment: { workspace_id: workspaceId } },
      include: { questions: { orderBy: { position: 'asc' } } },
    });
    if (!set) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pack introuvable' } });
      return;
    }
    res.json({ set });
  } catch (err: unknown) {
    console.error('[GET /question-sets/:id] error:', err);
    res
      .status(500)
      .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur récupération pack' } });
  }
});

// ─── PATCH /:id ──────────────────────────────────────────────────────────

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  cover_url: z.string().url().nullable().optional(),
  is_published: z.boolean().optional(),
  is_bilingual: z.boolean().optional(),
  language_1: z.enum(['fr', 'en']).optional(),
  language_2: z.enum(['fr', 'en']).nullable().optional(),
});

router.patch('/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const workspaceId = req.workspaceId!;
  const id = req.params.id;
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Body invalide',
        details: parsed.error.flatten(),
      },
    });
    return;
  }
  try {
    const own = await ensureOwnSet(id, workspaceId);
    if (!own) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pack introuvable' } });
      return;
    }
    const set = await prisma.questionSet.update({
      where: { id },
      data: parsed.data,
    });
    res.json({ set });
  } catch (err: unknown) {
    console.error('[PATCH /question-sets/:id] error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur mise à jour pack' } });
  }
});

// ─── DELETE /:id ─────────────────────────────────────────────────────────

router.delete('/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const workspaceId = req.workspaceId!;
  const id = req.params.id;
  try {
    const own = await ensureOwnSet(id, workspaceId);
    if (!own) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pack introuvable' } });
      return;
    }
    await prisma.questionSet.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err: unknown) {
    console.error('[DELETE /question-sets/:id] error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur suppression pack' } });
  }
});

// ─── POST /:id/questions — ajoute une question ──────────────────────────

const addQuestionSchema = z.object({
  type: z.enum(['MCQ', 'TRUE_FALSE', 'FREE_TEXT', 'ESTIMATION']),
  category: z.string().trim().max(60).nullable().optional(),
  text_lang1: z.string().trim().min(1).max(500),
  text_lang2: z.string().trim().min(1).max(500).nullable().optional(),
  choices_lang1: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
  choices_lang2: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
  answer_lang1: z.string().trim().min(1).max(500),
  answer_lang2: z.string().trim().min(1).max(500).nullable().optional(),
  answer_aliases_lang1: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  answer_aliases_lang2: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  time_limit_sec: z.number().int().min(5).max(120).default(30),
  points: z.number().int().min(10).max(1000).default(100),
  media_type: z.enum(['NONE', 'VIDEO', 'AUDIO', 'IMAGE']).default('NONE'),
  media_url: z.string().url().nullable().optional(),
});

router.post(
  '/:id/questions',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const id = req.params.id;
    const parsed = addQuestionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Body invalide',
          details: parsed.error.flatten(),
        },
      });
      return;
    }
    try {
      const own = await ensureOwnSet(id, workspaceId);
      if (!own) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pack introuvable' } });
        return;
      }
      // Position = max+1
      const last = await prisma.question.findFirst({
        where: { set_id: id },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      const nextPosition = (last?.position ?? -1) + 1;

      // Validation type-specific côté serveur (defense in depth).
      if (parsed.data.type === 'MCQ' && parsed.data.choices_lang1.length < 2) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'MCQ : minimum 2 choix requis' },
        });
        return;
      }
      if (
        parsed.data.type === 'TRUE_FALSE' &&
        !['true', 'false'].includes(parsed.data.answer_lang1.toLowerCase())
      ) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'TRUE_FALSE : answer doit être true/false' },
        });
        return;
      }
      if (parsed.data.type === 'ESTIMATION') {
        try {
          const meta = JSON.parse(parsed.data.answer_lang1) as {
            target?: number;
            min?: number;
            max?: number;
          };
          if (
            typeof meta.target !== 'number' ||
            typeof meta.min !== 'number' ||
            typeof meta.max !== 'number'
          ) {
            throw new Error('missing fields');
          }
          if (meta.min >= meta.max || meta.target < meta.min || meta.target > meta.max) {
            throw new Error('invalid range');
          }
        } catch {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message:
                'ESTIMATION : answer_lang1 doit être un JSON {target, min, max} valide avec min<target<max',
            },
          });
          return;
        }
      }

      const question = await prisma.question.create({
        data: {
          set_id: id,
          position: nextPosition,
          type: parsed.data.type as QuestionType,
          category: parsed.data.category ?? null,
          text_lang1: parsed.data.text_lang1,
          text_lang2: parsed.data.text_lang2 ?? null,
          choices_lang1: parsed.data.choices_lang1,
          choices_lang2: parsed.data.choices_lang2,
          answer_lang1: parsed.data.answer_lang1,
          answer_lang2: parsed.data.answer_lang2 ?? null,
          answer_aliases_lang1: parsed.data.answer_aliases_lang1,
          answer_aliases_lang2: parsed.data.answer_aliases_lang2,
          time_limit_sec: parsed.data.time_limit_sec,
          points: parsed.data.points,
          media_type: parsed.data.media_type as MediaType,
          media_url: parsed.data.media_url ?? null,
        },
      });
      res.status(201).json({ question });
    } catch (err: unknown) {
      console.error('[POST /question-sets/:id/questions] error:', err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur ajout question' } });
    }
  },
);

// ─── PATCH /:id/questions/reorder ───────────────────────────────────────

const reorderSchema = z.object({
  questionIds: z.array(z.string().uuid()).min(1).max(500),
});

router.patch(
  '/:id/questions/reorder',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const setId = req.params.id;
    const parsed = reorderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Body invalide',
          details: parsed.error.flatten(),
        },
      });
      return;
    }
    try {
      const own = await ensureOwnSet(setId, workspaceId);
      if (!own) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pack introuvable' } });
        return;
      }
      const existing = await prisma.question.findMany({
        where: { set_id: setId },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((q) => q.id));
      if (
        parsed.data.questionIds.length !== existingIds.size ||
        parsed.data.questionIds.some((id) => !existingIds.has(id))
      ) {
        res.status(400).json({
          error: {
            code: 'INVALID_ORDER',
            message: 'La liste fournie ne correspond pas aux questions du pack',
          },
        });
        return;
      }
      // Phase intermédiaire à -idx-1000 puis position finale (le @@index n'est
      // pas unique sur position pour question_set, mais on garde la pratique).
      await prisma.$transaction([
        ...parsed.data.questionIds.map((qid, idx) =>
          prisma.question.update({ where: { id: qid }, data: { position: -idx - 1000 } }),
        ),
        ...parsed.data.questionIds.map((qid, idx) =>
          prisma.question.update({ where: { id: qid }, data: { position: idx } }),
        ),
      ]);
      res.json({ ok: true });
    } catch (err: unknown) {
      console.error('[PATCH /question-sets/:id/questions/reorder] error:', err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur réorganisation' } });
    }
  },
);

// ─── PATCH /:id/questions/:qid ──────────────────────────────────────────

const patchQuestionSchema = addQuestionSchema.partial();

router.patch(
  '/:id/questions/:qid',
  async (req: Request<{ id: string; qid: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const { id: setId, qid } = req.params;
    const parsed = patchQuestionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Body invalide',
          details: parsed.error.flatten(),
        },
      });
      return;
    }
    try {
      const own = await ensureOwnSet(setId, workspaceId);
      if (!own) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pack introuvable' } });
        return;
      }
      const question = await prisma.question.update({
        where: { id: qid, set_id: setId },
        data: {
          ...parsed.data,
          type: parsed.data.type as QuestionType | undefined,
          media_type: parsed.data.media_type as MediaType | undefined,
        },
      });
      res.json({ question });
    } catch (err: unknown) {
      console.error('[PATCH /question-sets/:id/questions/:qid] error:', err);
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur mise à jour question' } });
    }
  },
);

// ─── DELETE /:id/questions/:qid ─────────────────────────────────────────

router.delete(
  '/:id/questions/:qid',
  async (req: Request<{ id: string; qid: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const { id: setId, qid } = req.params;
    try {
      const own = await ensureOwnSet(setId, workspaceId);
      if (!own) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pack introuvable' } });
        return;
      }
      await prisma.question.delete({ where: { id: qid, set_id: setId } });
      // Réindexer les positions pour rester contigu.
      const remaining = await prisma.question.findMany({
        where: { set_id: setId },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      await prisma.$transaction([
        ...remaining.map((q, idx) =>
          prisma.question.update({ where: { id: q.id }, data: { position: -idx - 1000 } }),
        ),
        ...remaining.map((q, idx) =>
          prisma.question.update({ where: { id: q.id }, data: { position: idx } }),
        ),
      ]);
      res.json({ ok: true });
    } catch (err: unknown) {
      console.error('[DELETE /question-sets/:id/questions/:qid] error:', err);
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur suppression question' } });
    }
  },
);

export default router;
