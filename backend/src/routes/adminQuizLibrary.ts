/**
 * Routes /api/admin/library/quiz-packs/* — gestion super-admin de la
 * bibliothèque officielle Quizz Tutti.
 *
 *   - GET    /quiz-packs                : liste + filtre visibility/q
 *   - GET    /quiz-packs/:id            : détail + questions
 *   - PATCH  /quiz-packs/:id            : update name/desc/visibility
 *
 * V1 : pas d'édition individuelle des questions (lecture seule). Édition
 * future via PR séparée.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
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

export default router;
