/**
 * tarifs.ts — feat/reservation-automatique
 *
 * LE PRIX D'UN CRÉNEAU SE CALCULE TOUT SEUL, À L'HEURE.
 *
 * Thomas : « au prorata des heures », avec un tarif majoré le vendredi et le
 * samedi soir. Chaque tranche du créneau est facturée au tarif de l'heure où
 * elle tombe (heure locale du Luxembourg), au prorata des minutes : une
 * partie de 20 h 30 à 23 h 00 un vendredi coûte 2,5 h de tarif soirée, et une
 * partie de 17 h à 19 h coûte 1 h de tarif normal + 1 h de tarif soirée.
 *
 * Tant que `tarif_horaire_cents` vaut 0, le calcul renvoie null : le prix
 * reste fixé à la main par le propriétaire, comme avant.
 */

export interface ReglagesTarif {
  tarif_horaire_cents: number;
  tarif_horaire_soir_cents: number;
  heure_soiree_debut: number;
  jours_soiree: string;
  validation_automatique: boolean;
  /** feat/client-avec-son-compte — grille réduite : le client joue avec son
   *  propre abonnement Apple Music, il ne mobilise aucun compte du parc. */
  tarif_horaire_propre_cents: number;
  tarif_horaire_propre_soir_cents: number;
  validation_auto_comptes: boolean;
  /** feat/offre-de-lancement — remise en %, 0 = aucune. */
  reduction_pct: number;
  reduction_libelle: string;
  reduction_fin: Date | null;
}

/** Ce que coûte un créneau, remise comprise. */
export interface DevisCreneau {
  /** Prix avant remise. */
  prix_plein_cents: number;
  /** Prix à payer. */
  prix_cents: number;
  reduction_pct: number;
  reduction_libelle: string;
  reduction_fin: string | null;
}

const FUSEAU = 'Europe/Luxembourg';
const JOUR_ISO = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Jour ISO (1 = lundi … 7 = dimanche) et heure locale d'un instant. */
export function jourEtHeureLocale(d: Date): { jour: number; heure: number } {
  const parties = new Intl.DateTimeFormat('en-GB', {
    timeZone: FUSEAU,
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const nomJour = parties.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const heure = Number(parties.find((p) => p.type === 'hour')?.value ?? '0');
  return { jour: JOUR_ISO.indexOf(nomJour) + 1, heure };
}

export function joursSoiree(reglages: ReglagesTarif): number[] {
  return reglages.jours_soiree
    .split(',')
    .map((j) => Number(j.trim()))
    .filter((j) => Number.isInteger(j) && j >= 1 && j <= 7);
}

/** Cette tranche tombe-t-elle dans le tarif soirée ? */
export function estSoiree(d: Date, reglages: ReglagesTarif): boolean {
  const { jour, heure } = jourEtHeureLocale(d);
  return joursSoiree(reglages).includes(jour) && heure >= reglages.heure_soiree_debut;
}

/** L'offre de lancement court-elle encore ? */
export function reductionActive(reglages: ReglagesTarif, maintenant: Date = new Date()): boolean {
  if (reglages.reduction_pct <= 0 || reglages.reduction_pct > 100) return false;
  return !reglages.reduction_fin || reglages.reduction_fin.getTime() > maintenant.getTime();
}

/**
 * Prix plein, prix remisé et nom de l'offre — ou null si les tarifs ne sont
 * pas fixés. La page de réservation affiche les deux prix : le client doit
 * VOIR la remise, pas seulement en profiter.
 */
export function calculerDevis(
  debut: Date,
  fin: Date,
  reglages: ReglagesTarif,
  options: { compteClient?: boolean; maintenant?: Date } = {},
): DevisCreneau | null {
  const plein = prixPleinCents(debut, fin, reglages, options);
  if (plein === null) return null;
  const active = reductionActive(reglages, options.maintenant ?? new Date());
  const pct = active ? reglages.reduction_pct : 0;
  return {
    prix_plein_cents: plein,
    prix_cents: pct > 0 ? Math.round((plein * (100 - pct)) / 100) : plein,
    reduction_pct: pct,
    reduction_libelle: pct > 0 ? reglages.reduction_libelle : '',
    reduction_fin: pct > 0 ? (reglages.reduction_fin?.toISOString() ?? null) : null,
  };
}

/**
 * Prix du créneau en centimes, REMISE COMPRISE, ou null si les tarifs ne sont
 * pas fixés. C'est ce montant-là qui part chez Stripe.
 */
export function calculerPrixCents(
  debut: Date,
  fin: Date,
  reglages: ReglagesTarif,
  options: { compteClient?: boolean; maintenant?: Date } = {},
): number | null {
  return calculerDevis(debut, fin, reglages, options)?.prix_cents ?? null;
}

/**
 * Prix plein du créneau en centimes, ou null si les tarifs ne sont pas fixés.
 * Découpé en tranches de 5 minutes : assez fin pour un prix juste, assez
 * grossier pour rester exact en arithmétique entière.
 */
function prixPleinCents(
  debut: Date,
  fin: Date,
  reglages: ReglagesTarif,
  options: { compteClient?: boolean } = {},
): number | null {
  // Avec son propre compte, le client paie la grille réduite — si elle est
  // fixée ; sinon on retombe sur la grille normale.
  const reduite = !!options.compteClient && reglages.tarif_horaire_propre_cents > 0;
  const base = reduite ? reglages.tarif_horaire_propre_cents : reglages.tarif_horaire_cents;
  const soir = reduite
    ? reglages.tarif_horaire_propre_soir_cents
    : reglages.tarif_horaire_soir_cents;
  if (base <= 0) return null;
  const tarifSoir = soir > 0 ? soir : base;
  const PAS_MS = 5 * 60_000;
  const total = fin.getTime() - debut.getTime();
  if (total <= 0) return null;
  let cents = 0;
  for (let t = debut.getTime(); t < fin.getTime(); t += PAS_MS) {
    const duree = Math.min(PAS_MS, fin.getTime() - t);
    const tarif = estSoiree(new Date(t), reglages) ? tarifSoir : base;
    cents += (tarif * duree) / 3_600_000;
  }
  return Math.round(cents);
}

/** Le client peut-il réserver et payer sans intervention du propriétaire ? */
export function reservationAutomatique(reglages: ReglagesTarif): boolean {
  return reglages.validation_automatique && reglages.tarif_horaire_cents > 0;
}
