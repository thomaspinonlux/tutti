/**
 * tamponMoteur.ts — feat/jeux-manette-2
 * Auto-tamponneuses : chaque voiture avance toute seule, on la dirige
 * (boutons ou téléphone penché) et on a un TURBO. Foncer sur un autre avec
 * le nez de sa voiture lui retire des points de vie ; se faire percuter sur
 * le côté fait très mal. Plus de vie = éliminé. Après 45 s, tout le monde perd
 * de la vie (mort subite). Fonctions pures, calculées sur la TV.
 */
export const LARGEUR = 1600;
export const HAUTEUR = 900;
export const MARGE = 40;
export const RAYON_AUTO = 30;
export const VIE = 100;
export const POINTS_VICTOIRE = 3;
export const MORT_SUBITE = 45; // s

const V_CROISIERE = 290;
const V_TURBO = 560;
const ACCEL = 500;
const BRAQUAGE = 3.2;
const DEGATS = 0.045; // par px/s de vitesse de rapprochement
const DUREE_TURBO = 1.0;
const RECHARGE_TURBO = 3;

export interface Auto {
  id: string;
  pseudo: string;
  couleur: string;
  x: number;
  y: number;
  angle: number;
  v: number;
  kx: number; // recul après choc
  ky: number;
  dir: number;
  frein: boolean;
  vie: number;
  vivant: boolean;
  turboJusqua: number;
  turboPretA: number;
  dernierChoc: number;
  score: number;
}

export function nouvelleAuto(id: string, pseudo: string, couleur: string): Auto {
  return {
    id, pseudo, couleur, x: 0, y: 0, angle: 0, v: 0, kx: 0, ky: 0, dir: 0, frein: false,
    vie: VIE, vivant: true, turboJusqua: 0, turboPretA: 0, dernierChoc: -10, score: 0,
  };
}

/** Départ en cercle, tout le monde tourné vers le centre. */
export function nouvelleManche(autos: Auto[]): void {
  const n = autos.length;
  autos.forEach((a, i) => {
    const t = (2 * Math.PI * i) / Math.max(1, n);
    a.x = LARGEUR / 2 + Math.cos(t) * 330;
    a.y = HAUTEUR / 2 + Math.sin(t) * 300;
    a.angle = t + Math.PI;
    a.v = 0;
    a.kx = 0;
    a.ky = 0;
    a.vie = VIE;
    a.vivant = true;
    a.turboJusqua = 0;
    a.turboPretA = 0;
    a.dernierChoc = -10;
  });
}

export function turbo(a: Auto, sec: number): boolean {
  if (!a.vivant || sec < a.turboPretA) return false;
  a.turboJusqua = sec + DUREE_TURBO;
  a.turboPretA = sec + RECHARGE_TURBO;
  return true;
}

/** Dégâts subis par une voiture : moins si elle frappe avec son nez. */
export function degats(rapprochement: number, nez: number): number {
  return rapprochement * DEGATS * (1 - 0.8 * Math.max(0, Math.min(1, nez)));
}

export function avancerTampon(autos: Auto[], dt: number, sec: number): Auto[] {
  const vivants = autos.filter((a) => a.vivant);
  for (const a of vivants) {
    const cible = a.frein ? 0 : sec < a.turboJusqua ? V_TURBO : V_CROISIERE;
    a.v = a.v < cible ? Math.min(cible, a.v + ACCEL * (sec < a.turboJusqua ? 3 : 1) * dt) : Math.max(cible, a.v - ACCEL * 1.5 * dt);
    a.angle += Math.max(-1, Math.min(1, a.dir)) * BRAQUAGE * dt * Math.min(1, (a.v + 60) / 180);
    a.x += (Math.cos(a.angle) * a.v + a.kx) * dt;
    a.y += (Math.sin(a.angle) * a.v + a.ky) * dt;
    const f = Math.exp(-4 * dt);
    a.kx *= f;
    a.ky *= f;
    // Murs : on rebondit, sans dégâts.
    if (a.x < MARGE + RAYON_AUTO || a.x > LARGEUR - MARGE - RAYON_AUTO) {
      a.x = Math.max(MARGE + RAYON_AUTO, Math.min(LARGEUR - MARGE - RAYON_AUTO, a.x));
      a.angle = Math.PI - a.angle;
      a.kx = -a.kx;
      a.v *= 0.6;
    }
    if (a.y < MARGE + RAYON_AUTO || a.y > HAUTEUR - MARGE - RAYON_AUTO) {
      a.y = Math.max(MARGE + RAYON_AUTO, Math.min(HAUTEUR - MARGE - RAYON_AUTO, a.y));
      a.angle = -a.angle;
      a.ky = -a.ky;
      a.v *= 0.6;
    }
    if (sec > MORT_SUBITE) a.vie -= 3 * dt;
  }
  for (let i = 0; i < vivants.length; i++) {
    for (let j = i + 1; j < vivants.length; j++) {
      const a = vivants[i]!;
      const b = vivants[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d >= 2 * RAYON_AUTO || d < 1e-6) continue;
      const nx = dx / d;
      const ny = dy / d;
      const p = (2 * RAYON_AUTO - d) / 2;
      a.x -= nx * p;
      a.y -= ny * p;
      b.x += nx * p;
      b.y += ny * p;
      const vax = Math.cos(a.angle) * a.v + a.kx;
      const vay = Math.sin(a.angle) * a.v + a.ky;
      const vbx = Math.cos(b.angle) * b.v + b.kx;
      const vby = Math.sin(b.angle) * b.v + b.ky;
      const rapproche = (vax - vbx) * nx + (vay - vby) * ny;
      if (rapproche <= 0) continue;
      if (sec - a.dernierChoc > 0.25 && sec - b.dernierChoc > 0.25) {
        const nezA = Math.cos(a.angle) * nx + Math.sin(a.angle) * ny;
        const nezB = -(Math.cos(b.angle) * nx + Math.sin(b.angle) * ny);
        a.vie -= degats(rapproche, nezA);
        b.vie -= degats(rapproche, nezB);
        a.dernierChoc = sec;
        b.dernierChoc = sec;
      }
      const recul = rapproche * 0.9;
      a.kx -= nx * recul;
      a.ky -= ny * recul;
      b.kx += nx * recul;
      b.ky += ny * recul;
      a.v *= 0.5;
      b.v *= 0.5;
    }
  }
  const morts: Auto[] = [];
  for (const a of vivants) {
    if (a.vie <= 0) {
      a.vie = 0;
      a.vivant = false;
      morts.push(a);
    }
  }
  return morts;
}

export function finDeManche(autos: Auto[]): { finie: boolean; gagnant: Auto | null } {
  const vivants = autos.filter((a) => a.vivant);
  if (autos.length <= 1) return { finie: vivants.length === 0, gagnant: null };
  if (vivants.length <= 1) return { finie: true, gagnant: vivants[0] ?? null };
  return { finie: false, gagnant: null };
}
