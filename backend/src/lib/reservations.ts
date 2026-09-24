/**
 * reservations.ts — feat/reservation-de-creneaux
 *
 * La logique qui ne touche pas la base : durée, chevauchement, capacité.
 * Isolée ici pour être testée sans serveur.
 *
 * RÈGLE DE CAPACITÉ (Thomas, 21/09) : « on garde un compte disponible pour la
 * brasserie ». Un compte Apple Music ne porte qu'une partie à la fois, donc
 * les créneaux clients simultanés sont plafonnés à (comptes actifs − 1).
 * Avec 3 comptes : 2 parties clients en même temps, la 3e reste à la brasserie.
 */

/** Statuts qui immobilisent un créneau (la capacité est prise). */
export const STATUTS_QUI_OCCUPENT = ['ACCEPTEE', 'PAYEE', 'GRATUITE'] as const;

/** Statuts qui autorisent le client à lancer sa partie. */
export const STATUTS_JOUABLES = ['PAYEE', 'GRATUITE'] as const;

/** Créneaux clients simultanés possibles : un compte reste à la brasserie. */
export function capaciteClients(comptesActifs: number): number {
  return Math.max(0, comptesActifs - 1);
}

export interface Intervalle {
  debut: Date;
  fin: Date;
}

/** Deux créneaux se chevauchent-ils ? Bords exclus : 20h-22h puis 22h-23h, c'est libre. */
export function chevauchent(a: Intervalle, b: Intervalle): boolean {
  return a.debut.getTime() < b.fin.getTime() && b.debut.getTime() < a.fin.getTime();
}

/**
 * Nombre maximal de créneaux en cours au même instant, pendant `fenetre`.
 *
 * Ce n'est PAS le nombre de créneaux qui touchent la fenêtre : 18h-20h et
 * 21h-23h touchent tous deux 18h-23h mais ne sont jamais simultanés. On
 * balaie les bornes dans l'ordre et on garde le pic.
 */
export function picSimultane(existants: Intervalle[], fenetre: Intervalle): number {
  const evenements: Array<{ t: number; delta: number }> = [];
  for (const r of existants) {
    if (!chevauchent(r, fenetre)) continue;
    const d = Math.max(r.debut.getTime(), fenetre.debut.getTime());
    const f = Math.min(r.fin.getTime(), fenetre.fin.getTime());
    evenements.push({ t: d, delta: +1 }, { t: f, delta: -1 });
  }
  // À instant égal, une fin passe avant un début : 20h-22h et 22h-23h ne se
  // cumulent pas.
  evenements.sort((a, b) => a.t - b.t || a.delta - b.delta);
  let courant = 0;
  let pic = 0;
  for (const e of evenements) {
    courant += e.delta;
    if (courant > pic) pic = courant;
  }
  return pic;
}

/** Y a-t-il de la place pour `nouveau` à côté des créneaux déjà pris ? */
export function aDeLaPlace(
  existants: Intervalle[],
  nouveau: Intervalle,
  capacite: number,
): boolean {
  if (capacite <= 0) return false;
  return picSimultane(existants, nouveau) < capacite;
}

export interface Reglages {
  duree_min_minutes: number;
  duree_max_minutes: number;
  ouverture_avant_minutes: number;
  /** feat/reservation-automatique — tarif horaire (0 = non fixé). */
  tarif_horaire_cents: number;
  tarif_horaire_soir_cents: number;
  heure_soiree_debut: number;
  jours_soiree: string;
  validation_automatique: boolean;
  /** feat/client-avec-son-compte — grille réduite + validation des comptes. */
  tarif_horaire_propre_cents: number;
  tarif_horaire_propre_soir_cents: number;
  validation_auto_comptes: boolean;
  /** feat/offre-de-lancement — remise visible sur la page de réservation. */
  reduction_pct: number;
  reduction_libelle: string;
  reduction_fin: Date | null;
}

/** Message lisible si le créneau demandé n'est pas acceptable, sinon null. */
export function verifierCreneau(
  c: Intervalle,
  reglages: Reglages,
  maintenant = new Date(),
): string | null {
  if (Number.isNaN(c.debut.getTime()) || Number.isNaN(c.fin.getTime())) {
    return 'Date invalide.';
  }
  if (c.fin.getTime() <= c.debut.getTime()) {
    return 'La fin doit être après le début.';
  }
  if (c.debut.getTime() <= maintenant.getTime()) {
    return 'Le créneau doit commencer dans le futur.';
  }
  const minutes = (c.fin.getTime() - c.debut.getTime()) / 60_000;
  if (minutes < reglages.duree_min_minutes) {
    return `Durée trop courte : ${formaterDuree(reglages.duree_min_minutes)} minimum.`;
  }
  if (minutes > reglages.duree_max_minutes) {
    return `Durée trop longue : ${formaterDuree(reglages.duree_max_minutes)} maximum.`;
  }
  return null;
}

/** Le client peut-il lancer sa partie maintenant, pour ce créneau ? */
export function creneauOuvert(
  c: Intervalle,
  ouvertureAvantMinutes: number,
  maintenant = new Date(),
): boolean {
  const ouverture = c.debut.getTime() - ouvertureAvantMinutes * 60_000;
  return maintenant.getTime() >= ouverture && maintenant.getTime() <= c.fin.getTime();
}

export function formaterDuree(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

/** Code gratuit saisi par un humain : sans espaces, en majuscules. */
export function normaliserCode(code: string): string {
  return code.replace(/\s+/g, '').toUpperCase();
}

/** Alphabet sans caractères ambigus (pas de 0/O, 1/I/L). */
const ALPHABET_CODE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Code gratuit lisible à l'oral : TUTTI-XXXX-XXXX. */
export function genererCode(aleatoire: () => number = Math.random): string {
  const bloc = (): string =>
    Array.from(
      { length: 4 },
      () => ALPHABET_CODE[Math.floor(aleatoire() * ALPHABET_CODE.length)],
    ).join('');
  return `TUTTI-${bloc()}-${bloc()}`;
}
