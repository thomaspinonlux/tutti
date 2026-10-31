/**
 * pongMoteur.ts — feat/jeux-manette
 * Pong : 1 contre 1 ou 2 contre 2. Le téléphone sert de glissière : la
 * position du doigt = la position de la raquette. Seul, on joue contre
 * l'ordinateur. Premier à POINTS_VICTOIRE.
 * Fonctions pures, calculées sur la TV.
 */
export const LARGEUR = 1600;
export const HAUTEUR = 900;
export const H_RAQUETTE = 150;
export const L_RAQUETTE = 18;
export const RAYON_BALLE = 12;
export const POINTS_VICTOIRE = 7;

const V_RAQUETTE = 2400; // px/s
const V_ORDI = 640;
const V_BALLE_DEPART = 620;
const V_BALLE_MAX = 1500;
const ACCELERATION_PAR_RENVOI = 1.06;
const ANGLE_MAX = (60 * Math.PI) / 180;

export type Cote = 'g' | 'd';

export interface Raquette {
  id: string; // « ordi » pour l'ordinateur
  pseudo: string;
  couleur: string;
  cote: Cote;
  x: number; // bord intérieur, centre de la raquette en x
  y: number; // centre
  cible: number;
}

export interface Balle {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Match {
  raquettes: Raquette[];
  balle: Balle;
  score: { g: number; d: number };
  /** Instant (s) où la balle repart ; null = en jeu. */
  serviceA: number | null;
  serviceVers: Cote;
}

/** Répartit les joueurs gauche / droite (alternés). Seul → l'ordinateur à droite. */
export function nouveauMatch(joueurs: Array<{ id: string; pseudo: string; couleur: string }>): Match {
  const raquettes: Raquette[] = [];
  const parCote = { g: 0, d: 0 };
  joueurs.slice(0, 4).forEach((j, i) => {
    const cote: Cote = i % 2 === 0 ? 'g' : 'd';
    const rang = parCote[cote]++;
    const x = cote === 'g' ? 60 + rang * 170 : LARGEUR - 60 - rang * 170;
    raquettes.push({ ...j, cote, x, y: HAUTEUR / 2, cible: HAUTEUR / 2 });
  });
  if (joueurs.length === 1) {
    raquettes.push({ id: 'ordi', pseudo: 'Ordinateur', couleur: '#9AA0A6', cote: 'd', x: LARGEUR - 60, y: HAUTEUR / 2, cible: HAUTEUR / 2 });
  }
  return {
    raquettes,
    balle: { x: LARGEUR / 2, y: HAUTEUR / 2, vx: 0, vy: 0 },
    score: { g: 0, d: 0 },
    serviceA: 0,
    serviceVers: Math.random() < 0.5 ? 'g' : 'd',
  };
}

/** Position du doigt (-1 haut … 1 bas) → cible de la raquette. */
export function viser(r: Raquette, y: number): void {
  const demi = H_RAQUETTE / 2;
  r.cible = demi + ((Math.max(-1, Math.min(1, y)) + 1) / 2) * (HAUTEUR - 2 * demi);
}

function servir(m: Match): void {
  const a = (Math.random() - 0.5) * (Math.PI / 3);
  const sens = m.serviceVers === 'g' ? -1 : 1;
  m.balle = { x: LARGEUR / 2, y: HAUTEUR / 2, vx: Math.cos(a) * V_BALLE_DEPART * sens, vy: Math.sin(a) * V_BALLE_DEPART };
  m.serviceA = null;
}

/** Avance de dt secondes. Renvoie le côté qui marque, sinon null. */
export function avancer(m: Match, dt: number, secondes: number): Cote | null {
  // Raquettes
  for (const r of m.raquettes) {
    if (r.id === 'ordi') {
      const versMoi = r.cote === 'd' ? m.balle.vx > 0 : m.balle.vx < 0;
      const viseY = versMoi ? m.balle.y : HAUTEUR / 2;
      const ecart = viseY - r.y;
      r.y += Math.sign(ecart) * Math.min(Math.abs(ecart), V_ORDI * dt);
    } else {
      const ecart = r.cible - r.y;
      r.y += Math.sign(ecart) * Math.min(Math.abs(ecart), V_RAQUETTE * dt);
    }
    r.y = Math.max(H_RAQUETTE / 2, Math.min(HAUTEUR - H_RAQUETTE / 2, r.y));
  }
  if (m.serviceA !== null) {
    if (secondes >= m.serviceA) servir(m);
    return null;
  }
  // Balle, en petits pas pour ne jamais traverser une raquette.
  const b = m.balle;
  const vitesse = Math.hypot(b.vx, b.vy);
  const n = Math.max(1, Math.ceil((vitesse * dt) / 8));
  const h = dt / n;
  for (let k = 0; k < n; k++) {
    const avantX = b.x;
    b.x += b.vx * h;
    b.y += b.vy * h;
    if (b.y < RAYON_BALLE) {
      b.y = RAYON_BALLE;
      b.vy = Math.abs(b.vy);
    } else if (b.y > HAUTEUR - RAYON_BALLE) {
      b.y = HAUTEUR - RAYON_BALLE;
      b.vy = -Math.abs(b.vy);
    }
    for (const r of m.raquettes) {
      // Face de la raquette tournée vers le centre.
      const face = r.cote === 'g' ? r.x + L_RAQUETTE / 2 : r.x - L_RAQUETTE / 2;
      const versRaquette = r.cote === 'g' ? b.vx < 0 : b.vx > 0;
      if (!versRaquette) continue;
      const bord = r.cote === 'g' ? b.x - RAYON_BALLE : b.x + RAYON_BALLE;
      const bordAvant = r.cote === 'g' ? avantX - RAYON_BALLE : avantX + RAYON_BALLE;
      const franchit = r.cote === 'g' ? bordAvant >= face && bord <= face : bordAvant <= face && bord >= face;
      if (!franchit) continue;
      const decalage = (b.y - r.y) / (H_RAQUETTE / 2 + RAYON_BALLE);
      if (Math.abs(decalage) > 1) continue;
      const v = Math.min(V_BALLE_MAX, Math.hypot(b.vx, b.vy) * ACCELERATION_PAR_RENVOI);
      const a = decalage * ANGLE_MAX;
      const sens = r.cote === 'g' ? 1 : -1;
      b.vx = Math.cos(a) * v * sens;
      b.vy = Math.sin(a) * v;
      b.x = face + sens * RAYON_BALLE;
    }
    if (b.x < -RAYON_BALLE || b.x > LARGEUR + RAYON_BALLE) {
      const marque: Cote = b.x < 0 ? 'd' : 'g';
      m.score[marque]++;
      m.serviceA = secondes + 1.2;
      m.serviceVers = marque === 'g' ? 'd' : 'g'; // la balle part vers celui qui a encaissé
      m.balle = { x: LARGEUR / 2, y: HAUTEUR / 2, vx: 0, vy: 0 };
      return marque;
    }
  }
  return null;
}

export function vainqueur(m: Match): Cote | null {
  if (m.score.g >= POINTS_VICTOIRE) return 'g';
  if (m.score.d >= POINTS_VICTOIRE) return 'd';
  return null;
}
