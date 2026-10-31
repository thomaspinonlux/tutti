/**
 * sumoMoteur.ts — feat/jeux-manette
 * Sumo : chaque joueur est un palet sur une arène ronde qui rétrécit. Le
 * téléphone sert de joystick (+ bouton « Dash »). On se pousse ; celui qui
 * sort de l'arène est éliminé. Le dernier dedans gagne la manche.
 * Fonctions pures, calculées sur la TV.
 */
export const LARGEUR = 1600;
export const HAUTEUR = 900;
export const CX = 800;
export const CY = 450;
export const RAYON_ARENE = 410;
export const RAYON_MIN = 170;
export const RAYON_PALET = 34;
export const POINTS_VICTOIRE = 5;

const ACCEL = 1100;
const FROTTEMENT = 1.9; // par seconde
const V_MAX = 560;
const DASH = 780;
const RECHARGE_DASH = 2.5; // s
const REBOND = 1.25;

export interface Palet {
  id: string;
  pseudo: string;
  couleur: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  jx: number; // joystick -1..1
  jy: number;
  dashA: number; // seconde de manche à partir de laquelle le dash est de nouveau prêt
  vivant: boolean;
  score: number;
}

export function nouveauPalet(id: string, pseudo: string, couleur: string): Palet {
  return { id, pseudo, couleur, x: CX, y: CY, vx: 0, vy: 0, jx: 0, jy: 0, dashA: 0, vivant: true, score: 0 };
}

export function nouvelleManche(palets: Palet[]): void {
  const n = palets.length;
  palets.forEach((p, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, n);
    const r = n === 1 ? 0 : RAYON_ARENE * 0.6;
    p.x = CX + Math.cos(a) * r;
    p.y = CY + Math.sin(a) * r;
    p.vx = 0;
    p.vy = 0;
    p.jx = 0;
    p.jy = 0;
    p.dashA = 0;
    p.vivant = true;
  });
}

/** Rayon de l'arène : stable 15 s, puis rétrécit jusqu'au minimum en 40 s. */
export function rayonArene(secondes: number): number {
  if (secondes < 15) return RAYON_ARENE;
  const k = Math.min(1, (secondes - 15) / 40);
  return RAYON_ARENE - (RAYON_ARENE - RAYON_MIN) * k;
}

export function dash(p: Palet, secondes: number): boolean {
  if (!p.vivant || secondes < p.dashA) return false;
  let dx = p.jx;
  let dy = p.jy;
  let n = Math.hypot(dx, dy);
  if (n < 0.2) {
    dx = p.vx;
    dy = p.vy;
    n = Math.hypot(dx, dy);
  }
  if (n < 1e-6) return false;
  p.vx += (dx / n) * DASH;
  p.vy += (dy / n) * DASH;
  p.dashA = secondes + RECHARGE_DASH;
  return true;
}

/** Avance de dt secondes. Renvoie les palets sortis à ce pas. */
export function avancer(palets: Palet[], dt: number, secondes: number): Palet[] {
  const vivants = palets.filter((p) => p.vivant);
  for (const p of vivants) {
    const n = Math.hypot(p.jx, p.jy);
    const k = n > 1 ? 1 / n : 1;
    p.vx += p.jx * k * ACCEL * dt;
    p.vy += p.jy * k * ACCEL * dt;
    const f = Math.exp(-FROTTEMENT * dt);
    p.vx *= f;
    p.vy *= f;
    // Vitesse plafonnée hors dash (le dash peut dépasser un instant).
    const v = Math.hypot(p.vx, p.vy);
    const plafond = secondes < p.dashA - RECHARGE_DASH + 0.4 ? V_MAX + DASH : V_MAX;
    if (v > plafond) {
      p.vx *= plafond / v;
      p.vy *= plafond / v;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  // Chocs entre palets (masses égales, rebond un peu « élastique +»).
  for (let i = 0; i < vivants.length; i++) {
    for (let j = i + 1; j < vivants.length; j++) {
      const a = vivants[i]!;
      const b = vivants[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d >= 2 * RAYON_PALET || d < 1e-6) continue;
      const nx = dx / d;
      const ny = dy / d;
      const recouvre = 2 * RAYON_PALET - d;
      a.x -= (nx * recouvre) / 2;
      a.y -= (ny * recouvre) / 2;
      b.x += (nx * recouvre) / 2;
      b.y += (ny * recouvre) / 2;
      const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (rel <= 0) continue; // ils s'éloignent déjà
      const imp = (rel * REBOND);
      a.vx -= imp * nx;
      a.vy -= imp * ny;
      b.vx += imp * nx;
      b.vy += imp * ny;
    }
  }
  const r = rayonArene(secondes);
  const sortis: Palet[] = [];
  for (const p of vivants) {
    if (Math.hypot(p.x - CX, p.y - CY) > r) {
      p.vivant = false;
      sortis.push(p);
    }
  }
  return sortis;
}

export function finDeManche(palets: Palet[]): { finie: boolean; gagnant: Palet | null } {
  const vivants = palets.filter((p) => p.vivant);
  if (palets.length <= 1) return { finie: vivants.length === 0, gagnant: null };
  if (vivants.length <= 1) return { finie: true, gagnant: vivants[0] ?? null };
  return { finie: false, gagnant: null };
}
