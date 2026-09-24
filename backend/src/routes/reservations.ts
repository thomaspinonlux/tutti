/**
 * routes/reservations.ts — feat/reservation-de-creneaux — CÔTÉ CLIENT
 *
 * Thomas : « je veux que les clients qui veulent acheter une partie puissent
 * se connecter, payer et choisir leur créneau […] les personnes doivent
 * s'enregistrer, je donne mon accord sur le créneau ».
 *
 * Parcours : le client DEMANDE un créneau (durée à son choix, dans les bornes
 * des réglages) → le propriétaire ACCEPTE en fixant le prix → le client PAIE.
 * Un code gratuit rend la partie offerte : pas de paiement.
 *
 * OUVERT AUX COMPTES EN ATTENTE : c'est justement en demandant un créneau
 * qu'un nouveau client se fait connaître. L'accord du propriétaire sur le
 * créneau vaut validation du compte.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import {
  STATUTS_QUI_OCCUPENT,
  aDeLaPlace,
  capaciteClients,
  formaterDuree,
  normaliserCode,
  verifierCreneau,
} from '../lib/reservations.js';
import { creerCheckout, stripeConfigure, StripeError } from '../lib/stripe.js';
import { calculerPrixCents, reservationAutomatique } from '../lib/tarifs.js';
import { getNotificationRecipients, sendNotificationEmail } from '../lib/email.js';
import { lireReglages, publierReservation, texteCreneau } from '../lib/reservationsCommun.js';

const router: Router = Router();
router.use(requireAuth);

/** Le membre de l'utilisateur connecté, QUEL QUE SOIT son statut. */
async function membreCourant(userId: string): Promise<{ workspace_id: string; email: string | null } | null> {
  return prisma.workspaceMember.findFirst({
    where: { user_id: userId },
    orderBy: { created_at: 'asc' },
    select: { workspace_id: true, email: true },
  });
}

/**
 * feat/reservation-automatique — le paiement (ou un code offert) vaut
 * validation du compte : plus personne n'attend un accord manuel.
 */
async function approuverMembres(workspaceId: string): Promise<void> {
  await prisma.workspaceMember.updateMany({
    where: { workspace_id: workspaceId, status: 'PENDING' },
    data: { status: 'APPROVED', approved_at: new Date() },
  });
}

/** Bornes de durée + capacité, pour que l'écran les affiche. */
router.get('/reglages', async (_req: Request, res: Response): Promise<void> => {
  const [reglages, comptes] = await Promise.all([
    lireReglages(),
    prisma.appleMusicAccount.count({ where: { actif: true } }),
  ]);
  res.json({
    duree_min_minutes: reglages.duree_min_minutes,
    duree_max_minutes: reglages.duree_max_minutes,
    ouverture_avant_minutes: reglages.ouverture_avant_minutes,
    capacite: capaciteClients(comptes),
    paiement_ouvert: stripeConfigure(),
    // feat/reservation-automatique — le client voit le tarif et sait s'il
    // peut réserver et payer sans attendre notre accord.
    tarif_horaire_cents: reglages.tarif_horaire_cents,
    tarif_horaire_soir_cents: reglages.tarif_horaire_soir_cents,
    heure_soiree_debut: reglages.heure_soiree_debut,
    jours_soiree: reglages.jours_soiree,
    reservation_automatique: reservationAutomatique(reglages) && stripeConfigure(),
  });
});

const creneauSchema = z.object({
  debut: z.string().datetime({ offset: true }),
  fin: z.string().datetime({ offset: true }),
});

/** Le créneau est-il encore libre ? Répond avant que le client n'envoie. */
router.get('/disponibilite', async (req: Request, res: Response): Promise<void> => {
  const parsed = creneauSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'debut et fin requis' } });
    return;
  }
  const c = { debut: new Date(parsed.data.debut), fin: new Date(parsed.data.fin) };
  const [comptes, pris] = await Promise.all([
    prisma.appleMusicAccount.count({ where: { actif: true } }),
    prisma.reservation.findMany({
      where: { statut: { in: [...STATUTS_QUI_OCCUPENT] }, debut: { lt: c.fin }, fin: { gt: c.debut } },
      select: { debut: true, fin: true },
    }),
  ]);
  res.json({ libre: aDeLaPlace(pris, c, capaciteClients(comptes)) });
});

/** Mes réservations, les plus récentes d'abord. */
router.get('/mes', async (req: Request, res: Response): Promise<void> => {
  const membre = await membreCourant(req.userId!);
  if (!membre) {
    res.json({ reservations: [] });
    return;
  }
  const lignes = await prisma.reservation.findMany({
    where: { workspace_id: membre.workspace_id },
    orderBy: { debut: 'desc' },
    take: 50,
    include: { code_gratuit: { select: { code: true } } },
  });
  res.json({ reservations: lignes.map(publierReservation) });
});

/** Prix d'un créneau, calculé au prorata des heures (null si tarif non fixé). */
router.get('/devis', async (req: Request, res: Response): Promise<void> => {
  const parsed = creneauSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'debut et fin requis' } });
    return;
  }
  const reglages = await lireReglages();
  const prix = calculerPrixCents(new Date(parsed.data.debut), new Date(parsed.data.fin), reglages);
  res.json({ prix_cents: prix, automatique: reservationAutomatique(reglages) && stripeConfigure() });
});

const demandeSchema = creneauSchema.extend({
  message: z.string().trim().max(500).optional(),
  code: z.string().trim().max(40).optional(),
});

/** Demander un créneau. */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = demandeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Créneau invalide' } });
    return;
  }
  const membre = await membreCourant(req.userId!);
  if (!membre) {
    res.status(404).json({ error: { code: 'NO_WORKSPACE', message: 'Compte incomplet : reconnecte-toi.' } });
    return;
  }
  const c = { debut: new Date(parsed.data.debut), fin: new Date(parsed.data.fin) };
  const reglages = await lireReglages();
  const probleme = verifierCreneau(c, reglages);
  if (probleme) {
    res.status(400).json({ error: { code: 'CRENEAU_INVALIDE', message: probleme } });
    return;
  }

  // Code gratuit : vérifié maintenant pour prévenir tout de suite, mais
  // CONSOMMÉ seulement à l'acceptation — un refus ne brûle pas le code.
  let codeId: string | null = null;
  if (parsed.data.code) {
    const code = await prisma.codeGratuit.findUnique({ where: { code: normaliserCode(parsed.data.code) } });
    const expire = code?.expire_le && code.expire_le.getTime() < Date.now();
    if (!code || !code.actif || expire || code.utilisations >= code.utilisations_max) {
      res.status(400).json({ error: { code: 'CODE_INVALIDE', message: 'Ce code gratuit n’est pas valable.' } });
      return;
    }
    codeId = code.id;
  }

  // Inutile de demander un créneau déjà complet : on le dit tout de suite.
  const [comptes, pris] = await Promise.all([
    prisma.appleMusicAccount.count({ where: { actif: true } }),
    prisma.reservation.findMany({
      where: { statut: { in: [...STATUTS_QUI_OCCUPENT] }, debut: { lt: c.fin }, fin: { gt: c.debut } },
      select: { debut: true, fin: true },
    }),
  ]);
  if (!aDeLaPlace(pris, c, capaciteClients(comptes))) {
    res.status(409).json({
      error: { code: 'CRENEAU_COMPLET', message: 'Ce créneau est complet. Choisis un autre horaire.' },
    });
    return;
  }

  // feat/reservation-automatique — QUAND LE TARIF EST FIXÉ, PERSONNE N'ATTEND.
  // Le prix se calcule à l'heure, la demande naît ACCEPTEE (donc payable tout
  // de suite), et le paiement vaut validation du compte. Avec un code offert,
  // la partie est confirmée sur-le-champ. Sans tarif ni validation
  // automatique, on retombe sur la demande classique, décidée à la main.
  const auto = reservationAutomatique(reglages) && stripeConfigure();
  const prixAuto = auto ? calculerPrixCents(c.debut, c.fin, reglages) : null;
  const offerte = auto && codeId !== null;

  const reservation = await prisma.reservation.create({
    data: {
      workspace_id: membre.workspace_id,
      demandeur_user_id: req.userId!,
      demandeur_email: membre.email ?? req.userEmail ?? null,
      debut: c.debut,
      fin: c.fin,
      message_client: parsed.data.message || null,
      code_gratuit_id: codeId,
      ...(offerte
        ? { statut: 'GRATUITE' as const, prix_cents: 0, decidee_le: new Date() }
        : prixAuto !== null
          ? { statut: 'ACCEPTEE' as const, prix_cents: prixAuto, decidee_le: new Date() }
          : {}),
    },
    include: { code_gratuit: { select: { code: true } } },
  });

  // Partie offerte : le code est consommé et le compte est validé tout de
  // suite — il n'y aura pas de paiement pour le faire.
  if (offerte && codeId) {
    await prisma.codeGratuit.update({
      where: { id: codeId },
      data: { utilisations: { increment: 1 } },
    });
    await approuverMembres(membre.workspace_id);
  }

  // Le propriétaire est prévenu : c'est lui qui décide.
  const duree = formaterDuree(Math.round((c.fin.getTime() - c.debut.getTime()) / 60_000));
  void sendNotificationEmail({
    to: getNotificationRecipients(),
    subject: auto
      ? `Tutti — créneau réservé (${texteCreneau(c.debut, c.fin)})`
      : `Tutti — nouvelle demande de créneau (${texteCreneau(c.debut, c.fin)})`,
    html:
      `<p>Nouvelle demande de <strong>${echapper(reservation.demandeur_email ?? 'client')}</strong>.</p>` +
      `<p>Créneau : <strong>${texteCreneau(c.debut, c.fin)}</strong> (${duree})` +
      (codeId ? ` — <strong>code gratuit</strong>` : '') +
      `</p>` +
      (reservation.message_client ? `<p>Message : ${echapper(reservation.message_client)}</p>` : '') +
      (auto
        ? `<p>Réservation automatique : rien à faire. ${offerte ? 'Partie offerte (code).' : 'Le client paie en ligne.'}</p>`
        : `<p>À accepter ou refuser dans le back-office, rubrique Réservations.</p>`),
  }).catch(() => undefined);

  res.status(201).json({ reservation: publierReservation(reservation) });
});

/** Annuler sa demande — tant qu'elle n'est pas payée. */
router.post('/:id/annuler', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const membre = await membreCourant(req.userId!);
  const r = await prisma.reservation.findUnique({ where: { id: req.params.id } });
  if (!membre || !r || r.workspace_id !== membre.workspace_id) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Réservation introuvable' } });
    return;
  }
  if (r.statut !== 'DEMANDEE' && r.statut !== 'ACCEPTEE') {
    res.status(409).json({
      error: { code: 'NON_ANNULABLE', message: 'Cette réservation ne peut plus être annulée ici : contacte-nous.' },
    });
    return;
  }
  await prisma.reservation.update({ where: { id: r.id }, data: { statut: 'ANNULEE' } });
  res.json({ ok: true });
});

/** Payer une réservation acceptée : renvoie l'adresse de la page Stripe. */
router.post('/:id/payer', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const membre = await membreCourant(req.userId!);
  const r = await prisma.reservation.findUnique({ where: { id: req.params.id } });
  if (!membre || !r || r.workspace_id !== membre.workspace_id) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Réservation introuvable' } });
    return;
  }
  if (r.statut !== 'ACCEPTEE' || !r.prix_cents || r.prix_cents <= 0) {
    res.status(409).json({ error: { code: 'NON_PAYABLE', message: 'Rien à payer pour cette réservation.' } });
    return;
  }
  if (!stripeConfigure()) {
    res.status(503).json({
      error: { code: 'PAIEMENT_FERME', message: "Le paiement en ligne n'est pas encore ouvert." },
    });
    return;
  }
  const site = (process.env.FRONTEND_URL ?? 'https://tuttiparty.app').replace(/\/$/, '');
  try {
    const checkout = await creerCheckout({
      reservationId: r.id,
      montantCents: r.prix_cents,
      devise: r.devise,
      libelle: `Partie Tutti — ${texteCreneau(r.debut, r.fin)}`,
      emailClient: r.demandeur_email,
      urlSucces: `${site}/reserver?paiement=ok&r=${r.id}`,
      urlAnnulation: `${site}/reserver?paiement=annule&r=${r.id}`,
    });
    await prisma.reservation.update({ where: { id: r.id }, data: { stripe_checkout_id: checkout.id } });
    res.json({ url: checkout.url });
  } catch (err: unknown) {
    const message = err instanceof StripeError ? err.message : 'Paiement indisponible';
    console.error('[Réservations] ouverture du paiement impossible :', err);
    res.status(502).json({ error: { code: 'STRIPE', message } });
  }
});

function echapper(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export default router;
