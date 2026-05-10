/**
 * Routes /api/admin/* — Phase 4
 *
 * Gestion des comptes par les super admins :
 *   - GET    /members?status=PENDING            : liste filtrable
 *   - POST   /members/:id/approve               : flip → APPROVED
 *   - POST   /members/:id/reject                : flip → REJECTED
 *   - GET    /whitelist                         : liste emails auto-approuvés
 *   - POST   /whitelist            { email, note? }
 *   - DELETE /whitelist/:id
 *   - GET    /invitations
 *   - POST   /invitations          { code?, note?, max_uses?, expires_at? }
 *   - DELETE /invitations/:id
 *
 * Toutes les routes sont gardées par requireAuth + requireSuperAdmin.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireSuperAdmin } from '../middleware/tenant.js';
import { getNotificationRecipients, sendNotificationEmail } from '../lib/email.js';

const router: Router = Router();

router.use(requireAuth, requireSuperAdmin);

// ───── Members ────────────────────────────────────────────────────────────

const listMembersQuery = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
});

router.get('/members', async (req: Request, res: Response): Promise<void> => {
  const parsed = listMembersQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'status invalide' } });
    return;
  }
  const where = parsed.data.status ? { status: parsed.data.status } : {};
  const members = await prisma.workspaceMember.findMany({
    where,
    orderBy: { created_at: 'desc' },
    include: {
      workspace: { select: { id: true, name: true, plan: true } },
    },
  });
  res.json({ members });
});

router.post(
  '/members/:id/approve',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const member = await prisma.workspaceMember.findUnique({ where: { id: req.params.id } });
    if (!member) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Membre introuvable' } });
      return;
    }
    const updated = await prisma.workspaceMember.update({
      where: { id: req.params.id },
      data: {
        status: 'APPROVED',
        approved_at: new Date(),
        approved_by: req.userId,
      },
    });
    res.json({ member: updated });
  },
);

router.post(
  '/members/:id/reject',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const member = await prisma.workspaceMember.findUnique({ where: { id: req.params.id } });
    if (!member) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Membre introuvable' } });
      return;
    }
    const updated = await prisma.workspaceMember.update({
      where: { id: req.params.id },
      data: {
        status: 'REJECTED',
        approved_at: null,
        approved_by: req.userId,
      },
    });
    res.json({ member: updated });
  },
);

// ───── Whitelist ──────────────────────────────────────────────────────────

router.get('/whitelist', async (_req: Request, res: Response): Promise<void> => {
  const entries = await prisma.whitelistEmail.findMany({
    orderBy: { created_at: 'desc' },
  });
  res.json({ entries });
});

const addWhitelistBody = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  note: z.string().trim().max(500).optional(),
});

router.post('/whitelist', async (req: Request, res: Response): Promise<void> => {
  const parsed = addWhitelistBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'email requis (format valide)' } });
    return;
  }
  try {
    const entry = await prisma.whitelistEmail.create({
      data: {
        email: parsed.data.email,
        note: parsed.data.note,
        added_by: req.userId!,
      },
    });
    res.status(201).json({ entry });
  } catch (err: unknown) {
    // Conflit unique
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    ) {
      res.status(409).json({ error: { code: 'ALREADY_EXISTS', message: 'Email déjà whitelisté' } });
      return;
    }
    throw err;
  }
});

router.delete(
  '/whitelist/:id',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const entry = await prisma.whitelistEmail.findUnique({ where: { id: req.params.id } });
    if (!entry) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Entrée introuvable' } });
      return;
    }
    await prisma.whitelistEmail.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  },
);

// ───── Invitations ────────────────────────────────────────────────────────

function generateCode(length = 8): string {
  // Alphabet sans caractères ambigus (0/O, 1/I/l).
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

router.get('/invitations', async (_req: Request, res: Response): Promise<void> => {
  const codes = await prisma.invitationCode.findMany({
    orderBy: { created_at: 'desc' },
  });
  res.json({ codes });
});

const createInvitationBody = z.object({
  code: z.string().trim().toUpperCase().min(4).max(16).optional(),
  note: z.string().trim().max(500).optional(),
  max_uses: z.number().int().min(1).max(10000).optional(),
  expires_at: z
    .string()
    .datetime()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
});

router.post('/invitations', async (req: Request, res: Response): Promise<void> => {
  const parsed = createInvitationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body invalide' } });
    return;
  }
  const code = parsed.data.code ?? generateCode(8);
  try {
    const entry = await prisma.invitationCode.create({
      data: {
        code,
        note: parsed.data.note,
        max_uses: parsed.data.max_uses,
        expires_at: parsed.data.expires_at,
        created_by: req.userId!,
      },
    });
    res.status(201).json({ code: entry });
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    ) {
      res.status(409).json({ error: { code: 'ALREADY_EXISTS', message: 'Code déjà utilisé' } });
      return;
    }
    throw err;
  }
});

router.delete(
  '/invitations/:id',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const entry = await prisma.invitationCode.findUnique({ where: { id: req.params.id } });
    if (!entry) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Code introuvable' } });
      return;
    }
    await prisma.invitationCode.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  },
);

// ───── Test email — fix/email-notification-not-sent ───────────────────────
//
// POST /api/admin/test-email — super-admin only. Envoie un email de test
// via le même pipeline que fireSignupNotification, et retourne le SendResult
// avec statusCode + errorName + errorMessage. Utile pour diagnostiquer
// rapidement après changement de RESEND_API_KEY / MAIL_FROM / domaine vérifié
// sans devoir re-signup pour générer un événement.
//
// Body :
//   { to?: string[], subject?: string, html?: string }
// Defaults :
//   to       = NOTIFICATION_EMAILS env
//   subject  = "[Tutti] Test email depuis /api/admin/test-email"
//   html     = "<p>Test email…</p>"

const testEmailBody = z.object({
  to: z.array(z.string().email()).max(20).optional(),
  subject: z.string().min(1).max(200).optional(),
  html: z.string().min(1).max(10_000).optional(),
});

router.post('/test-email', async (req: Request, res: Response): Promise<void> => {
  const parsed = testEmailBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
    return;
  }
  const to = parsed.data.to ?? getNotificationRecipients();
  const subject = parsed.data.subject ?? '[Tutti] Test email depuis /api/admin/test-email';
  const html =
    parsed.data.html ??
    `<div style="font-family:system-ui,sans-serif;padding:24px"><h2>Test email Tutti</h2><p>Si tu lis ceci, le pipeline Resend fonctionne.</p><p style="color:#999;font-size:12px">Envoyé à ${new Date().toISOString()}.</p></div>`;
  const result = await sendNotificationEmail({ to, subject, html });
  // Renvoie tel quel — diagnostique direct côté admin UI ou curl.
  res.status(result.ok ? 200 : 502).json({
    ok: result.ok,
    to,
    from: process.env.MAIL_FROM ?? null,
    apiKeyConfigured: Boolean(process.env.RESEND_API_KEY),
    result,
  });
});

export default router;
