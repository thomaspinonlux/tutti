/**
 * routes/adminReservations.ts — feat/reservation-de-creneaux — CÔTÉ PROPRIÉTAIRE
 *
 * Thomas : « je donne mon accord sur le créneau et comme cela on s'assure que
 * nous avons [N] parties max en cours en même temps — et moi je garde
 * toujours un compte disponible ».
 *
 * ACCEPTER = fixer le prix. Prix 0 ou code gratuit → partie GRATUITE, jouable
 * sans paiement. Sinon ACCEPTEE, en attente du paiement du client.
 *
 * La capacité est revérifiée ICI, dans une transaction SERIALIZABLE : deux
 * acceptations à la même seconde ne peuvent pas dépasser le plafond.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireWorkspace } from '../middleware/tenant.js';
import { requireOwner } from '../middleware/proprietaire.js';
import {
  STATUTS_QUI_OCCUPENT,
  aDeLaPlace,
  capaciteClients,
  genererCode,
  normaliserCode,
} from '../lib/reservations.js';
import { sendNotificationEmail } from '../lib/email.js';
import { lireReglages, publierReservation, texteCreneau } from '../lib/reservationsCommun.js';

const router: Router = Router();
router.use(requireAuth, requireWorkspace, requireOwner);

// ── Réservations ──────────────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response): Promise<void> => {
  const statut = typeof req.query.statut === 'string' ? req.query.statut : undefined;
  const lignes = await prisma.reservation.findMany({
    where: statut ? { statut: statut as never } : {},
    orderBy: [{ debut: 'asc' }],
    take: 200,
    include: {
      code_gratuit: { select: { code: true } },
      workspace: { select: { name: true } },
    },
  });
  const comptes = await prisma.appleMusicAccount.count({ where: { actif: true } });
  res.json({
    capacite: capaciteClients(comptes),
    comptes_actifs: comptes,
    reservations: lignes.map((r) => ({
      ...publierReservation(r),
      client: r.workspace.name,
      email: r.demandeur_email,
    })),
  });
});

class Complet extends Error {}

const accepterSchema = z.object({
  /** En centimes. 0 = offert. Ignoré si la demande porte un code gratuit. */
  prix_cents: z.number().int().min(0).max(1_000_000),
});

router.post('/:id/accepter', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const parsed = accepterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Prix requis (en centimes)' } });
    return;
  }
  try {
    const resultat = await prisma.$transaction(
      async (tx) => {
        const r = await tx.reservation.findUnique({ where: { id: req.params.id } });
        if (!r) return null;
        if (r.statut !== 'DEMANDEE') {
          throw new Error(`Cette demande est déjà ${r.statut.toLowerCase()}.`);
        }
        const comptes = await tx.appleMusicAccount.count({ where: { actif: true } });
        const pris = await tx.reservation.findMany({
          where: {
            id: { not: r.id },
            statut: { in: [...STATUTS_QUI_OCCUPENT] },
            debut: { lt: r.fin },
            fin: { gt: r.debut },
          },
          select: { debut: true, fin: true },
        });
        if (!aDeLaPlace(pris, r, capaciteClients(comptes))) throw new Complet();

        // Code gratuit : consommé MAINTENANT, et revérifié (il a pu être
        // utilisé par une autre demande entre-temps).
        let gratuite = parsed.data.prix_cents === 0;
        if (r.code_gratuit_id) {
          const code = await tx.codeGratuit.findUnique({ where: { id: r.code_gratuit_id } });
          const expire = code?.expire_le && code.expire_le.getTime() < Date.now();
          if (!code || !code.actif || expire || code.utilisations >= code.utilisations_max) {
            throw new Error("Le code gratuit de cette demande n'est plus valable : fixe un prix ou refuse.");
          }
          await tx.codeGratuit.update({ where: { id: code.id }, data: { utilisations: { increment: 1 } } });
          gratuite = true;
        }

        const maj = await tx.reservation.update({
          where: { id: r.id },
          data: {
            statut: gratuite ? 'GRATUITE' : 'ACCEPTEE',
            prix_cents: gratuite ? 0 : parsed.data.prix_cents,
            decidee_le: new Date(),
            decidee_par: req.userId ?? null,
          },
          include: { code_gratuit: { select: { code: true } } },
        });

        // L'accord sur le créneau vaut validation du compte : sans ça, un
        // nouveau client resterait bloqué sur « compte en attente » et ne
        // pourrait pas lancer la partie qu'on vient de lui accorder.
        await tx.workspaceMember.updateMany({
          where: { workspace_id: r.workspace_id, status: 'PENDING' },
          data: { status: 'APPROVED', approved_at: new Date(), approved_by: req.userId ?? null },
        });
        return maj;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (!resultat) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Réservation introuvable' } });
      return;
    }

    if (resultat.demandeur_email) {
      const creneau = texteCreneau(resultat.debut, resultat.fin);
      const gratuite = resultat.statut === 'GRATUITE';
      void sendNotificationEmail({
        to: [resultat.demandeur_email],
        subject: `Tutti — ton créneau est accepté (${creneau})`,
        html:
          `<p>Bonne nouvelle : ton créneau du <strong>${creneau}</strong> est accepté.</p>` +
          (gratuite
            ? `<p>Cette partie est <strong>offerte</strong> : rien à payer.</p>`
            : `<p>Prix : <strong>${(resultat.prix_cents! / 100).toFixed(2).replace('.', ',')} €</strong>. ` +
              `Règle-le depuis <a href="https://tuttiparty.app/reserver">ton espace réservation</a> pour le confirmer.</p>`) +
          `<p>Le jour J, tu pourras ouvrir ta partie depuis ton compte Tutti.</p>`,
      }).catch(() => undefined);
    }
    res.json({ reservation: publierReservation(resultat) });
  } catch (err: unknown) {
    if (err instanceof Complet) {
      res.status(409).json({
        error: {
          code: 'CRENEAU_COMPLET',
          message: 'Complet sur ce créneau : un compte Apple Music reste réservé à la brasserie.',
        },
      });
      return;
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
      res.status(409).json({ error: { code: 'CONFLIT', message: 'Deux décisions en même temps : réessaie.' } });
      return;
    }
    const message = err instanceof Error ? err.message : 'Erreur';
    res.status(409).json({ error: { code: 'NON_ACCEPTABLE', message } });
  }
});

const refuserSchema = z.object({ motif: z.string().trim().max(500).optional() });

router.post('/:id/refuser', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const parsed = refuserSchema.safeParse(req.body ?? {});
  const motif = parsed.success ? parsed.data.motif || null : null;
  const r = await prisma.reservation.findUnique({ where: { id: req.params.id } });
  if (!r) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Réservation introuvable' } });
    return;
  }
  if (r.statut !== 'DEMANDEE') {
    res.status(409).json({ error: { code: 'NON_REFUSABLE', message: `Déjà ${r.statut.toLowerCase()}.` } });
    return;
  }
  const maj = await prisma.reservation.update({
    where: { id: r.id },
    data: { statut: 'REFUSEE', motif_refus: motif, decidee_le: new Date(), decidee_par: req.userId ?? null },
  });
  if (maj.demandeur_email) {
    void sendNotificationEmail({
      to: [maj.demandeur_email],
      subject: `Tutti — ton créneau n'a pas pu être accepté`,
      html:
        `<p>Ton créneau du <strong>${texteCreneau(maj.debut, maj.fin)}</strong> n'a pas pu être accepté.</p>` +
        (motif ? `<p>${motif.replace(/[<>&]/g, '')}</p>` : '') +
        `<p>Tu peux en demander un autre depuis <a href="https://tuttiparty.app/reserver">ton espace réservation</a>.</p>`,
    }).catch(() => undefined);
  }
  res.json({ ok: true });
});

/** Le propriétaire peut annuler n'importe quelle réservation. */
router.post('/:id/annuler', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const r = await prisma.reservation.findUnique({ where: { id: req.params.id } });
  if (!r) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Réservation introuvable' } });
    return;
  }
  await prisma.reservation.update({ where: { id: r.id }, data: { statut: 'ANNULEE' } });
  // Un paiement déjà encaissé ne se rembourse PAS tout seul : c'est au
  // propriétaire de le faire dans Stripe. On le lui rappelle.
  res.json({ ok: true, rembourser_dans_stripe: r.statut === 'PAYEE' });
});

// ── Codes gratuits ────────────────────────────────────────────────────────

router.get('/codes', async (_req: Request, res: Response): Promise<void> => {
  const codes = await prisma.codeGratuit.findMany({ orderBy: { created_at: 'desc' }, take: 200 });
  res.json({
    codes: codes.map((c) => ({
      id: c.id,
      code: c.code,
      note: c.note,
      utilisations: c.utilisations,
      utilisations_max: c.utilisations_max,
      expire_le: c.expire_le?.toISOString() ?? null,
      actif: c.actif,
      created_at: c.created_at.toISOString(),
    })),
  });
});

const codeSchema = z.object({
  code: z.string().trim().min(4).max(24).optional(),
  note: z.string().trim().max(200).optional(),
  utilisations_max: z.number().int().min(1).max(1000).default(1),
  expire_le: z.string().datetime({ offset: true }).optional(),
});

router.post('/codes', async (req: Request, res: Response): Promise<void> => {
  const parsed = codeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Code invalide' } });
    return;
  }
  const code = parsed.data.code ? normaliserCode(parsed.data.code) : genererCode();
  try {
    const cree = await prisma.codeGratuit.create({
      data: {
        code,
        note: parsed.data.note || null,
        utilisations_max: parsed.data.utilisations_max,
        expire_le: parsed.data.expire_le ? new Date(parsed.data.expire_le) : null,
        cree_par: req.userId ?? null,
      },
    });
    res.status(201).json({ code: { id: cree.id, code: cree.code } });
  } catch (err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      res.status(409).json({ error: { code: 'CODE_EXISTANT', message: 'Ce code existe déjà.' } });
      return;
    }
    throw err;
  }
});

router.post('/codes/:id/desactiver', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  await prisma.codeGratuit.updateMany({ where: { id: req.params.id }, data: { actif: false } });
  res.json({ ok: true });
});

// ── Réglages ──────────────────────────────────────────────────────────────

router.get('/reglages', async (_req: Request, res: Response): Promise<void> => {
  res.json(await lireReglages());
});

const reglagesSchema = z
  .object({
    duree_min_minutes: z.number().int().min(15).max(24 * 60),
    duree_max_minutes: z.number().int().min(15).max(24 * 60),
    ouverture_avant_minutes: z.number().int().min(0).max(24 * 60),
  })
  .refine((v) => v.duree_min_minutes <= v.duree_max_minutes, 'Le minimum dépasse le maximum');

router.put('/reglages', async (req: Request, res: Response): Promise<void> => {
  const parsed = reglagesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Réglages invalides' } });
    return;
  }
  const r = await prisma.reglagesReservation.upsert({
    where: { id: 1 },
    update: parsed.data,
    create: { id: 1, ...parsed.data },
  });
  res.json({
    duree_min_minutes: r.duree_min_minutes,
    duree_max_minutes: r.duree_max_minutes,
    ouverture_avant_minutes: r.ouverture_avant_minutes,
  });
});

export default router;
