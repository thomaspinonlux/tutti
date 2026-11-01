/**
 * motoMoteur.ts — feat/jeux-manette-2
 * Moto vue de côté (façon Excitebike) : chacun sa ligne, même terrain pour
 * tous (bosses, tremplins, plateaux). GAZ pour avancer ; en l'air on se
 * penche (en arrière / en avant) pour retomber à plat. Mauvaise réception =
 * chute (1,5 s). Fonctions pures, calculées sur la TV.
 * Repère : x vers la droite, hauteur h vers le HAUT (px).
 */
export const LONGUEUR = 9000;
const GRAVITE = 1400;
const V_MAX = 680;
const V_MAX_AIR = 760;
const POUSSEE = 520;
const FREIN_MOTEUR = 160;
const ROTATION = 3.2; // rad/s à fond de penché
const CABRAGE_GAZ = 0.5; // rad/s : les gaz en l'air relèvent le nez
export const TOLERANCE = 0.45; // rad d'écart à la réception
const CHUTE = 1.5;

export type Point = [number, number];

/** Terrain : suite de points (x, h) reliés en ligne droite. */
export function genererTerrain(alea: () => number = Math.random): Point[] {
  const pts: Point[] = [[0, 0], [500, 0]];
  let x = 500;
  const plat = (l: number): void => {
    x += l;
    pts.push([x, 0]);
  };
  while (x < LONGUEUR - 700) {
    const r = alea();
    if (r < 0.35) {
      // Tremplin raide puis chute nette : on vole.
      const h = 60 + alea() * 40;
      x += h / Math.tan(0.6);
      pts.push([x, h]);
      x += 4;
      pts.push([x, 0]);
      plat(260 + alea() * 120);
    } else if (r < 0.6) {
      // Trois bosses douces (on les avale sans décoller, mais elles freinent)
      for (let k = 0; k < 3; k++) {
        x += 80;
        pts.push([x, 18]);
        x += 80;
        pts.push([x, 0]);
      }
      plat(200);
    } else if (r < 0.85) {
      // Table : montée, plateau, descente (on peut atterrir dans la pente)
      x += 120;
      pts.push([x, 70]);
      x += 180 + alea() * 120;
      pts.push([x, 70]);
      x += 140;
      pts.push([x, 0]);
      plat(220);
    } else {
      plat(300);
    }
  }
  pts.push([LONGUEUR + 2000, 0]);
  return pts;
}

/** Hauteur du terrain et pente (rad, positive = montée) en x. */
export function sol(t: Point[], x: number): { h: number; pente: number } {
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (t[m]![0] <= x) lo = m;
    else hi = m;
  }
  const [x0, h0] = t[lo]!;
  const [x1, h1] = t[hi]!;
  const f = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
  return { h: h0 + (h1 - h0) * Math.max(0, Math.min(1, f)), pente: Math.atan2(h1 - h0, x1 - x0) };
}

export interface Pilote {
  id: string;
  pseudo: string;
  couleur: string;
  x: number;
  h: number;
  v: number; // au sol : vitesse le long de la pente
  vx: number; // en l'air
  vh: number;
  air: boolean;
  assiette: number; // rad, positive = nez en l'air
  gaz: boolean;
  penche: number; // -1 en arrière … 1 en avant
  chuteJusqua: number;
  chutes: number;
  finiA: number | null;
}

export function nouveauPilote(id: string, pseudo: string, couleur: string): Pilote {
  return { id, pseudo, couleur, x: 120, h: 0, v: 0, vx: 0, vh: 0, air: false, assiette: 0, gaz: false, penche: 0, chuteJusqua: 0, chutes: 0, finiA: null };
}

const angle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Avance un pilote. Renvoie 'chute' s'il vient de tomber. */
export function avancerPilote(p: Pilote, t: Point[], dt: number, sec: number, tempsMs: number): 'chute' | null {
  if (p.finiA !== null) {
    p.v = Math.max(0, p.v - 400 * dt);
    p.x += p.v * dt;
    p.h = sol(t, p.x).h;
    return null;
  }
  if (sec < p.chuteJusqua) {
    p.v = 0;
    return null;
  }
  let evenement: 'chute' | null = null;
  if (!p.air) {
    const s = sol(t, p.x);
    const acc = (p.gaz ? POUSSEE : -FREIN_MOTEUR) - GRAVITE * 0.6 * Math.sin(s.pente);
    p.v = Math.max(0, Math.min(V_MAX, p.v + acc * dt));
    const nx = p.x + p.v * Math.cos(s.pente) * dt;
    const hLigne = p.h + p.v * Math.sin(s.pente) * dt;
    const apres = sol(t, nx);
    p.x = nx;
    // On ne décolle qu'en quittant un vrai tremplin (pas sur les petites bosses).
    if (apres.h < hLigne - 3 && p.v > 120 && s.pente > 0.25 && apres.pente < s.pente - 0.45) {
      // Le sol se dérobe : décollage.
      p.air = true;
      p.vx = p.v * Math.cos(s.pente);
      p.vh = p.v * Math.sin(s.pente);
      p.h = hLigne;
      p.assiette = s.pente;
    } else {
      p.h = apres.h;
      p.assiette = apres.pente;
    }
  } else {
    p.vh -= GRAVITE * dt;
    if (p.gaz) p.vx = Math.min(V_MAX_AIR, p.vx + 40 * dt);
    p.x += p.vx * dt;
    p.h += p.vh * dt;
    p.assiette = angle(p.assiette - Math.max(-1, Math.min(1, p.penche)) * ROTATION * dt + (p.gaz ? CABRAGE_GAZ * dt : 0));
    const s = sol(t, p.x);
    if (p.h <= s.h) {
      p.h = s.h;
      p.air = false;
      const ecart = Math.abs(angle(p.assiette - s.pente));
      if (ecart > TOLERANCE) {
        p.chuteJusqua = sec + CHUTE;
        p.chutes++;
        p.v = 0;
        evenement = 'chute';
      } else {
        p.v = Math.hypot(p.vx, p.vh * 0.3) * (1 - ecart * 0.8);
      }
      p.assiette = s.pente;
    }
  }
  if (p.x >= LONGUEUR && p.finiA === null) p.finiA = tempsMs;
  return evenement;
}

export function classementMoto(ps: Pilote[]): Pilote[] {
  return [...ps].sort((a, b) => {
    if (a.finiA !== null && b.finiA !== null) return a.finiA - b.finiA;
    if (a.finiA !== null) return -1;
    if (b.finiA !== null) return 1;
    return b.x - a.x;
  });
}
