/**
 * Routes /api/admin/users/* — feat/admin-users-and-email-notifications.
 *
 * Page super-admin de gestion des utilisateurs (WorkspaceMember en
 * pratique, vu que Tutti délègue auth.users à Supabase).
 *
 *   GET    /api/admin/users           : liste paginée + sessions agrégées
 *   GET    /api/admin/users/:id       : détail user + 50 dernières sessions
 *   PATCH  /api/admin/users/:id       : { is_blocked? } / reset_freemium?
 *
 * Toutes les routes : requireAuth + requireSuperAdmin.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireSuperAdmin } from '../middleware/tenant.js';

const router: Router = Router();
router.use(requireAuth, requireSuperAdmin);

// ───── Helpers ────────────────────────────────────────────────────────────

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

// ───── GET / : liste users + agrégats ────────────────────────────────────

router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const members = await prisma.workspaceMember.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        workspace: { select: { id: true, name: true, plan: true } },
      },
    });

    // Agrégats sessions : pour chaque workspace_id, count total + count
    // ce mois. Group by establishment.workspace_id via aggregations.
    const monthStart = startOfMonth(new Date());
    const sessionsTotalByWorkspace = await prisma.session.groupBy({
      by: ['establishment_id'],
      _count: { _all: true },
    });
    const sessionsThisMonthByWorkspace = await prisma.session.groupBy({
      by: ['establishment_id'],
      where: { created_at: { gte: monthStart } },
      _count: { _all: true },
    });

    // Map establishment_id → workspace_id pour rattacher les compteurs au
    // user via workspace.
    const establishments = await prisma.establishment.findMany({
      select: { id: true, workspace_id: true },
    });
    const estToWs = new Map(establishments.map((e) => [e.id, e.workspace_id]));

    const totalByWs = new Map<string, number>();
    for (const row of sessionsTotalByWorkspace) {
      const ws = estToWs.get(row.establishment_id);
      if (ws) totalByWs.set(ws, (totalByWs.get(ws) ?? 0) + row._count._all);
    }
    const monthByWs = new Map<string, number>();
    for (const row of sessionsThisMonthByWorkspace) {
      const ws = estToWs.get(row.establishment_id);
      if (ws) monthByWs.set(ws, (monthByWs.get(ws) ?? 0) + row._count._all);
    }

    const users = members.map((m) => ({
      id: m.id,
      user_id: m.user_id,
      email: m.email,
      role: m.role,
      status: m.status,
      is_blocked: m.is_blocked,
      blocked_at: m.blocked_at?.toISOString() ?? null,
      created_at: m.created_at.toISOString(),
      last_seen_at: m.last_seen_at?.toISOString() ?? null,
      freemium_sessions_count: m.freemium_sessions_count,
      freemium_period_start: m.freemium_period_start.toISOString(),
      tier: m.workspace.plan === 'FREE' ? 'free' : 'premium',
      can_use_tracks: m.can_use_tracks,
      can_use_quizz: m.can_use_quizz,
      workspace: m.workspace,
      sessions_total: totalByWs.get(m.workspace_id) ?? 0,
      sessions_this_month: monthByWs.get(m.workspace_id) ?? 0,
    }));

    res.json({ users });
  } catch (err) {
    console.error('[GET /admin/users] error:', err);
    res
      .status(500)
      .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur récupération users' } });
  }
});

// ───── GET /:id : détail + 50 dernières sessions ─────────────────────────

router.get('/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const m = await prisma.workspaceMember.findUnique({
      where: { id: req.params.id },
      include: {
        workspace: {
          include: {
            establishments: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!m) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User introuvable' } });
      return;
    }

    const establishmentIds = m.workspace.establishments.map((e) => e.id);
    const monthStart = startOfMonth(new Date());

    const [sessions, sessionsTotal, sessionsThisMonth] = await Promise.all([
      prisma.session.findMany({
        where: { establishment_id: { in: establishmentIds } },
        orderBy: { created_at: 'desc' },
        take: 50,
        select: {
          id: true,
          short_code: true,
          name: true,
          game_type: true,
          status: true,
          mode: true,
          created_at: true,
          started_at: true,
          ended_at: true,
          _count: { select: { participants: true } },
          rounds: {
            select: {
              id: true,
              position: true,
              status: true,
              playlist: { select: { name: true } },
            },
            orderBy: { position: 'asc' },
            take: 5,
          },
        },
      }),
      prisma.session.count({ where: { establishment_id: { in: establishmentIds } } }),
      prisma.session.count({
        where: { establishment_id: { in: establishmentIds }, created_at: { gte: monthStart } },
      }),
    ]);

    // Distribution sessions par mois (12 derniers mois) pour graphique.
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);
    const monthlyDistRaw = await prisma.session.findMany({
      where: {
        establishment_id: { in: establishmentIds },
        created_at: { gte: twelveMonthsAgo },
      },
      select: { created_at: true },
    });
    const monthlyMap = new Map<string, number>();
    for (const s of monthlyDistRaw) {
      const key = `${s.created_at.getFullYear()}-${String(s.created_at.getMonth() + 1).padStart(2, '0')}`;
      monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + 1);
    }
    const monthly_distribution: Array<{ month: string; count: number }> = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(twelveMonthsAgo);
      d.setMonth(d.getMonth() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthly_distribution.push({ month: key, count: monthlyMap.get(key) ?? 0 });
    }

    res.json({
      user: {
        id: m.id,
        user_id: m.user_id,
        email: m.email,
        role: m.role,
        status: m.status,
        is_blocked: m.is_blocked,
        blocked_at: m.blocked_at?.toISOString() ?? null,
        blocked_by: m.blocked_by,
        created_at: m.created_at.toISOString(),
        last_seen_at: m.last_seen_at?.toISOString() ?? null,
        approved_at: m.approved_at?.toISOString() ?? null,
        freemium_sessions_count: m.freemium_sessions_count,
        freemium_period_start: m.freemium_period_start.toISOString(),
        tier: m.workspace.plan === 'FREE' ? 'free' : 'premium',
        can_use_tracks: m.can_use_tracks,
        can_use_quizz: m.can_use_quizz,
        referral_code: m.referral_code,
        referrer_code: m.referrer_code,
        workspace: {
          id: m.workspace.id,
          name: m.workspace.name,
          plan: m.workspace.plan,
          establishments: m.workspace.establishments,
        },
        sessions_total: sessionsTotal,
        sessions_this_month: sessionsThisMonth,
        recent_sessions: sessions.map((s) => ({
          id: s.id,
          short_code: s.short_code,
          name: s.name,
          game_type: s.game_type,
          status: s.status,
          mode: s.mode,
          created_at: s.created_at.toISOString(),
          started_at: s.started_at?.toISOString() ?? null,
          ended_at: s.ended_at?.toISOString() ?? null,
          participants_count: s._count.participants,
          duration_seconds:
            s.started_at && s.ended_at
              ? Math.round((s.ended_at.getTime() - s.started_at.getTime()) / 1000)
              : null,
          playlists: s.rounds.map((r) => r.playlist.name),
        })),
        monthly_distribution,
      },
    });
  } catch (err) {
    console.error('[GET /admin/users/:id] error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur détail user' } });
  }
});

// ───── PATCH /:id : block/unblock + reset freemium ──────────────────────

const patchBody = z.object({
  is_blocked: z.boolean().optional(),
  reset_freemium: z.boolean().optional(),
  // feat/granular-tracks-quizz-access — toggles par mode
  can_use_tracks: z.boolean().optional(),
  can_use_quizz: z.boolean().optional(),
});

router.patch('/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const parsed = patchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
    return;
  }
  const exists = await prisma.workspaceMember.findUnique({ where: { id: req.params.id } });
  if (!exists) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User introuvable' } });
    return;
  }
  const data: Record<string, unknown> = {};
  if (parsed.data.is_blocked !== undefined) {
    data.is_blocked = parsed.data.is_blocked;
    data.blocked_at = parsed.data.is_blocked ? new Date() : null;
    data.blocked_by = parsed.data.is_blocked ? (req.userId ?? null) : null;
  }
  if (parsed.data.reset_freemium === true) {
    data.freemium_sessions_count = 0;
    data.freemium_period_start = new Date();
  }
  if (parsed.data.can_use_tracks !== undefined) {
    data.can_use_tracks = parsed.data.can_use_tracks;
  }
  if (parsed.data.can_use_quizz !== undefined) {
    data.can_use_quizz = parsed.data.can_use_quizz;
  }
  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: { code: 'NO_CHANGES', message: 'Aucun changement' } });
    return;
  }
  const updated = await prisma.workspaceMember.update({
    where: { id: req.params.id },
    data,
  });
  console.info(
    `[Admin] User ${updated.email ?? updated.id} updated by ${req.userEmail}: ${JSON.stringify(data)}`,
  );
  res.json({
    user: {
      id: updated.id,
      is_blocked: updated.is_blocked,
      blocked_at: updated.blocked_at?.toISOString() ?? null,
      freemium_sessions_count: updated.freemium_sessions_count,
      freemium_period_start: updated.freemium_period_start.toISOString(),
      can_use_tracks: updated.can_use_tracks,
      can_use_quizz: updated.can_use_quizz,
    },
  });
});

export default router;
