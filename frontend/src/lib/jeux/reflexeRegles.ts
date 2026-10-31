/**
 * reflexeRegles.ts — feat/jeux-manette
 * Réflexe : l'écran du téléphone passe au vert → taper le plus vite possible.
 * Le temps est mesuré SUR le téléphone (de l'affichage du vert au doigt),
 * donc le réseau ne désavantage personne. Taper trop tôt (rouge) ou sur le
 * piège (orange) = faux départ.
 */
export const MANCHES = 6;
export const POINTS_RANG = [5, 3, 2];
export const POINTS_VALIDE = 1;
export const PENALITE_FAUX = -2;
export const ATTENTE_GO_MS = 3500;

export type Etape = 'pret' | 'piege' | 'go' | 'resultat';

export interface Reponse {
  id: string;
  ms: number | null; // null = faux départ
}

export interface LigneManche {
  id: string;
  ms: number | null;
  faux: boolean;
  points: number;
}

/**
 * Classe une manche. ids = tous les joueurs présents ; ceux qui n'ont rien
 * envoyé marquent 0.
 */
export function classerManche(ids: string[], reponses: Map<string, Reponse>): LigneManche[] {
  const valides = [...reponses.values()]
    .filter((r) => r.ms !== null)
    .sort((a, b) => a.ms! - b.ms!);
  const lignes: LigneManche[] = ids.map((id) => {
    const r = reponses.get(id);
    if (!r) return { id, ms: null, faux: false, points: 0 };
    if (r.ms === null) return { id, ms: null, faux: true, points: PENALITE_FAUX };
    const rang = valides.findIndex((v) => v.id === id);
    return { id, ms: r.ms, faux: false, points: POINTS_RANG[rang] ?? POINTS_VALIDE };
  });
  return lignes.sort((a, b) => {
    if (a.ms !== null && b.ms !== null) return a.ms - b.ms;
    if (a.ms !== null) return -1;
    if (b.ms !== null) return 1;
    return Number(a.faux) - Number(b.faux);
  });
}

/** Délai avant le vert (2 à 5 s) et, à partir de la manche 2, un piège une fois sur deux. */
export function tirerManche(manche: number, alea: () => number = Math.random): { attenteMs: number; piegeMs: number | null } {
  const attenteMs = 2000 + Math.floor(alea() * 3000);
  const piege = manche >= 2 && alea() < 0.5;
  return { attenteMs, piegeMs: piege ? Math.floor(attenteMs * (0.35 + alea() * 0.3)) : null };
}
