/**
 * kartMoteur.ts — feat/jeux-manette-2
 * Kart à bonus : la piste de la course (stade), 3 tours, des boîtes à bonus
 * sur la piste. Bonus : turbo, flaque d'huile (posée derrière soi), bouclier.
 * Direction analogique (-1..1) : boutons ou téléphone penché comme un volant.
 * Fonctions pures, calculées sur la TV.
 */
import {
  CX,
  CY,
  DEMI,
  HAUTEUR,
  LARGEUR,
  LONGUEUR_TOUR,
  RAYON_EXT,
  RAYON_INT,
  RAYON_MILIEU,
  abscisse,
  grille,
  surLaRoute,
} from '../courseMoteur.js';

export const TOURS_KART = 3;
export type Bonus = 'turbo' | 'huile' | 'bouclier';
export const BONUS: Bonus[] = ['turbo', 'huile', 'bouclier'];
export const NOM_BONUS: Record<Bonus, string> = { turbo: '🚀 Turbo', huile: '🛢️ Huile', bouclier: '🛡️ Bouclier' };

const V_ROUTE = 360;
const V_HERBE = 150;
const V_FREIN = 110;
const V_TURBO = 560;
const V_TOUPIE = 40;
const ACCEL = 300;
const DECEL = 520;
const BRAQUAGE = 3.2;
const RAYON_KART = 15;
const RAYON_BOITE = 26;
const RAYON_FLAQUE = 26;

export interface Kart {
  id: string;
  pseudo: string;
  couleur: string;
  x: number;
  y: number;
  angle: number;
  v: number;
  dir: number; // -1 gauche … 1 droite
  frein: boolean;
  tours: number;
  etape: 0 | 1 | 2 | 3;
  finiA: number | null; // ms depuis le départ
  bonus: Bonus | null;
  turboJusqua: number;
  bouclierJusqua: number;
  toupieJusqua: number;
}
export interface Boite {
  x: number;
  y: number;
  dispoA: number; // seconde de course à partir de laquelle elle est de nouveau là
}
export interface Flaque {
  x: number;
  y: number;
}
export interface CourseKart {
  karts: Kart[];
  boites: Boite[];
  flaques: Flaque[];
}

export function nouvelleCourseKart(joueurs: Array<{ id: string; pseudo: string; couleur: string }>, alea = Math.random): CourseKart {
  const karts: Kart[] = joueurs.map((j, i) => {
    const g = grille(i);
    return {
      ...j,
      x: g.x,
      y: g.y,
      angle: g.angle,
      v: 0,
      dir: 0,
      frein: false,
      tours: 0,
      etape: 0,
      finiA: null,
      bonus: null,
      turboJusqua: 0,
      bouclierJusqua: 0,
      toupieJusqua: 0,
    };
  });
  // Trois rangées de 3 boîtes en travers de la piste : ligne droite du haut, sommets des deux virages.
  const rayons = [RAYON_INT + 40, RAYON_MILIEU, RAYON_EXT - 40];
  const boites: Boite[] = [];
  for (const r of rayons) {
    boites.push({ x: CX, y: CY - r, dispoA: 0 });
    boites.push({ x: CX + DEMI + r, y: CY, dispoA: 0 });
    boites.push({ x: CX - DEMI - r, y: CY, dispoA: 0 });
  }
  void alea;
  return { karts, boites, flaques: [] };
}

export function utiliserBonus(c: CourseKart, k: Kart, sec: number): Bonus | null {
  const b = k.bonus;
  if (!b || k.finiA !== null) return null;
  k.bonus = null;
  if (b === 'turbo') k.turboJusqua = sec + 2.2;
  else if (b === 'bouclier') k.bouclierJusqua = sec + 6;
  else c.flaques.push({ x: k.x - Math.cos(k.angle) * 42, y: k.y - Math.sin(k.angle) * 42 });
  if (c.flaques.length > 12) c.flaques.shift();
  return b;
}

/** Avance la course. Renvoie les karts qui viennent de finir. */
export function avancerKart(c: CourseKart, dt: number, sec: number, tempsMs: number, alea = Math.random): string[] {
  const arrivees: string[] = [];
  for (const k of c.karts) {
    const toupie = sec < k.toupieJusqua;
    if (k.finiA !== null) {
      k.v = Math.max(0, k.v - DECEL * dt);
    } else if (toupie) {
      k.v = Math.max(V_TOUPIE, k.v - DECEL * 1.5 * dt);
      k.angle += 9 * dt;
    } else {
      const turbo = sec < k.turboJusqua;
      const route = surLaRoute(k.x, k.y);
      const cible = k.frein ? V_FREIN : turbo ? V_TURBO : route ? V_ROUTE : V_HERBE;
      k.v = k.v < cible ? Math.min(cible, k.v + (turbo ? ACCEL * 3 : ACCEL) * dt) : Math.max(cible, k.v - DECEL * dt);
      const dir = Math.max(-1, Math.min(1, k.dir));
      k.angle += dir * BRAQUAGE * dt * Math.min(1, k.v / 140);
    }
    const ax = k.x;
    k.x += Math.cos(k.angle) * k.v * dt;
    k.y += Math.sin(k.angle) * k.v * dt;
    if (k.x < RAYON_KART || k.x > LARGEUR - RAYON_KART) {
      k.x = Math.max(RAYON_KART, Math.min(LARGEUR - RAYON_KART, k.x));
      k.v *= 0.5;
    }
    if (k.y < RAYON_KART || k.y > HAUTEUR - RAYON_KART) {
      k.y = Math.max(RAYON_KART, Math.min(HAUTEUR - RAYON_KART, k.y));
      k.v *= 0.5;
    }
    // Boîtes à bonus (on n'en ramasse pas si on en a déjà un).
    if (k.finiA === null && !k.bonus) {
      for (const b of c.boites) {
        if (sec >= b.dispoA && Math.hypot(k.x - b.x, k.y - b.y) < RAYON_BOITE + RAYON_KART) {
          k.bonus = BONUS[Math.floor(alea() * BONUS.length)] ?? 'turbo';
          b.dispoA = sec + 4;
          break;
        }
      }
    }
    // Flaques d'huile : toupie, sauf bouclier.
    for (let i = c.flaques.length - 1; i >= 0; i--) {
      const f = c.flaques[i]!;
      if (Math.hypot(k.x - f.x, k.y - f.y) < RAYON_FLAQUE + RAYON_KART) {
        c.flaques.splice(i, 1);
        if (sec >= k.bouclierJusqua && k.finiA === null) k.toupieJusqua = sec + 1.2;
      }
    }
    // Passages obligés, comme la course.
    if (k.etape === 0 && k.x > CX + DEMI) k.etape = 1;
    else if (k.etape === 1 && k.y < CY && k.x < CX) k.etape = 2;
    else if (k.etape === 2 && k.x < CX - DEMI) k.etape = 3;
    else if (k.etape === 3 && k.y > CY && ax < CX && k.x >= CX) {
      k.etape = 0;
      k.tours += 1;
      if (k.tours >= TOURS_KART && k.finiA === null) {
        k.finiA = tempsMs;
        arrivees.push(k.id);
      }
    }
  }
  // Chocs : on s'écarte ; le bouclier ralentit l'autre.
  for (let i = 0; i < c.karts.length; i++) {
    for (let j = i + 1; j < c.karts.length; j++) {
      const a = c.karts[i]!;
      const b = c.karts[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d > 0 && d < RAYON_KART * 2) {
        const p = (RAYON_KART * 2 - d) / 2;
        a.x -= (dx / d) * p;
        a.y -= (dy / d) * p;
        b.x += (dx / d) * p;
        b.y += (dy / d) * p;
        const bA = sec < a.bouclierJusqua;
        const bB = sec < b.bouclierJusqua;
        a.v *= bA ? 1 : bB ? 0.55 : 0.92;
        b.v *= bB ? 1 : bA ? 0.55 : 0.92;
      }
    }
  }
  return arrivees;
}

export function classementKart(karts: Kart[]): Kart[] {
  const avancee = (k: Kart): number => {
    const s = abscisse(k.x, k.y);
    const surTour = k.etape === 0 && s > LONGUEUR_TOUR * 0.75 ? 0 : s;
    return k.tours * LONGUEUR_TOUR + surTour;
  };
  return [...karts].sort((a, b) => {
    if (a.finiA !== null || b.finiA !== null) {
      if (a.finiA === null) return 1;
      if (b.finiA === null) return -1;
      return a.finiA - b.finiA;
    }
    return avancee(b) - avancee(a);
  });
}
