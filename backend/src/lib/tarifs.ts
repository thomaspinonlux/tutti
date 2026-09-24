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

/**
 * Prix du créneau en centimes, ou null si les tarifs ne sont pas fixés.
 * Découpé en tranches de 5 minutes : assez fin pour un prix juste, assez
 * grossier pour rester exact en arithmétique entière.
 */
export function calculerPrixCents(
  debut: Date,
  fin: Date,
  reglages: ReglagesTarif,
): number | null {
  if (reglages.tarif_horaire_cents <= 0) return null;
  const tarifSoir = reglages.tarif_horaire_soir_cents > 0
    ? reglages.tarif_horaire_soir_cents
    : reglages.tarif_horaire_cents;
  const PAS_MS = 5 * 60_000;
  const total = fin.getTime() - debut.getTime();
  if (total <= 0) return null;
  let cents = 0;
  for (let t = debut.getTime(); t < fin.getTime(); t += PAS_MS) {
    const duree = Math.min(PAS_MS, fin.getTime() - t);
    const tarif = estSoiree(new Date(t), reglages) ? tarifSoir : reglages.tarif_horaire_cents;
    cents += (tarif * duree) / 3_600_000;
  }
  return Math.round(cents);
}

/** Le client peut-il réserver et payer sans intervention du propriétaire ? */
export function reservationAutomatique(reglages: ReglagesTarif): boolean {
  return reglages.validation_automatique && reglages.tarif_horaire_cents > 0;
}
