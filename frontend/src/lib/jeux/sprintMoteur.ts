/**
 * sprintMoteur.ts — feat/jeux-manette-2
 * Sprint 100 m : on tape PIED GAUCHE / PIED DROIT en alternance sur le
 * téléphone. Chaque pas alterné = 1 mètre. Deux fois le même pied ne compte
 * pas. Plafond de cadence pour qu'un téléphone trafiqué ne gagne pas seul.
 * Fonctions pures, calculées sur la TV.
 */
export const DISTANCE = 100;
const CADENCE_MAX = 16; // pas par seconde au plus
const RESERVE_MAX = 3;

export type Pied = 'g' | 'd';

export interface Coureur {
  id: string;
  pseudo: string;
  couleur: string;
  m: number;
  dernier: Pied | null;
  reserve: number;
  finiA: number | null; // ms depuis le départ
  pasRecents: number[]; // ms des derniers pas (cadence affichée)
}

export function nouveauCoureur(id: string, pseudo: string, couleur: string): Coureur {
  return { id, pseudo, couleur, m: 0, dernier: null, reserve: RESERVE_MAX, finiA: null, pasRecents: [] };
}

/** Recharge la réserve de pas (appelé à chaque image). */
export function recharger(coureurs: Coureur[], dt: number): void {
  for (const c of coureurs) c.reserve = Math.min(RESERVE_MAX, c.reserve + CADENCE_MAX * dt);
}

/** Un appui. Renvoie true si le pas compte. */
export function pas(c: Coureur, pied: Pied, tempsMs: number): boolean {
  if (c.finiA !== null || pied === c.dernier || c.reserve < 1) return false;
  c.reserve -= 1;
  c.dernier = pied;
  c.m += 1;
  c.pasRecents.push(tempsMs);
  if (c.pasRecents.length > 12) c.pasRecents.shift();
  if (c.m >= DISTANCE) {
    c.m = DISTANCE;
    c.finiA = tempsMs;
  }
  return true;
}

/** Pas par seconde sur la dernière seconde. */
export function cadence(c: Coureur, tempsMs: number): number {
  return c.pasRecents.filter((t) => tempsMs - t <= 1000).length;
}

export function classementSprint(cs: Coureur[]): Coureur[] {
  return [...cs].sort((a, b) => {
    if (a.finiA !== null && b.finiA !== null) return a.finiA - b.finiA;
    if (a.finiA !== null) return -1;
    if (b.finiA !== null) return 1;
    return b.m - a.m;
  });
}
