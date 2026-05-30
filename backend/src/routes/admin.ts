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
import { supabaseAdmin } from '../lib/supabase.js';
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
  // fix/admin-users-integration — backfill l'email manquant via Supabase
  // auth admin. WorkspaceMember.email est un snapshot pris au signup, mais
  // certains members legacy ont email=null (création avant l'ajout du
  // champ). Résoudre via auth.admin.getUserById évite l'affichage
  // "(email inconnu)" côté UI. Best-effort : si une lookup échoue, on
  // garde la valeur null (pas blocant).
  const missingEmail = members.filter((m) => !m.email).map((m) => m.user_id);
  const resolvedEmails = new Map<string, string>();
  if (missingEmail.length > 0) {
    await Promise.all(
      Array.from(new Set(missingEmail)).map(async (uid) => {
        try {
          const { data } = await supabaseAdmin.auth.admin.getUserById(uid);
          if (data?.user?.email) resolvedEmails.set(uid, data.user.email);
        } catch (err) {
          console.warn(`[admin/members] getUserById fail uid=${uid}`, err);
        }
      }),
    );
  }
  const enriched = members.map((m) => ({
    ...m,
    email: m.email ?? resolvedEmails.get(m.user_id) ?? null,
  }));
  res.json({ members: enriched });
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

// ───── YouTube data refresh — feat/youtube-compliance ────────────────────
//
// POST /api/admin/refresh-youtube-data — super-admin only. Déclenche
// manuellement un cycle de rafraîchissement des données YouTube stockées
// (workspace Tracks + OfficialPlaylistTracks). Utile pour test + intervention
// d'urgence si le cron automatique horaire est trop lent à propager une
// correction.
//
// Body optionnel :
//   { max?: number } — limite tracks par run (défaut 500)
//
// Réponse : { ok, stats: { checked, updated, unplayable, errored, durationMs, source } }
//
// Audit conformité YouTube API Services Developer Policies III.E.4.

const refreshYtBody = z.object({
  max: z.number().int().min(1).max(2000).optional(),
});

router.post('/refresh-youtube-data', async (req: Request, res: Response): Promise<void> => {
  const parsed = refreshYtBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
    return;
  }
  if (!process.env.YOUTUBE_API_KEY) {
    res.status(503).json({
      error: { code: 'YT_API_KEY_MISSING', message: 'YouTube API non configurée côté serveur' },
    });
    return;
  }
  try {
    const { refreshYouTubeData } = await import('../lib/youtubeRefresh.js');
    const stats = await refreshYouTubeData('admin_manual', parsed.data.max ?? 500);
    res.json({ ok: true, stats });
  } catch (err: unknown) {
    console.error('[POST /admin/refresh-youtube-data] error:', err);
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    res.status(500).json({ error: { code: 'REFRESH_FAILED', message } });
  }
});

// ───── Voice Cascade Analytics (feat/voice-cascade-l3-assemblyai) ────────
//
// GET /api/admin/voice-analytics?days=7
//
// Agrège les voice_transcripts persistés par la cascade (champ `level`) sur
// la fenêtre demandée. Sert le dashboard /admin/voice-analytics (super admin).
//
// Output :
//   - distribution : count par niveau (web-speech / deepgram / whisper-fallback
//     / assemblyai / null pour les anciennes lignes)
//   - avg_latency_ms par niveau
//   - escalation_rate (% des transcripts L2 → L3)
//   - estimated_cost_eur : approximation basée sur les pricing publics
//     * Deepgram Nova-3 : ~$0.0043/min (count × ~10s mean ÷ 60)
//     * AssemblyAI Universal-2 : ~$0.37/h = ~$0.0062/min
//     * Whisper : ~$0.006/min
//     * web-speech : gratuit
//   On convertit USD→EUR à 0.92 (ordre de grandeur — chiffre d'aide
//   décisionnelle, pas comptable).

router.get('/voice-analytics', async (req: Request, res: Response): Promise<void> => {
  const days = Math.min(Math.max(Number.parseInt(String(req.query.days ?? '7'), 10) || 7, 1), 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    // Group by level, agrégeant count + sum(latency_ms) + sum(matched_artist).
    const rows = await prisma.voiceTranscript.groupBy({
      by: ['level'],
      where: { created_at: { gte: since } },
      _count: { _all: true },
      _avg: { latency_ms: true, confidence: true },
      _sum: { latency_ms: true },
    });

    const distribution = rows.map((r) => ({
      level: r.level ?? 'unknown',
      count: r._count._all,
      avg_latency_ms: r._avg.latency_ms ? Math.round(r._avg.latency_ms) : null,
      avg_confidence: r._avg.confidence ? Number(r._avg.confidence.toFixed(3)) : null,
    }));

    const total = distribution.reduce((s, r) => s + r.count, 0);
    const byLevel = (lvl: string): { count: number; avg_latency_ms: number | null } => {
      const row = distribution.find((r) => r.level === lvl);
      return { count: row?.count ?? 0, avg_latency_ms: row?.avg_latency_ms ?? null };
    };

    const l1 = byLevel('web-speech');
    const l2 = byLevel('deepgram');
    const l2fb = byLevel('whisper-fallback');
    const l3 = byLevel('assemblyai');

    // Estimations coût (ordre de grandeur).
    const usdToEur = 0.92;
    // Mean buzz audio ≈ 6s (capture VAD-cut). On approxime minute-équivalent.
    const meanSec = 6;
    const minPer = (count: number): number => (count * meanSec) / 60;
    const cost = {
      deepgram: minPer(l2.count) * 0.0043 * usdToEur,
      whisper_fallback: minPer(l2fb.count) * 0.006 * usdToEur,
      assemblyai: minPer(l3.count) * 0.0062 * usdToEur,
      total: 0,
    };
    cost.total = cost.deepgram + cost.whisper_fallback + cost.assemblyai;

    const escalation_rate_l2_l3 = l2.count > 0 ? l3.count / l2.count : 0;

    res.json({
      window_days: days,
      since: since.toISOString(),
      total,
      distribution,
      summary: {
        l1_count: l1.count,
        l2_count: l2.count,
        l2_fallback_count: l2fb.count,
        l3_count: l3.count,
        l1_avg_latency_ms: l1.avg_latency_ms,
        l2_avg_latency_ms: l2.avg_latency_ms,
        l3_avg_latency_ms: l3.avg_latency_ms,
        escalation_rate_l2_l3: Number(escalation_rate_l2_l3.toFixed(3)),
      },
      cost_estimate_eur: {
        deepgram: Number(cost.deepgram.toFixed(4)),
        whisper_fallback: Number(cost.whisper_fallback.toFixed(4)),
        assemblyai: Number(cost.assemblyai.toFixed(4)),
        total: Number(cost.total.toFixed(4)),
      },
    });
  } catch (err) {
    console.error('[GET /admin/voice-analytics] error:', err);
    res.status(500).json({ error: { code: 'ANALYTICS_FAILED', message: (err as Error).message } });
  }
});

export default router;
