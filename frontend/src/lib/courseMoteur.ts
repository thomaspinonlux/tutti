/**
 * courseMoteur.ts — feat/course-test
 *
 * Le moteur de la course, calculé sur la TV (le serveur ne fait que relayer
 * les commandes des téléphones). Fonctions pures, sans dessin.
 *
 * Piste « stade » : un segment horizontal (centre) et, autour, une bande de
 * route entre RAYON_INT et RAYON_EXT. Sens : ligne droite du bas vers la
 * droite, virage droit, ligne droite du haut vers la gauche, virage gauche.
 * La ligne d'arrivée est au milieu de la ligne droite du bas.
 */
export const LARGEUR = 1600;
export const HAUTEUR = 900;
export const CX = 800;
export const CY = 450;
export const DEMI = 350; // demi-longueur des lignes droites
export const RAYON_INT = 170;
export const RAYON_EXT = 330;
export const RAYON_MILIEU = (RAYON_INT + RAYON_EXT) / 2;
export const TOURS = 5;

export const V_ROUTE = 360;
const V_HERBE = 150;
const V_FREIN = 120;
const ACCEL = 280;
const DECEL = 520;
const BRAQUAGE = 3.1; // rad/s
const RAYON_VOITURE = 15;

export interface Voiture {
  id: string;
  pseudo: string;
  couleur: string;
  x: number;
  y: number;
  angle: number;
  v: number;
  g: boolean;
  d: boolean;
  tours: number;
  etape: 0 | 1 | 2 | 3;
  finiA: number | null; // ms depuis le départ
}

/** Distance au segment central (la « colonne vertébrale » du stade). */
export function distanceAuCentre(x: number, y: number): number {
  const px = Math.max(CX - DEMI, Math.min(CX + DEMI, x));
  return Math.hypot(x - px, y - CY);
}

export function surLaRoute(x: number, y: number): boolean {
  const d = distanceAuCentre(x, y);
  return d >= RAYON_INT && d <= RAYON_EXT;
}

/** Abscisse le long du tour (0 = ligne d'arrivée), pour classer les voitures. */
export function abscisse(x: number, y: number): number {
  const arc = Math.PI * RAYON_MILIEU;
  if (x > CX + DEMI) {
    // Virage droit : du bas (π/2) vers le haut (-π/2) en passant par la droite (0).
    const a = Math.atan2(y - CY, x - (CX + DEMI));
    return DEMI + ((Math.PI / 2 - a) / Math.PI) * arc;
  }
  if (x < CX - DEMI) {
    // Virage gauche : du haut (-π/2) vers le bas (π/2) en passant par la gauche (±π).
    const a = Math.atan2(y - CY, x - (CX - DEMI));
    const f = a < 0 ? (-Math.PI / 2 - a) / Math.PI : 0.5 + (Math.PI - a) / Math.PI;
    return 3 * DEMI + arc + Math.max(0, Math.min(1, f)) * arc;
  }
  if (y < CY) return DEMI + arc + (CX + DEMI - x); // ligne droite du haut, vers la gauche
  if (x >= CX) return x - CX; // bas, après la ligne
  return 3 * DEMI + 2 * arc + (x - (CX - DEMI)); // bas, avant la ligne
}

export const LONGUEUR_TOUR = 4 * DEMI + 2 * Math.PI * RAYON_MILIEU;

/** Grille de départ : juste après la ligne, deux colonnes. */
export function grille(i: number): { x: number; y: number; angle: number } {
  const rangee = Math.floor(i / 2);
  const colonne = i % 2;
  return {
    x: CX + 200 - rangee * 50,
    y: CY + RAYON_MILIEU + (colonne === 0 ? -40 : 40),
    angle: 0,
  };
}

export function nouvelleVoiture(id: string, pseudo: string, couleur: string, i: number): Voiture {
  const g0 = grille(i);
  return { id, pseudo, couleur, x: g0.x, y: g0.y, angle: g0.angle, v: 0, g: false, d: false, tours: 0, etape: 0, finiA: null };
}

/**
 * Avance la course de `dt` secondes. `enCourse` = false pendant le compte à
 * rebours (les voitures restent sur la grille). Renvoie les voitures qui
 * viennent de franchir la ligne d'arrivée finale.
 */
export function avancer(voitures: Voiture[], dt: number, enCourse: boolean, tempsMs: number): string[] {
  const arrivees: string[] = [];
  if (!enCourse) return arrivees;
  for (const c of voitures) {
    if (c.finiA !== null) {
      c.v = Math.max(0, c.v - DECEL * dt); // roue libre après l'arrivée
    } else {
      const route = surLaRoute(c.x, c.y);
      const cible = c.g && c.d ? V_FREIN : route ? V_ROUTE : V_HERBE;
      c.v = c.v < cible ? Math.min(cible, c.v + ACCEL * dt) : Math.max(cible, c.v - DECEL * dt);
      const sens = (c.d ? 1 : 0) - (c.g ? 1 : 0);
      if (!(c.g && c.d)) c.angle += sens * BRAQUAGE * dt * Math.min(1, c.v / 140);
    }
    const ax = c.x;
    c.x += Math.cos(c.angle) * c.v * dt;
    c.y += Math.sin(c.angle) * c.v * dt;
    // Bords de l'écran : on rebondit doucement.
    if (c.x < RAYON_VOITURE || c.x > LARGEUR - RAYON_VOITURE) {
      c.x = Math.max(RAYON_VOITURE, Math.min(LARGEUR - RAYON_VOITURE, c.x));
      c.v *= 0.5;
    }
    if (c.y < RAYON_VOITURE || c.y > HAUTEUR - RAYON_VOITURE) {
      c.y = Math.max(RAYON_VOITURE, Math.min(HAUTEUR - RAYON_VOITURE, c.y));
      c.v *= 0.5;
    }
    // Passages obligés (pas de raccourci par l'herbe du milieu… ni à l'envers).
    if (c.etape === 0 && c.x > CX + DEMI) c.etape = 1;
    else if (c.etape === 1 && c.y < CY && c.x < CX) c.etape = 2;
    else if (c.etape === 2 && c.x < CX - DEMI) c.etape = 3;
    else if (c.etape === 3 && c.y > CY && ax < CX && c.x >= CX) {
      c.etape = 0;
      c.tours += 1;
      if (c.tours >= TOURS && c.finiA === null) {
        c.finiA = tempsMs;
        arrivees.push(c.id);
      }
    }
  }
  // Chocs entre voitures : on les écarte, elles perdent un peu de vitesse.
  for (let i = 0; i < voitures.length; i++) {
    for (let j = i + 1; j < voitures.length; j++) {
      const a = voitures[i]!;
      const b = voitures[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0 && dist < RAYON_VOITURE * 2) {
        const pousse = (RAYON_VOITURE * 2 - dist) / 2;
        a.x -= (dx / dist) * pousse;
        a.y -= (dy / dist) * pousse;
        b.x += (dx / dist) * pousse;
        b.y += (dy / dist) * pousse;
        a.v *= 0.92;
        b.v *= 0.92;
      }
    }
  }
  return arrivees;
}

/** Classement : arrivés d'abord (par temps), puis tours, puis position sur le tour. */
export function classement(voitures: Voiture[]): Voiture[] {
  const avancee = (c: Voiture): number => {
    // Tant que l'étape 0 n'est pas franchie on est juste après la ligne.
    const s = abscisse(c.x, c.y);
    const surTour = c.etape === 0 && s > LONGUEUR_TOUR * 0.75 ? 0 : s;
    return c.tours * LONGUEUR_TOUR + surTour;
  };
  return [...voitures].sort((a, b) => {
    if (a.finiA !== null || b.finiA !== null) {
      if (a.finiA === null) return 1;
      if (b.finiA === null) return -1;
      return a.finiA - b.finiA;
    }
    return avancee(b) - avancee(a);
  });
}
