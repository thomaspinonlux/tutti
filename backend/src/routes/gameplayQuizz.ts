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
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireWorkspace } from '../middleware/tenant.js';
import { verifyParticipantToken } from '../lib/participantToken.js';
import { broadcastToSession } from '../socket/index.js';
import { trySubmitAnswer } from '../lib/gameStateQuizz.js';
import { clearAutoReveal, revealCurrentQuestion } from '../lib/gameplayQuizzCore.js';
import {
  QuizzErreur,
  ajouterTheme,
  lancerQuestion,
  listerThemes,
  questionSuivante,
  revelerQuestion,
} from '../lib/quizzPilotage.js';

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

// ── Pilotage console — feat/quiz-comme-le-blind-test ──────────────────────
// Toute la logique vit dans lib/quizzPilotage (partagée avec la manette).

function repondreErreur(res: Response, err: unknown): void {
  if (err instanceof QuizzErreur) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  console.error('[Quizz] erreur de pilotage :', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Erreur du quiz' } });
}

/** Les thèmes proposés, avec le nombre de questions par niveau. */
router.get('/themes', requireAuth, requireWorkspace, async (_req: Request, res: Response): Promise<void> => {
  res.json({ themes: await listerThemes() });
});

const themeSchema = z.object({
  pack_id: z.string().uuid(),
  niveau: z.enum(['EASY', 'MEDIUM', 'EXPERT', 'MIX']).optional(),
  nombre: z.number().int().min(1).max(50).optional(),
});

/** Ajoute un thème (une manche) à la partie. */
router.post(
  '/themes',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const parsed = themeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Thème invalide' } });
      return;
    }
    if (!(await ensureOwnSession(req.params.id, req.workspaceId!))) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
      return;
    }
    try {
      res.json({ manche: await ajouterTheme(req.params.id, parsed.data.pack_id, parsed.data) });
    } catch (err: unknown) {
      repondreErreur(res, err);
    }
  },
);

const playQuestionSchema = z.object({ question_index: z.number().int().min(0) });

router.post(
  '/play-question',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const parsed = playQuestionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body invalide' } });
      return;
    }
    if (!(await ensureOwnSession(req.params.id, req.workspaceId!))) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
      return;
    }
    try {
      res.json({ state: await lancerQuestion(req.params.id, parsed.data.question_index) });
    } catch (err: unknown) {
      repondreErreur(res, err);
    }
  },
);

/** Question suivante — ou fin de manche (la partie continue). */
router.post(
  '/next-question',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    if (!(await ensureOwnSession(req.params.id, req.workspaceId!))) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
      return;
    }
    try {
      res.json(await questionSuivante(req.params.id));
    } catch (err: unknown) {
      repondreErreur(res, err);
    }
  },
);

router.post(
  '/reveal-question',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    if (!(await ensureOwnSession(req.params.id, req.workspaceId!))) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
      return;
    }
    try {
      await revelerQuestion(req.params.id);
      res.json({ ok: true });
    } catch (err: unknown) {
      repondreErreur(res, err);
    }
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
