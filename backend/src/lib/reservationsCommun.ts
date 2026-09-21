/**
 * reservationsCommun.ts — feat/reservation-de-creneaux
 *
 * Ce que partagent les routes client, propriétaire et webhook : lecture des
 * réglages, forme publique d'une réservation, texte d'un créneau.
 */
import type { Reservation } from '@prisma/client';
import { prisma } from './prisma.js';
import type { Reglages } from './reservations.js';

const FUSEAU = 'Europe/Luxembourg';

export async function lireReglages(): Promise<Reglages> {
  const r = await prisma.reglagesReservation.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
  return {
    duree_min_minutes: r.duree_min_minutes,
    duree_max_minutes: r.duree_max_minutes,
    ouverture_avant_minutes: r.ouverture_avant_minutes,
  };
}

/** « samedi 3 octobre, 20:00 → 23:00 », à l'heure de Luxembourg. */
export function texteCreneau(debut: Date, fin: Date): string {
  const jour = debut.toLocaleDateString('fr-FR', { timeZone: FUSEAU, weekday: 'long', day: 'numeric', month: 'long' });
  const heure = (d: Date): string =>
    d.toLocaleTimeString('fr-FR', { timeZone: FUSEAU, hour: '2-digit', minute: '2-digit' });
  return `${jour}, ${heure(debut)} → ${heure(fin)}`;
}

type AvecCode = Reservation & { code_gratuit?: { code: string } | null };

/** Ce qui sort du serveur. Jamais l'identifiant de paiement interne. */
export function publierReservation(r: AvecCode): Record<string, unknown> {
  return {
    id: r.id,
    debut: r.debut.toISOString(),
    fin: r.fin.toISOString(),
    statut: r.statut,
    prix_cents: r.prix_cents,
    devise: r.devise,
    code_gratuit: r.code_gratuit?.code ?? null,
    message_client: r.message_client,
    motif_refus: r.motif_refus,
    payee_le: r.payee_le?.toISOString() ?? null,
    created_at: r.created_at.toISOString(),
  };
}
