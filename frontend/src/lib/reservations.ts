/**
 * reservations.ts — feat/reservation-de-creneaux
 *
 * Client de l'API de réservation : côté client (/api/reservations) et côté
 * propriétaire (/api/gestion-reservations).
 */
import { api } from './api.js';

export type StatutReservation =
  | 'DEMANDEE'
  | 'ACCEPTEE'
  | 'PAYEE'
  | 'GRATUITE'
  | 'REFUSEE'
  | 'ANNULEE';

export interface Reservation {
  id: string;
  debut: string;
  fin: string;
  statut: StatutReservation;
  prix_cents: number | null;
  /** Prix avant remise, quand une offre était active. */
  prix_plein_cents: number | null;
  /** Partie jouée avec le compte Apple Music du client. */
  compte_client: boolean;
  devise: string;
  code_gratuit: string | null;
  message_client: string | null;
  motif_refus: string | null;
  payee_le: string | null;
  created_at: string;
}

export interface ReservationGestion extends Reservation {
  client: string;
  email: string | null;
}

export interface ReglagesPublics {
  duree_min_minutes: number;
  duree_max_minutes: number;
  ouverture_avant_minutes: number;
  capacite: number;
  paiement_ouvert: boolean;
  /** feat/reservation-automatique — tarif horaire (0 = pas de tarif public). */
  tarif_horaire_cents: number;
  tarif_horaire_soir_cents: number;
  heure_soiree_debut: number;
  jours_soiree: string;
  /** true = le client réserve et paie sans attendre notre accord. */
  reservation_automatique: boolean;
  /** feat/offre-de-lancement — remise en cours (0 = aucune). */
  reduction_pct: number;
  reduction_libelle: string;
  reduction_fin: string | null;
}

export interface ReglagesGestion {
  duree_min_minutes: number;
  duree_max_minutes: number;
  ouverture_avant_minutes: number;
  tarif_horaire_cents: number;
  tarif_horaire_soir_cents: number;
  heure_soiree_debut: number;
  jours_soiree: string;
  validation_automatique: boolean;
  tarif_horaire_propre_cents: number;
  tarif_horaire_propre_soir_cents: number;
  validation_auto_comptes: boolean;
  reduction_pct: number;
  reduction_libelle: string;
  reduction_fin: string | null;
}

/** Ce que coûte un créneau, remise comprise. */
export interface Devis {
  prix_cents: number | null;
  prix_plein_cents: number | null;
  reduction_pct: number;
  reduction_libelle: string;
  reduction_fin: string | null;
  automatique: boolean;
  compte_client: boolean;
}

export interface CodeGratuit {
  id: string;
  code: string;
  note: string | null;
  utilisations: number;
  utilisations_max: number;
  expire_le: string | null;
  actif: boolean;
  created_at: string;
}

// ── Client ─────────────────────────────────────────────────────────────────

export const lireReglagesReservation = (): Promise<ReglagesPublics> =>
  api('/api/reservations/reglages');

export const verifierDisponibilite = (debut: string, fin: string): Promise<{ libre: boolean }> =>
  api(
    `/api/reservations/disponibilite?debut=${encodeURIComponent(debut)}&fin=${encodeURIComponent(fin)}`,
  );

export const devisCreneau = (debut: string, fin: string): Promise<Devis> =>
  api(`/api/reservations/devis?debut=${encodeURIComponent(debut)}&fin=${encodeURIComponent(fin)}`);

export const mesReservations = (): Promise<{ reservations: Reservation[] }> =>
  api('/api/reservations/mes');

export const demanderCreneau = (body: {
  debut: string;
  fin: string;
  message?: string;
  code?: string;
}): Promise<{ reservation: Reservation }> => api('/api/reservations', { method: 'POST', body });

export const annulerMaReservation = (id: string): Promise<unknown> =>
  api(`/api/reservations/${encodeURIComponent(id)}/annuler`, { method: 'POST' });

export const payerReservation = (id: string): Promise<{ url: string }> =>
  api(`/api/reservations/${encodeURIComponent(id)}/payer`, { method: 'POST' });

// ── Propriétaire ───────────────────────────────────────────────────────────

const G = '/api/gestion-reservations';

export const listerReservations = (): Promise<{
  capacite: number;
  comptes_actifs: number;
  reservations: ReservationGestion[];
}> => api(G);

export const accepterReservation = (id: string, prix_cents: number): Promise<unknown> =>
  api(`${G}/${encodeURIComponent(id)}/accepter`, { method: 'POST', body: { prix_cents } });

export const refuserReservation = (id: string, motif?: string): Promise<unknown> =>
  api(`${G}/${encodeURIComponent(id)}/refuser`, { method: 'POST', body: { motif } });

export const annulerReservationGestion = (
  id: string,
): Promise<{ ok: boolean; rembourser_dans_stripe: boolean }> =>
  api(`${G}/${encodeURIComponent(id)}/annuler`, { method: 'POST' });

export const listerCodes = (): Promise<{ codes: CodeGratuit[] }> => api(`${G}/codes`);

export const creerCode = (body: {
  code?: string;
  note?: string;
  utilisations_max?: number;
  expire_le?: string;
}): Promise<{ code: { id: string; code: string } }> => api(`${G}/codes`, { method: 'POST', body });

export const desactiverCode = (id: string): Promise<unknown> =>
  api(`${G}/codes/${encodeURIComponent(id)}/desactiver`, { method: 'POST' });

export const lireReglagesGestion = (): Promise<ReglagesGestion> => api(`${G}/reglages`);

export const ecrireReglagesGestion = (body: ReglagesGestion): Promise<ReglagesGestion> =>
  api(`${G}/reglages`, { method: 'PUT', body });

// ── Affichage ──────────────────────────────────────────────────────────────

const FUSEAU = 'Europe/Luxembourg';

export function texteCreneau(debut: string, fin: string): string {
  const d = new Date(debut);
  const f = new Date(fin);
  const jour = d.toLocaleDateString('fr-FR', {
    timeZone: FUSEAU,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const heure = (x: Date): string =>
    x.toLocaleTimeString('fr-FR', { timeZone: FUSEAU, hour: '2-digit', minute: '2-digit' });
  return `${jour}, ${heure(d)} → ${heure(f)}`;
}

export function texteMontant(cents: number | null): string {
  if (cents === null) return '—';
  if (cents === 0) return 'Offert';
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
}

export const LIBELLE_STATUT: Record<StatutReservation, string> = {
  DEMANDEE: 'En attente de validation',
  ACCEPTEE: 'Acceptée — à payer',
  PAYEE: 'Confirmée (payée)',
  GRATUITE: 'Confirmée (offerte)',
  REFUSEE: 'Refusée',
  ANNULEE: 'Annulée',
};
