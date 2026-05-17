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
import { isSuperAdminEmail } from '../lib/superAdmin.js';
import {
  getNotificationRecipients,
  renderSignupNotificationHtml,
  renderWelcomeEmailHtml,
  sendNotificationEmail,
  welcomeEmailSubject,
} from '../lib/email.js';

/**
 * Envoie une notification email au team admin pour chaque nouvelle
 * inscription user. Fire-and-forget : non bloquant + try/catch défensif
 * pour ne JAMAIS casser la flow signup en cas d'erreur Resend.
 */
function fireSignupNotification(args: {
  email: string;
  name: string | null;
  locale: string;
}): void {
  const recipients = getNotificationRecipients();
  if (recipients.length === 0) {
    console.info('[Email] NOTIFICATION_EMAILS vide → notification signup skip');
    return;
  }
  const html = renderSignupNotificationHtml({
    email: args.email,
    name: args.name,
    locale: args.locale,
    signupAt: new Date(),
  });
  // Pas d'await → la réponse signup ne bloque pas sur Resend.
  void sendNotificationEmail({
    to: recipients,
    subject: `[Tutti] Nouvelle inscription - ${args.email}`,
    html,
  })
    .then((result) => {
      console.info(`[Email] Admin notification sent: ${JSON.stringify(result)}`);
    })
    .catch((err) => {
      console.error('[Email] fireSignupNotification swallowed error:', err);
    });
}

/**
 * feat/welcome-email-user-signup — email de bienvenue envoyé au user
 * directement après signup. Confirme la réception de l'inscription +
 * onboarding rapide. Fire-and-forget, indépendant de la notification
 * admin (la flow signup ne bloque jamais sur Resend).
 *
 * Sélection FR/EN via args.locale (browser Accept-Language ou défaut).
 *
 * Skip silencieux si pas d'email user valide (cas edge OAuth sans
 * permission email, etc.) — pas d'erreur côté flow signup.
 */
function fireWelcomeEmail(args: {
  email: string | null;
  locale: string;
  /** feat/signup-firstname-lastname — passe prénom pour personnaliser
   *  la salutation ("Salut Thomas," au lieu de "Salut,"). null/absent OK. */
  firstName?: string | null;
}): void {
  if (!args.email || !args.email.includes('@')) {
    console.info('[Email] User email manquant/invalide → welcome email skip');
    return;
  }
  const html = renderWelcomeEmailHtml({ locale: args.locale, firstName: args.firstName });
  const subject = welcomeEmailSubject(args.locale);
  void sendNotificationEmail({
    to: [args.email],
    subject,
    html,
  })
    .then((result) => {
      console.info(
        `[Email] User welcome sent to=${args.email} locale=${args.locale} firstName="${args.firstName ?? ''}": ${JSON.stringify(result)}`,
      );
    })
    .catch((err) => {
      console.error('[Email] fireWelcomeEmail swallowed error:', err);
    });
}

/**
 * Détecte la locale du user à partir du header Accept-Language. Retourne
 * "en" si le navigateur préfère l'anglais en premier, sinon "fr" par
 * défaut (catalogue Tutti FR par défaut). Best-effort, naïf : split sur
 * "," + ";", lit le premier tag.
 */
function detectLocaleFromHeader(acceptLanguage: string | undefined): 'fr' | 'en' {
  if (!acceptLanguage) return 'fr';
  const first = acceptLanguage.split(',')[0]?.split(';')[0]?.trim().toLowerCase() ?? '';
  return first.startsWith('en') ? 'en' : 'fr';
}

const router: Router = Router();

const initializeBodySchema = z.object({
  /**
   * feat/signup-firstname-lastname — identité user (Supabase user_metadata
   * source de vérité). Le workspace est auto-généré "Workspace de {first}
   * {last}" — workspaceName legacy gardé en fallback pour rétro-compat
   * client (OAuth flows + comptes créés avant ce changement).
   */
  first_name: z.string().trim().min(1).max(60).optional(),
  last_name: z.string().trim().min(1).max(60).optional(),
  workspaceName: z.string().trim().min(2).max(120).optional(),
  establishmentName: z.string().trim().min(2).max(120).optional(),
  /** Code parrain — si fourni + valide, rattache au workspace existant. */
  referrerCode: z.string().trim().min(4).max(8).optional(),
  /**
   * Phase 4e — code invitation (one-shot ou multi-usage). Si fourni et
   * valide, le membre est créé directement en APPROVED. Sinon le membre
   * passe par PENDING (sauf whitelist email).
   */
  invitationCode: z.string().trim().toUpperCase().min(4).max(16).optional(),
});

/**
 * Phase 4e — détermine le statut d'approbation à la création d'un membre.
 * Renvoie aussi le code invitation à consommer (si applicable).
 */
async function resolveApprovalStatus(args: {
  email: string | undefined;
  invitationCode: string | undefined;
}): Promise<{
  status: 'PENDING' | 'APPROVED';
  invitationCodeUsed: string | null;
  invitationCodeId: string | null;
  approvedAt: Date | null;
}> {
  // 1) Super admin → toujours approuvé
  if (isSuperAdminEmail(args.email)) {
    return {
      status: 'APPROVED',
      invitationCodeUsed: null,
      invitationCodeId: null,
      approvedAt: new Date(),
    };
  }

  // 2) Whitelist email → approuvé auto
  if (args.email) {
    const wl = await prisma.whitelistEmail.findUnique({
      where: { email: args.email.toLowerCase() },
    });
    if (wl) {
      return {
        status: 'APPROVED',
        invitationCodeUsed: null,
        invitationCodeId: null,
        approvedAt: new Date(),
      };
    }
  }

  // 3) Code invitation valide → approuvé auto + consommer
  if (args.invitationCode) {
    const code = await prisma.invitationCode.findUnique({
      where: { code: args.invitationCode },
    });
    if (
      code &&
      (!code.expires_at || code.expires_at > new Date()) &&
      (!code.max_uses || code.uses_count < code.max_uses)
    ) {
      return {
        status: 'APPROVED',
        invitationCodeUsed: code.code,
        invitationCodeId: code.id,
        approvedAt: new Date(),
      };
    }
  }

  // 4) Sinon : PENDING (file d'attente super admin)
  return {
    status: 'PENDING',
    invitationCodeUsed: null,
    invitationCodeId: null,
    approvedAt: null,
  };
}

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
  const {
    first_name,
    last_name,
    workspaceName: bodyWorkspaceName,
    establishmentName,
    referrerCode,
    invitationCode,
  } = parsed.data;

  // feat/signup-firstname-lastname — résolution du workspace name + identité
  // user. Le frontend signup envoie first_name + last_name (Supabase metadata
  // mis à jour côté frontend). On dérive workspace.name = "Workspace de {first}
  // {last}". Fallback : workspaceName legacy si pas de first/last (OAuth ou
  // ancien client). Dernier recours : "Workspace de {email-before-@}".
  const fullName = first_name && last_name ? `${first_name} ${last_name}`.trim() : null;
  const emailLocalPart = req.userEmail?.split('@')[0] ?? null;
  const derivedWorkspaceName = fullName
    ? `Workspace de ${fullName}`
    : (bodyWorkspaceName ?? (emailLocalPart ? `Workspace de ${emailLocalPart}` : 'Mon workspace'));

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
        member: {
          id: existingMember.id,
          role: existingMember.role,
          status: existingMember.status,
        },
        created: false,
      });
      return;
    }

    // Phase 4e : résoudre le statut d'approbation
    const approval = await resolveApprovalStatus({
      email: req.userEmail,
      invitationCode,
    });

    // Si referrerCode fourni : rattacher au workspace du parrain comme HOST.
    // Le parrainage donne accès direct (workspace déjà approuvé), donc APPROVED auto.
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
            status: 'APPROVED',
            email: req.userEmail ?? null,
            approved_at: new Date(),
            referral_code: myReferralCode,
            referrer_code: referrerCode.toUpperCase(),
          },
        });
        // feat/admin-users-and-email-notifications — notif team
        const localeReferral = detectLocaleFromHeader(req.headers['accept-language']);
        console.info(
          `[Signup] User created (referral): email=${req.userEmail ?? '?'} name="${fullName ?? '?'}" locale=${localeReferral} workspace=${referrer.workspace_id}`,
        );
        fireSignupNotification({
          email: req.userEmail ?? '(email inconnu)',
          name: fullName,
          locale: localeReferral,
        });
        // feat/welcome-email-user-signup — email bienvenue au user (firstName
        // pour personnalisation salutation, cf. feat/signup-firstname-lastname)
        fireWelcomeEmail({
          email: req.userEmail ?? null,
          locale: localeReferral,
          firstName: first_name ?? null,
        });
        res.status(201).json({
          workspace: referrer.workspace,
          member: {
            id: member.id,
            role: member.role,
            status: member.status,
            referral_code: myReferralCode,
          },
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
          name: derivedWorkspaceName,
          plan: Plan.FREE,
        },
      });

      const member = await tx.workspaceMember.create({
        data: {
          workspace_id: workspace.id,
          user_id: userId,
          role: Role.OWNER,
          status: approval.status,
          email: req.userEmail ?? null,
          invitation_code_used: approval.invitationCodeUsed,
          approved_at: approval.approvedAt,
          referral_code: myReferralCode,
        },
      });

      const establishment = await tx.establishment.create({
        data: {
          workspace_id: workspace.id,
          name: establishmentName ?? derivedWorkspaceName,
          default_language: 'fr',
          active_providers: ['demo'],
        },
      });

      // Consommer le code invitation si utilisé
      if (approval.invitationCodeId) {
        await tx.invitationCode.update({
          where: { id: approval.invitationCodeId },
          data: {
            uses_count: { increment: 1 },
            first_used_at: approval.approvedAt ? approval.approvedAt : new Date(),
          },
        });
      }

      return { workspace, member, establishment };
    });

    // feat/admin-users-and-email-notifications — notif team
    const localeNew = detectLocaleFromHeader(req.headers['accept-language']);
    console.info(
      `[Signup] User created (new tenant): email=${req.userEmail ?? '?'} name="${fullName ?? '?'}" locale=${localeNew} workspace=${result.workspace.id} status=${result.member.status}`,
    );
    fireSignupNotification({
      email: req.userEmail ?? '(email inconnu)',
      name: fullName,
      locale: localeNew,
    });
    // feat/welcome-email-user-signup — email bienvenue au user (firstName
    // pour personnalisation salutation, cf. feat/signup-firstname-lastname)
    fireWelcomeEmail({
      email: req.userEmail ?? null,
      locale: localeNew,
      firstName: first_name ?? null,
    });

    res.status(201).json({
      workspace: { ...result.workspace, establishments: [result.establishment] },
      member: {
        id: result.member.id,
        role: result.member.role,
        status: result.member.status,
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
