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
  /** Code parrain — si fourni + valide, rattache au workspace existant. */
  referrerCode: z.string().trim().min(4).max(8).optional(),
});

/** Génère un referral_code unique (6 chars alphanumériques majuscules). */
function generateReferralCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I ambigus
  return Array.from(
    { length: 6 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join('');
}

async function generateUniqueReferralCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = generateReferralCode();
    const exists = await prisma.workspaceMember.findUnique({
      where: { referral_code: code },
      select: { id: true },
    });
    if (!exists) return code;
  }
  // Fallback ultra-rare : retourne quand même, le @@unique catchera la collision
  return generateReferralCode();
}

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
  const { workspaceName, establishmentName, referrerCode } = parsed.data;

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

    // Si referrerCode fourni : rattacher au workspace du parrain comme HOST
    if (referrerCode) {
      const referrer = await prisma.workspaceMember.findUnique({
        where: { referral_code: referrerCode.toUpperCase() },
        include: { workspace: { include: { establishments: true } } },
      });
      if (referrer) {
        const myReferralCode = await generateUniqueReferralCode();
        const member = await prisma.workspaceMember.create({
          data: {
            workspace_id: referrer.workspace_id,
            user_id: userId,
            role: Role.HOST,
            referral_code: myReferralCode,
            referrer_code: referrerCode.toUpperCase(),
          },
        });
        res.status(201).json({
          workspace: referrer.workspace,
          member: { id: member.id, role: member.role, referral_code: myReferralCode },
          created: true,
          joined: true,
        });
        return;
      }
      // referrerCode invalide → fallback sur création normale
    }

    // Premier login : créer le tenant complet de manière atomique
    const myReferralCode = await generateUniqueReferralCode();
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
          referral_code: myReferralCode,
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
      member: {
        id: result.member.id,
        role: result.member.role,
        referral_code: result.member.referral_code,
      },
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
