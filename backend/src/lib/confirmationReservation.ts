/**
 * feat/guide-reservation — e-mail de confirmation au client, avec le mode
 * d'emploi (PDF joint + lien). Appelé quand la réservation devient jouable :
 * paiement encaissé (webhook Stripe) ou partie offerte par code.
 * Best-effort : une erreur d'envoi ne bloque jamais la réservation.
 */
import { prisma } from './prisma.js';
import { confirmationReservationEmail, sendNotificationEmail } from './email.js';
import { texteCreneau } from './reservationsCommun.js';

export async function envoyerConfirmationReservation(reservationId: string): Promise<void> {
  try {
    const r = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        demandeur_email: true,
        debut: true,
        fin: true,
        statut: true,
        prix_cents: true,
        workspace_id: true,
      },
    });
    if (!r?.demandeur_email) return;
    if (r.statut !== 'PAYEE' && r.statut !== 'GRATUITE') return;
    const etab = await prisma.establishment.findFirst({
      where: { workspace_id: r.workspace_id },
      select: { default_language: true },
      orderBy: { created_at: 'asc' },
    });
    const locale = etab?.default_language ?? 'fr';
    const mail = confirmationReservationEmail({
      locale,
      creneau: locale.startsWith('en') ? creneauEn(r.debut, r.fin) : texteCreneau(r.debut, r.fin),
      prixCents: r.statut === 'GRATUITE' ? null : r.prix_cents,
    });
    const res = await sendNotificationEmail({ to: [r.demandeur_email], ...mail });
    console.info(
      `[Email] confirmation réservation=${reservationId} → ${res.ok ? 'envoyée' : `non envoyée (${res.skipReason ?? res.errorMessage ?? '?'})`}`,
    );
  } catch (err) {
    console.error(`[Email] confirmation réservation=${reservationId} : échec`, err);
  }
}

/** « Friday 17 October, 20:00 → 23:00 », heure de Luxembourg. */
function creneauEn(debut: Date, fin: Date): string {
  const tz = 'Europe/Luxembourg';
  const jour = debut.toLocaleDateString('en-GB', {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const h = (d: Date): string =>
    d.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  return `${jour}, ${h(debut)} → ${h(fin)}`;
}
