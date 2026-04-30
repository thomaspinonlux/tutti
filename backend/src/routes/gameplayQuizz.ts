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
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ScoreEventType, type Question } from '@prisma/client';
import type { CurrentQuestionState, QuestionType, GameMode, Team } from '@tutti/shared';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireWorkspace } from '../middleware/tenant.js';
import { verifyParticipantToken } from '../lib/participantToken.js';
import { broadcastToSession } from '../socket/index.js';
import {
  clearActiveQuestion,
  getActiveQuestion,
  revealAnswers,
  setActiveQuestion,
  trySubmitAnswer,
} from '../lib/gameStateQuizz.js';
import { computeQuestionScore } from '../lib/quizzScoring.js';
import { matchAnswer } from '../lib/quizzMatch.js';
import { getCumulativeScores } from '../lib/scores.js';

const router: Router = Router({ mergeParams: true });

// Stockage des timers d'auto-reveal par session_id.
const revealTimers = new Map<string, NodeJS.Timeout>();

// ── Helpers ──────────────────────────────────────────────────────────────

async function ensureOwnSession(sessionId: string, workspaceId: string) {
  return prisma.session.findFirst({
    where: { id: sessionId, establishment: { workspace_id: workspaceId } },
    include: {
      participants: { where: { is_kicked: false }, select: { id: true } },
    },
  });
}

async function findQuestionAtIndex(questionSetId: string, index: number): Promise<Question | null> {
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
function buildAndBroadcastQuestion(
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
    started_at: new Date().toISOString(),
    time_limit_sec: question.time_limit_sec,
    points: question.points,
    phase: 'asking',
  };

  // ESTIMATION : expose min/max/unit (pas target qui est la réponse)
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
      /* fallback : pas de bornes, le slider tel sera 0..100 */
    }
  }

  broadcastToSession(sessionId, 'quizz:question_start', { state });
  return state;
}

/**
 * Programme l'auto-reveal de la question quand le timer expire.
 * Annule le timer précédent éventuel.
 */
function scheduleAutoReveal(sessionId: string, timeLimitMs: number, doReveal: () => void): void {
  const existing = revealTimers.get(sessionId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    revealTimers.delete(sessionId);
    doReveal();
  }, timeLimitMs);
  revealTimers.set(sessionId, timer);
}

function clearAutoReveal(sessionId: string): void {
  const existing = revealTimers.get(sessionId);
  if (existing) {
    clearTimeout(existing);
    revealTimers.delete(sessionId);
  }
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
      res
        .status(409)
        .json({
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

// ── Logique reveal partagée ──────────────────────────────────────────────

async function revealCurrentQuestion(sessionId: string): Promise<void> {
  clearAutoReveal(sessionId);
  const active = getActiveQuestion(sessionId);
  if (!active || active.phase === 'revealed') return;

  const question = await prisma.question.findUnique({ where: { id: active.question_id } });
  if (!question) return;

  // Score chaque réponse soumise.
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { language: true },
  });
  const playerLang = session?.language === 'en' ? ('lang1' as const) : ('lang1' as const); // V0 simple : on score toujours en langue 1
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

  // Persiste les ScoreEvent pour les bonnes réponses (et 0 pour les autres
  // si tu veux tracer — V0 on log uniquement les bonnes pour limiter le bruit).
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
            session_round_id: null, // pas de round V0 quizz
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

  // Construit le payload reveal à broadcast.
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
  // Tri par score desc puis temps croissant (1ers en haut).
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.answered_at_ms - b.answered_at_ms;
  });

  // Réponse à révéler côté UI
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

export default router;
