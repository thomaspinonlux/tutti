/**
 * dessinComparaison.ts — feat/dessin-a-deviner
 * Le mot masqué et la comparaison des propositions : fonctions pures.
 */
import { levenshtein, normalize } from './quizzMatch.js';

/** Ce qu'il faut de la question pour reconnaître le mot. */
export interface MotADeviner {
  answer_lang1: string;
  answer_aliases_lang1: string[];
}

/**
 * Le mot masqué pour la TV et les joueurs : chaque lettre ou chiffre devient
 * « _ », les espaces, tirets et apostrophes restent (le nombre de mots et de
 * lettres est un indice, comme au Pictionary).
 */
export function masquerMot(mot: string): string {
  return [...mot.trim()].map((ch) => (/[\p{L}\p{N}]/u.test(ch) ? '_' : ch)).join('');
}

const ARTICLES = new Set(['le', 'la', 'les', 'l', 'un', 'une', 'des', 'du', 'de', 'd', 'the', 'a', 'an']);

/** Forme comparable : minuscules, sans accents, sans articles, sans pluriel. */
export function formeComparable(texte: string): string[] {
  const sansLigatures = texte.replace(/œ/gi, 'oe').replace(/æ/gi, 'ae');
  return normalize(sansLigatures.replace(/['’]/g, ' '))
    .split(' ')
    .filter((m) => m.length > 0 && !ARTICLES.has(m))
    .map((m) => (m.length > 3 && /[sx]$/.test(m) ? m.slice(0, -1) : m));
}

function ecart(a: string, b: string): number {
  return levenshtein(a, b) / Math.max(a.length, b.length, 1);
}

/**
 * La proposition est-elle le mot ?
 *   - 'oui'    : c'est le mot (fautes légères tolérées), y compris quand il est
 *                noyé dans une phrase (« c'est un chat ! ») — sinon la phrase
 *                s'afficherait sur la TV et donnerait la réponse à tous ;
 *   - 'proche' : ça chauffe — répondu au seul joueur, jamais affiché ;
 *   - 'non'    : affiché sur la TV.
 */
export function comparerProposition(mot: MotADeviner, texte: string): 'oui' | 'proche' | 'non' {
  const essai = formeComparable(texte);
  if (essai.length === 0) return 'non';
  const candidats = [mot.answer_lang1, ...mot.answer_aliases_lang1]
    .map(formeComparable)
    .filter((c) => c.length > 0);
  let proche = false;
  for (const cand of candidats) {
    const cible = cand.join(' ');
    const n = cand.length;
    // Toutes les suites de n mots consécutifs de la proposition.
    for (let i = 0; i + n <= essai.length; i++) {
      const morceau = essai.slice(i, i + n).join(' ');
      const e = ecart(morceau, cible);
      if (e < 0.2 || (cible.length >= 6 && levenshtein(morceau, cible) <= 1)) return 'oui';
      if (e < 0.4) proche = true;
    }
    if (ecart(essai.join(' '), cible) < 0.4) proche = true;
  }
  return proche ? 'proche' : 'non';
}

