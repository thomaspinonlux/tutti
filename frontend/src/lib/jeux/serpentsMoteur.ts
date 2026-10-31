/**
 * serpentsMoteur.ts — feat/jeux-manette
 * Serpents lumineux (façon Tron) : chaque joueur avance tout seul et laisse
 * un mur derrière lui. Le téléphone tourne à gauche / à droite (quart de tour).
 * Toucher un bord ou un mur = éliminé. Le dernier en vie gagne la manche.
 * Fonctions pures, calculées sur la TV.
 */
export const COLS = 160;
export const LIGNES = 90;
export const CASE = 10; // 1600 × 900 px
export const POINTS_VICTOIRE = 5;

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

export interface Serpent {
  id: string;
  pseudo: string;
  couleur: string;
  x: number;
  y: number;
  dir: number; // 0 droite, 1 bas, 2 gauche, 3 haut
  vivant: boolean;
  virages: number[]; // file : -1 gauche, +1 droite
  score: number;
  /** Cases parcourues pendant la manche (pour le dessin). */
  trace: Array<[number, number]>;
}

export interface Arene {
  grille: Int16Array; // 0 = libre, sinon index du serpent + 1
  serpents: Serpent[];
  pas: number;
}

export function nouveauSerpent(id: string, pseudo: string, couleur: string): Serpent {
  return { id, pseudo, couleur, x: 0, y: 0, dir: 0, vivant: true, virages: [], score: 0, trace: [] };
}

/** Place les serpents sur une ellipse, tous dans le même sens de rotation (pas de face-à-face au départ). */
export function nouvelleManche(serpents: Serpent[]): Arene {
  const grille = new Int16Array(COLS * LIGNES);
  const n = serpents.length;
  serpents.forEach((s, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, n) - Math.PI / 2;
    s.x = Math.round(COLS / 2 + Math.cos(a) * (COLS * 0.36));
    s.y = Math.round(LIGNES / 2 + Math.sin(a) * (LIGNES * 0.36));
    // Tangente dans le sens des aiguilles d'une montre, arrondie à une direction.
    const tx = -Math.sin(a);
    const ty = Math.cos(a);
    s.dir = Math.abs(tx) > Math.abs(ty) ? (tx > 0 ? 0 : 2) : ty > 0 ? 1 : 3;
    s.vivant = true;
    s.virages = [];
    s.trace = [[s.x, s.y]];
    grille[s.y * COLS + s.x] = i + 1;
  });
  return { grille, serpents, pas: 0 };
}

export function tourner(s: Serpent, sens: -1 | 1): void {
  if (s.virages.length < 3) s.virages.push(sens);
}

/** Un pas de jeu. Renvoie les serpents éliminés à ce pas. */
export function avancer(ar: Arene): Serpent[] {
  ar.pas++;
  const vivants = ar.serpents.filter((s) => s.vivant);
  const cibles = new Map<number, Serpent[]>();
  const morts: Serpent[] = [];
  for (const s of vivants) {
    const v = s.virages.shift();
    if (v !== undefined) s.dir = (s.dir + v + 4) % 4;
    const nx = s.x + DX[s.dir]!;
    const ny = s.y + DY[s.dir]!;
    s.x = nx;
    s.y = ny;
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= LIGNES || ar.grille[ny * COLS + nx] !== 0) {
      morts.push(s);
      continue;
    }
    const k = ny * COLS + nx;
    cibles.set(k, [...(cibles.get(k) ?? []), s]);
  }
  // Deux têtes dans la même case : les deux sortent.
  for (const l of cibles.values()) if (l.length > 1) morts.push(...l);
  for (const s of morts) s.vivant = false;
  for (const [k, l] of cibles) {
    if (l.length === 1 && l[0]!.vivant) {
      const s = l[0]!;
      ar.grille[k] = ar.serpents.indexOf(s) + 1;
      s.trace.push([s.x, s.y]);
    }
  }
  return morts;
}

/** Vitesse en cases par seconde : accélère doucement au fil de la manche. */
export function vitesse(secondes: number): number {
  return Math.min(22, 12 + Math.floor(secondes / 5));
}

/**
 * La manche est finie quand il reste au plus 1 serpent (à plusieurs) ou 0
 * (en solo). Renvoie le gagnant (null = égalité / solo).
 */
export function finDeManche(ar: Arene): { finie: boolean; gagnant: Serpent | null } {
  const vivants = ar.serpents.filter((s) => s.vivant);
  if (ar.serpents.length <= 1) return { finie: vivants.length === 0, gagnant: null };
  if (vivants.length <= 1) return { finie: true, gagnant: vivants[0] ?? null };
  return { finie: false, gagnant: null };
}
