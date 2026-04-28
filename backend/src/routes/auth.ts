/**
 * Routes /api/auth/* — bootstrap multi-tenant après signup.
 *
 * Le signup auth (création de auth.users) est fait côté frontend via
 * supabase.auth.signUp(). Cette route fait le bootstrap métier qui suit :
 * création atomique de Workspace + WorkspaceMember(OWNER) + Establishment.
 *
 * Idempotent : si le user a déjà un workspace, on retourne celui existant
 * (utile pour OAuth qui n'a pas de form pré-création).
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Plan, Role } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router: Router = Router();

const initializeBodySchema = z.object({
  workspaceName: z.string().trim().min(2).max(120),
  establishmentName: z.string().trim().min(2).max(120).optional(),
});

/**
 * POST /api/auth/initialize
 * Body: { workspaceName, establishmentName? }
 * Auth: required (Bearer JWT)
 *
 * Comportement :
 * - Si l'utilisateur n'a pas encore de workspace : crée Workspace + Member(OWNER) + Establishment
 * - Si l'utilisateur a déjà un workspace : retourne le sien (idempotent)
 *
 * Architecture: même endpoint pour signup email/password (V1) et OAuth (V2+),
 * appelé par le frontend juste après l'auth Supabase réussie.
 */
router.post('/initialize', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'userId manquant' } });
    return;
  }

  const parsed = initializeBodySchema.safeParse(req.body);
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
  const { workspaceName, establishmentName } = parsed.data;

  try {
    // Idempotence: vérifier si le user a déjà un workspace
    const existingMember = await prisma.workspaceMember.findFirst({
      where: { user_id: userId },
      include: {
        workspace: {
          include: { establishments: true },
        },
      },
    });

    if (existingMember) {
      res.json({
        workspace: existingMember.workspace,
        member: { id: existingMember.id, role: existingMember.role },
        created: false,
      });
      return;
    }

    // Premier login : créer le tenant complet de manière atomique
    const result = await prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name: workspaceName,
          plan: Plan.FREE,
        },
      });

      const member = await tx.workspaceMember.create({
        data: {
          workspace_id: workspace.id,
          user_id: userId,
          role: Role.OWNER,
        },
      });

      const establishment = await tx.establishment.create({
        data: {
          workspace_id: workspace.id,
          name: establishmentName ?? workspaceName,
          default_language: 'fr',
          active_provider: 'demo',
        },
      });

      return { workspace, member, establishment };
    });

    res.status(201).json({
      workspace: { ...result.workspace, establishments: [result.establishment] },
      member: { id: result.member.id, role: result.member.role },
      created: true,
    });
  } catch (err: unknown) {
    console.error('[POST /api/auth/initialize] error:', err);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lors de l’initialisation du workspace' },
    });
  }
});

export default router;
