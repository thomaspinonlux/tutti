/**
 * voiceMatching.ts — feat/voice-fuzzy-matching-backend
 *
 * Algorithmes de fuzzy matching pour comparer un transcript voix (Whisper /
 * Deepgram / AssemblyAI) à une réponse attendue (titre + artiste d'une track,
 * réponse libre quiz, etc.).
 *
 * Combine Levenshtein (distance d'édition, robuste aux typos) + Double
 * Metaphone (similarité phonétique, robuste aux mauvaises retranscriptions
 * type "laïk a préyeur" ≈ "like a prayer").
 *
 * Pure functions, sans I/O. Pas d'endpoint API ici — la lib est consommée
 * par un wrapper côté gameplayCore qui décide du seuil de validation et
 * applique les règles métier (position, score, bonus titre).
 *
 * API publique :
 *   normalizeText(text)      → string normalisé (no accents, no stopwords, no punct)
 *   levenshteinScore(a, b)   → 0-100 (100 = identique)
 *   phoneticScore(a, b)      → 0-100 (similarité Double Metaphone)
 *   combinedScore(t, e)      → 0-100 (60% Lev + 40% Phon)
 *   matchAnswer(t, {title,artist}) → { score, target } meilleur match
 */

import { doubleMetaphone } from 'double-metaphone';

// ───── Normalisation ──────────────────────────────────────────────────────

/** Mots vides FR + EN supprimés du transcript avant matching. */
const STOPWORDS = new Set([
  // FR — formes pleines
  'le',
  'la',
  'les',
  'un',
  'une',
  'des',
  'de',
  'du',
  // FR — formes contractées (post-split sur apostrophe : "l'été" → ["l", "ete"]).
  // On strip aussi les particules d'/n'/s'/j'/m'/t'/c'/qu'.
  'l',
  'd',
  'n',
  's',
  'j',
  'm',
  't',
  'c',
  'qu',
  // EN
  'the',
  'a',
  'an',
  // fix/ios-voice-cascade-mic-and-buzz-refused — fillers Deepgram iOS courants
  // (Nova-3 ajoute parfois ces marqueurs hésitation en début/fin de transcript).
  'uh',
  'um',
  'eh',
  'ah',
  'oh',
  'hey',
  'yeah',
  'okay',
  'ok',
  'euh',
  'ben',
  'bah',
  'voila',
  'hmm',
  'mmh',
]);

/**
 * Normalise un texte pour matching fuzzy :
 *   - lowercase
 *   - retire les accents (NFD + suppression des diacritiques)
 *   - retire toute ponctuation
 *   - tokenize, retire les stopwords FR + EN
 *   - rejoint avec un espace
 *
 * Cas edges :
 *   - "" → ""
 *   - "Like a Prayer!" → "like prayer"
 *   - "L'été indien" → "ete indien"  (l' supprimé comme stopword)
 */
export function normalizeText(text: string): string {
  if (!text) return '';
  const base = text
    .toLowerCase()
    // Décomposition Unicode (é → e + ´) puis retire les diacritiques.
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    // Apostrophes : remplace les variantes typographiques par '
    .replace(/[‘’ʼ]/g, "'")
    // Retire toute ponctuation sauf l'apostrophe (gardée pour "l'" "d'").
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    // Collapse multiple whitespace.
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return '';

  // Tokenize sur espaces + apostrophes (pour séparer "l'ete" → ["l", "ete"]).
  // On split sur apostrophe ET espace, puis filtre les stopwords.
  const tokens = base.split(/[\s']+/).filter((tok) => tok.length > 0 && !STOPWORDS.has(tok));
  return tokens.join(' ');
}

// ───── Levenshtein ────────────────────────────────────────────────────────

/**
 * Distance de Levenshtein (nombre minimum d'insertions/suppressions/
 * substitutions pour transformer `a` en `b`). Impl itérative avec 2 lignes
 * de buffer (espace O(min(|a|, |b|)) au lieu de O(|a|·|b|)).
 */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Toujours travailler avec a = la chaîne la plus courte (économise mémoire).
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  let prev = new Array<number>(a.length + 1);
  let curr = new Array<number>(a.length + 1);
  for (let i = 0; i <= a.length; i++) prev[i] = i;

  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        curr[i - 1]! + 1, // insertion
        prev[i]! + 1, // suppression
        prev[i - 1]! + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[a.length]!;
}

/**
 * Score de similarité Levenshtein normalisé 0-100. 100 = identique après
 * normalizeText. 0 = totalement différent.
 *
 * Formule : 100 * (1 - distance / maxLen). On normalise par maxLen pour
 * que "abc" vs "abcd" (1 edit / 4 chars) = 75% mais "x" vs "xy" (1 edit /
 * 2 chars) = 50%.
 */
export function levenshteinScore(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na === '' && nb === '') return 100;
  if (na === '' || nb === '') return 0;
  if (na === nb) return 100;
  const dist = levenshteinDistance(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return Math.round(100 * (1 - dist / maxLen));
}

// ───── Phonetic (Double Metaphone) ────────────────────────────────────────

/**
 * Compare deux mots via leur paire de codes Double Metaphone (primary +
 * alternate). Retourne true si UN des 4 produits cartésiens matche.
 *
 * Exemple : "knight" → ['NKT', 'NT']  ;  "night" → ['NT', '']
 * 1 paire commune ('NT') → match.
 */
function metaphonesMatch(a: string, b: string): boolean {
  const [ap, aa] = doubleMetaphone(a);
  const [bp, ba] = doubleMetaphone(b);
  if (ap && (ap === bp || ap === ba)) return true;
  if (aa && (aa === bp || aa === ba)) return true;
  return false;
}

/**
 * Score phonétique 0-100. Tokenise les 2 phrases (post-normalize), aligne
 * les positions, et calcule le pourcentage de tokens qui matchent
 * phonétiquement (any of 4 metaphone combinations).
 *
 * Si les longueurs diffèrent, on utilise le max comme dénominateur pour
 * pénaliser les phrases trop courtes/longues.
 */
export function phoneticScore(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na === '' && nb === '') return 100;
  if (na === '' || nb === '') return 0;
  const tokensA = na.split(' ').filter((t) => t.length > 0);
  const tokensB = nb.split(' ').filter((t) => t.length > 0);
  if (tokensA.length === 0 && tokensB.length === 0) return 100;
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  // Alignement greedy : pour chaque token de A, cherche le 1ʳᵉ match
  // phonétique dans B non encore consommé. Évite que "the the" matche
  // 2 fois le même "the" côté B.
  const consumedB = new Array<boolean>(tokensB.length).fill(false);
  let matches = 0;
  for (const tokA of tokensA) {
    for (let j = 0; j < tokensB.length; j++) {
      if (consumedB[j]) continue;
      const tokB = tokensB[j]!;
      if (tokA === tokB || metaphonesMatch(tokA, tokB)) {
        consumedB[j] = true;
        matches += 1;
        break;
      }
    }
  }
  const denom = Math.max(tokensA.length, tokensB.length);
  return Math.round((100 * matches) / denom);
}

// ───── Combined + matchAnswer ─────────────────────────────────────────────

/**
 * Score combiné Levenshtein (60%) + Phonetic (40%). Pondération choisie
 * pour favoriser légèrement la précision orthographique (post-Whisper qui
 * fait déjà du travail phonétique) tout en restant tolérant aux accents
 * étrangers / fautes courantes ("rapsodi" / "rhapsody").
 *
 * Dampener "totalement différent" : si lev<30 ET phon===0 (aucun match
 * phonétique de token), on divise le score par 2. Évite que "yo banane"
 * vs "like prayer" ne ressorte à ~11% (à cause de quelques chars communs
 * fortuits) alors qu'il s'agit clairement de phrases sans rapport.
 *
 * fix/ios-voice-cascade-mic-and-buzz-refused — 2 boosts pour iOS Deepgram :
 *   1. Substring containment : si `expected` (normalisé) est strictement
 *      inclus dans le transcript normalisé, on force ≥ 90. Couvre le cas
 *      où le joueur dit "alors on danse de stromae" alors qu'on attend
 *      "alors on danse" — actuellement Lev pénalise les mots en plus.
 *   2. Token-overlap : si ≥ 80% des tokens de `expected` apparaissent
 *      QUELQUE PART dans le transcript (ordre libre), on ajoute +15 pts.
 *      Couvre "Mistral Gagnant Renaud" vs "Renaud Mistral Gagnant".
 */
export function combinedScore(transcript: string, expected: string): number {
  const lev = levenshteinScore(transcript, expected);
  const phon = phoneticScore(transcript, expected);
  let combined = Math.round(0.6 * lev + 0.4 * phon);
  if (lev < 30 && phon === 0) {
    combined = Math.floor(combined * 0.5);
  }
  // Boost #1 — substring containment.
  const nt = normalizeText(transcript);
  const ne = normalizeText(expected);
  if (ne.length >= 3 && nt.length >= ne.length && nt.includes(ne)) {
    combined = Math.max(combined, 90);
  }
  // Boost #2 — token-overlap (ordre libre).
  const expTokens = ne.split(' ').filter((t) => t.length >= 2);
  if (expTokens.length >= 2) {
    const trTokens = new Set(nt.split(' ').filter((t) => t.length >= 2));
    const hits = expTokens.filter((t) => trTokens.has(t)).length;
    const overlapRatio = hits / expTokens.length;
    if (overlapRatio >= 0.8) {
      combined = Math.min(100, combined + 15);
    }
  }
  return combined;
}

export interface MatchResult {
  /** Score combiné meilleur match (0-100). */
  score: number;
  /** Cible matchée : 'title' ou 'artist_title' (combo "artist title"). */
  target: 'title' | 'artist_title';
  /** Détail des scores pour debug / UI tooltip. */
  scores: {
    title_combined: number;
    title_lev: number;
    title_phon: number;
    artist_title_combined: number;
    artist_title_lev: number;
    artist_title_phon: number;
  };
}

/**
 * Match d'un transcript voix contre une track (title + artist). Tente :
 *   - transcript vs title seul
 *   - transcript vs "artist title" (combo)
 * et retourne le meilleur des deux (max score). Permet au joueur de dire
 * soit juste "Like a Prayer" soit "Madonna Like a Prayer" — les 2 valident.
 */
export function matchAnswer(
  transcript: string,
  expected: { title: string; artist: string },
): MatchResult {
  const titleLev = levenshteinScore(transcript, expected.title);
  const titlePhon = phoneticScore(transcript, expected.title);
  const titleCombined = combinedScore(transcript, expected.title);

  const combo = `${expected.artist} ${expected.title}`;
  const comboLev = levenshteinScore(transcript, combo);
  const comboPhon = phoneticScore(transcript, combo);
  const comboCombined = combinedScore(transcript, combo);

  // fix/ios-voice-cascade-mic-and-buzz-refused — préfère artist_title en cas
  // d'égalité (boost substring/token-overlap peut tier les 2 scores) : un match
  // qui inclut l'artiste est plus spécifique et mérite le bonus title_bonus.
  const target: 'title' | 'artist_title' =
    comboCombined >= titleCombined ? 'artist_title' : 'title';
  const score = Math.max(titleCombined, comboCombined);

  return {
    score,
    target,
    scores: {
      title_combined: titleCombined,
      title_lev: titleLev,
      title_phon: titlePhon,
      artist_title_combined: comboCombined,
      artist_title_lev: comboLev,
      artist_title_phon: comboPhon,
    },
  };
}
