/**
 * Routes /api/sessions/:id/quizz/* — boucle de jeu Tutti Quizz V0.
 *
 *   Host (Supabase auth) :
 *     POST /play-question     : démarre la question à `question_index`
 *     POST /next-question     : avance à la suivante (auto-end si fini)
 *     POST /reveal-question   : passe immédiatement en phase 'revealed'
 *
 *   Joueur (token JWT participant) :
 *     POST /submit-answer     : soumet une réponse (1 par joueur par question)
 *
 * V0 : pas de SessionRound pour QUIZZ — on travaille directement sur
 * Session.question_set_id. Pour V1.1, on pourra utiliser SessionRound pour
 * enchaîner plusieurs packs de questions dans la même session.
 *
 * Helpers métier (revealCurrentQuestion, scheduleAutoReveal, etc.) factorisés
 * dans lib/gameplayQuizzCore.ts pour partage avec les routes master.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { QuestionType, GameMode, Team } from '@tutti/shared';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireWorkspace } from '../middleware/tenant.js';
import { verifyParticipantToken } from '../lib/participantToken.js';
import { broadcastToSession } from '../socket/index.js';
import {
  clearActiveQuestion,
  getActiveQuestion,
  setActiveQuestion,
  trySubmitAnswer,
} from '../lib/gameStateQuizz.js';
import {
  buildAndBroadcastQuestion,
  clearAutoReveal,
  findQuestionAtIndex,
  revealCurrentQuestion,
  scheduleAutoReveal,
} from '../lib/gameplayQuizzCore.js';
import { getCumulativeScores } from '../lib/scores.js';

const router: Router = Router({ mergeParams: true });

// ── Helpers ──────────────────────────────────────────────────────────────

async function ensureOwnSession(sessionId: string, workspaceId: string) {
  return prisma.session.findFirst({
    where: { id: sessionId, establishment: { workspace_id: workspaceId } },
    include: {
      participants: { where: { is_kicked: false }, select: { id: true } },
    },
  });
}

// ── POST /play-question (host) ───────────────────────────────────────────

const playQuestionSchema = z.object({
  question_index: z.number().int().min(0),
});

router.post(
  '/play-question',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const parsed = playQuestionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body invalide' } });
      return;
    }
    const session = await ensureOwnSession(req.params.id, workspaceId);
    if (!session) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
      return;
    }
    if (!session.question_set_id) {
      res.status(409).json({
        error: { code: 'NO_QUESTION_SET', message: 'Pas de question_set lié à la session' },
      });
      return;
    }
    const set = await prisma.questionSet.findUnique({
      where: { id: session.question_set_id },
      select: { is_bilingual: true },
    });
    const question = await findQuestionAtIndex(session.question_set_id, parsed.data.question_index);
    if (!question || !set) {
      res.status(404).json({ error: { code: 'NO_QUESTION', message: 'Question introuvable' } });
      return;
    }

    const state = buildAndBroadcastQuestion(req.params.id, question, set.is_bilingual);
    setActiveQuestion(req.params.id, {
      question_index: question.position,
      question_id: question.id,
      question_type: question.type as QuestionType,
      time_limit_ms: question.time_limit_sec * 1000,
      points: question.points,
      expected_participants: session.participants.map((p) => p.id),
    });
    scheduleAutoReveal(req.params.id, question.time_limit_sec * 1000, () => {
      void revealCurrentQuestion(req.params.id);
    });

    res.json({ state });
  },
);

// ── POST /next-question (host) ───────────────────────────────────────────

router.post(
  '/next-question',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const session = await ensureOwnSession(req.params.id, workspaceId);
    if (!session) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
      return;
    }
    if (!session.question_set_id) {
      res
        .status(409)
        .json({ error: { code: 'NO_QUESTION_SET', message: 'Pas de question_set lié' } });
      return;
    }
    const active = getActiveQuestion(req.params.id);
    const nextIndex = active ? active.question_index + 1 : 0;
    const set = await prisma.questionSet.findUnique({
      where: { id: session.question_set_id },
      select: { is_bilingual: true, _count: { select: { questions: true } } },
    });
    if (!set) {
      res.status(404).json({ error: { code: 'NO_SET', message: 'Pack introuvable' } });
      return;
    }
    if (nextIndex >= set._count.questions) {
      // Plus de questions → end session avec podium.
      clearActiveQuestion(req.params.id);
      clearAutoReveal(req.params.id);
      const updated = await prisma.session.update({
        where: { id: req.params.id },
        data: { status: 'ENDED', ended_at: new Date() },
      });
      const teams = (updated.teams_config as Team[] | null) ?? null;
      const cumulative = await getCumulativeScores({
        sessionId: updated.id,
        mode: updated.mode as GameMode,
        teams,
        participants: session.participants.map((p) => ({ id: p.id, pseudo: '', team_id: null })),
      });
      broadcastToSession(req.params.id, 'session:ended', { session: updated, cumulative });
      res.json({ ended: true, session: updated, cumulative });
      return;
    }
    const question = await findQuestionAtIndex(session.question_set_id, nextIndex);
    if (!question) {
      res.status(404).json({ error: { code: 'NO_QUESTION', message: 'Question introuvable' } });
      return;
    }
    const state = buildAndBroadcastQuestion(req.params.id, question, set.is_bilingual);
    setActiveQuestion(req.params.id, {
      question_index: question.position,
      question_id: question.id,
      question_type: question.type as QuestionType,
      time_limit_ms: question.time_limit_sec * 1000,
      points: question.points,
      expected_participants: session.participants.map((p) => p.id),
    });
    scheduleAutoReveal(req.params.id, question.time_limit_sec * 1000, () => {
      void revealCurrentQuestion(req.params.id);
    });

    res.json({ state });
  },
);

// ── POST /reveal-question (host) ─────────────────────────────────────────

router.post(
  '/reveal-question',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const session = await ensureOwnSession(req.params.id, workspaceId);
    if (!session) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
      return;
    }
    await revealCurrentQuestion(req.params.id);
    res.json({ ok: true });
  },
);

// ── POST /submit-answer (joueur) ─────────────────────────────────────────

const submitSchema = z.object({
  token: z.string(),
  value: z.string().max(500),
});

router.post(
  '/submit-answer',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body invalide' } });
      return;
    }
    let payload: { participant_id: string; session_id: string };
    try {
      payload = verifyParticipantToken(parsed.data.token);
    } catch {
      res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Token invalide' } });
      return;
    }
    if (payload.session_id !== req.params.id) {
      res.status(403).json({
        error: { code: 'WRONG_SESSION', message: 'Token / session ne correspond pas' },
      });
      return;
    }
    const participant = await prisma.participant.findUnique({
      where: { id: payload.participant_id },
      select: { id: true, pseudo: true, is_kicked: true, session_id: true },
    });
    if (!participant || participant.is_kicked || participant.session_id !== req.params.id) {
      res
        .status(403)
        .json({ error: { code: 'PARTICIPANT_INVALID', message: 'Participant invalide' } });
      return;
    }

    const result = trySubmitAnswer(req.params.id, payload.participant_id, parsed.data.value);
    if (!result.ok) {
      const codeMap: Record<typeof result.reason, number> = {
        NO_QUESTION: 404,
        PHASE_LOCKED: 409,
        TIME_EXPIRED: 409,
        ALREADY_ANSWERED: 409,
      };
      res.status(codeMap[result.reason]).json({
        error: { code: result.reason, message: 'Réponse refusée' },
      });
      return;
    }

    // Broadcast discret : un joueur a répondu (sans révéler la valeur).
    broadcastToSession(req.params.id, 'quizz:answer_submitted', {
      participant_id: payload.participant_id,
      pseudo: participant.pseudo,
    });

    // Si tout le monde a répondu → auto-reveal anticipé.
    if (result.allAnswered) {
      clearAutoReveal(req.params.id);
      await revealCurrentQuestion(req.params.id);
    }

    res.json({ ok: true, allAnswered: result.allAnswered });
  },
);

export default router;
