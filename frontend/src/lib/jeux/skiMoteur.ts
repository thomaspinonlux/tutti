/**
 * skiMoteur.ts — feat/jeux-manette-2
 * Descente à ski en slalom : chaque joueur a son couloir, tous ont LE MÊME
 * tracé (portes + sapins). Porte manquée = +2 s. Sapin touché = chute 1,2 s.
 * Unités : le couloir fait LARGEUR_PISTE de large, y descend en px.
 * Fonctions pures, calculées sur la TV.
 */
export const LARGEUR_PISTE = 400;
export const LONGUEUR = 11000;
export const ECART_PORTES = 450;
export const LARGEUR_PORTE = 110;
export const PENALITE_PORTE = 2;
const V_MAX = 640;
const ACCEL = 260;
const LATERAL = 320; // px/s à fond
const RAYON_SKIEUR = 12;
const RAYON_SAPIN = 16;
const CHUTE = 1.2;

export interface Porte {
  y: number;
  x: number; // centre
}
export interface Sapin {
  y: number;
  x: number;
}
export interface Parcours {
  portes: Porte[];
  sapins: Sapin[];
}

export interface Skieur {
  id: string;
  pseudo: string;
  couleur: string;
  x: number;
  y: number;
  v: number;
  dir: number;
  chuteJusqua: number;
  porte: number; // index de la prochaine porte
  ratees: number[]; // index des portes manquées
  sapinsTouches: Set<number>;
  finiA: number | null; // ms bruts
}

export function genererParcours(alea: () => number = Math.random): Parcours {
  const portes: Porte[] = [];
  let i = 0;
  for (let y = 700; y < LONGUEUR - 300; y += ECART_PORTES, i++) {
    const cote = i % 2 === 0 ? -1 : 1;
    portes.push({ y, x: LARGEUR_PISTE / 2 + cote * (50 + alea() * 70) });
  }
  const sapins: Sapin[] = [];
  for (let k = 0; k < portes.length - 1; k++) {
    const a = portes[k]!;
    const b = portes[k + 1]!;
    const n = 1 + Math.floor(alea() * 2);
    for (let t = 0; t < n; t++) {
      const f = 0.3 + alea() * 0.4;
      const y = a.y + (b.y - a.y) * f;
      const chemin = a.x + (b.x - a.x) * f;
      // Un sapin jamais sur la trajectoire directe entre deux portes.
      let x = 0;
      for (let essai = 0; essai < 10; essai++) {
        x = 20 + alea() * (LARGEUR_PISTE - 40);
        if (Math.abs(x - chemin) > 85) break;
      }
      if (Math.abs(x - chemin) > 85) sapins.push({ y, x });
    }
  }
  return { portes, sapins };
}

export function nouveauSkieur(id: string, pseudo: string, couleur: string): Skieur {
  return {
    id,
    pseudo,
    couleur,
    x: LARGEUR_PISTE / 2,
    y: 0,
    v: 0,
    dir: 0,
    chuteJusqua: 0,
    porte: 0,
    ratees: [],
    sapinsTouches: new Set(),
    finiA: null,
  };
}

export function avancerSki(skieurs: Skieur[], p: Parcours, dt: number, sec: number, tempsMs: number): void {
  for (const s of skieurs) {
    if (s.finiA !== null) continue;
    if (sec < s.chuteJusqua) {
      s.v = 0;
      continue;
    }
    const dir = Math.max(-1, Math.min(1, s.dir));
    const vMax = V_MAX * (1 - 0.35 * Math.abs(dir));
    s.v = s.v < vMax ? Math.min(vMax, s.v + ACCEL * dt) : Math.max(vMax, s.v - 400 * dt);
    s.x = Math.max(RAYON_SKIEUR, Math.min(LARGEUR_PISTE - RAYON_SKIEUR, s.x + dir * LATERAL * dt));
    s.y += s.v * dt;
    while (s.porte < p.portes.length && s.y >= p.portes[s.porte]!.y) {
      const g = p.portes[s.porte]!;
      if (Math.abs(s.x - g.x) > LARGEUR_PORTE / 2) s.ratees.push(s.porte);
      s.porte++;
    }
    p.sapins.forEach((t, i) => {
      if (s.sapinsTouches.has(i)) return;
      if (Math.abs(t.y - s.y) < RAYON_SAPIN + RAYON_SKIEUR && Math.abs(t.x - s.x) < RAYON_SAPIN + RAYON_SKIEUR) {
        s.sapinsTouches.add(i);
        s.chuteJusqua = sec + CHUTE;
        s.v = 0;
      }
    });
    if (s.y >= LONGUEUR) {
      s.y = LONGUEUR;
      s.finiA = tempsMs;
    }
  }
}

/** Temps final en secondes (pénalités comprises). */
export function tempsFinal(s: Skieur): number | null {
  return s.finiA === null ? null : s.finiA / 1000 + s.ratees.length * PENALITE_PORTE;
}

export function classementSki(ss: Skieur[]): Skieur[] {
  return [...ss].sort((a, b) => {
    const ta = tempsFinal(a);
    const tb = tempsFinal(b);
    if (ta !== null && tb !== null) return ta - tb;
    if (ta !== null) return -1;
    if (tb !== null) return 1;
    return b.y - a.y;
  });
}
