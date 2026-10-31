/**
 * petitBac.ts — feat/jeux-de-salon
 *
 * P'tit Bac : une lettre tirée au sort, des catégories (dans `choices` de la
 * question). Chacun remplit sa grille et l'envoie une fois. À la révélation :
 *   - réponse valable (commence par la lettre, au moins 2 lettres) et
 *     UNIQUE dans la salle : 20 points ;
 *   - valable mais trouvée par plusieurs joueurs : 10 points ;
 *   - vide ou mauvaise lettre : 0.
 * La grille de tout le monde s'affiche sur la TV : la salle juge elle-même
 * les réponses tirées par les cheveux (l'animateur peut corriger les points).
 */
import type { DetailsBac } from '@tutti/shared';
import { formeComparable } from './dessinComparaison.js';

export const POINTS_UNIQUE = 20;
export const POINTS_PARTAGE = 10;
/** Lettres jouables (sans K, Q, U, W, X, Y, Z : trop peu de mots). */
const LETTRES = 'ABCDEFGHIJLMNOPRSTV';

const lettresTirees = new Map<string, Set<string>>();
const lettreCourante = new Map<string, { questionIndex: number; lettre: string }>();

/** Une lettre pas encore tirée ce soir (on recommence quand tout est passé). */
export function tirerLettre(sessionId: string, questionIndex: number): string {
  let deja = lettresTirees.get(sessionId);
  if (!deja) {
    deja = new Set();
    lettresTirees.set(sessionId, deja);
  }
  let libres = [...LETTRES].filter((l) => !deja!.has(l));
  if (libres.length === 0) {
    deja.clear();
    libres = [...LETTRES];
  }
  const lettre = libres[Math.floor(Math.random() * libres.length)]!;
  deja.add(lettre);
  lettreCourante.set(sessionId, { questionIndex, lettre });
  return lettre;
}

export function lettreDe(sessionId: string, questionIndex: number): string | null {
  const c = lettreCourante.get(sessionId);
  return c && c.questionIndex === questionIndex ? c.lettre : null;
}

/** La grille envoyée par le téléphone : JSON d'un tableau de chaînes. */
export function lireGrille(valeur: string, nbCategories: number): string[] {
  let brut: unknown;
  try {
    brut = JSON.parse(valeur);
  } catch {
    brut = [];
  }
  const t = Array.isArray(brut) ? brut : [];
  return Array.from({ length: nbCategories }, (_, i) =>
    typeof t[i] === 'string' ? (t[i] as string).replace(/\s+/g, ' ').trim().slice(0, 40) : '',
  );
}

/** Forme comparable d'une réponse ; '' si elle ne vaut rien pour cette lettre. */
export function reponseValable(texte: string, lettre: string): string {
  const mots = formeComparable(texte);
  const forme = mots.join(' ');
  if (forme.replace(/[^a-z]/g, '').length < 2) return '';
  return forme.startsWith(lettre.toLowerCase()) ? forme : '';
}

export function bilanBac(
  lettre: string,
  categories: string[],
  grilles: Array<{ participant_id: string; pseudo: string; valeur: string }>,
): DetailsBac {
  const lues = grilles.map((g) => ({ ...g, cases: lireGrille(g.valeur, categories.length) }));
  const formes = lues.map((g) => g.cases.map((c) => reponseValable(c, lettre)));
  const lignes = lues.map((g, i) => {
    const reponses = g.cases.map((texte, k) => {
      const forme = formes[i]![k]!;
      if (!forme) return { texte, points: 0 };
      const pareil = formes.filter((f, j) => j !== i && f[k] === forme).length;
      return { texte, points: pareil === 0 ? POINTS_UNIQUE : POINTS_PARTAGE };
    });
    return {
      participant_id: g.participant_id,
      pseudo: g.pseudo,
      reponses,
      total: reponses.reduce((s, r) => s + r.points, 0),
    };
  });
  lignes.sort((a, b) => b.total - a.total);
  return { kind: 'bac', lettre, categories, lignes };
}
