/**
 * Voice matching — décide si un transcript Whisper contient une mention
 * de l'artiste et/ou du titre du morceau en cours.
 *
 * Stratégie "première réponse qui matche parmi toutes les tentatives" :
 *   - Le joueur peut hésiter, donner plusieurs propositions, dire des
 *     mots de remplissage. On cherche dans l'intégralité du transcript.
 *   - On normalise (lowercase, accents, ponctuation), on filtre les
 *     hésitations FR ("euh", "ah", "non", articles seuls...).
 *   - Pour CHAQUE alias artiste (canonical_name + aliases), on tente un
 *     fuzzy match (Levenshtein normalisé < 0.25) sur des n-grams du
 *     transcript. Si trouvé → matched_artist = true.
 *   - Idem pour le titre.
 *
 * Pas de pénalité sur les mauvaises réponses : c'est OR-logic, on cherche
 * une trace du bon dans le bruit.
 */

// Mots à filtrer (fillers / hésitations FR + EN basics).
// Liste à enrichir au fil des tests utilisateurs.
const FILLER_WORDS_FR = new Set([
  'euh',
  'ah',
  'oh',
  'non',
  'attends',
  'attendez',
  'ouais',
  'ouf',
  'bah',
  'ben',
  'alors',
  'ok',
  'voyons',
  'merde',
  'putain',
  'bordel',
  'zut',
  'bof',
  'mmh',
  'hmm',
  'hum',
  // Articles seuls (sans contexte ils n'apportent rien)
  'le',
  'la',
  'les',
  'un',
  'une',
  'des',
  'de',
  'du',
  'l',
  'd',
]);

const FILLER_WORDS_EN = new Set([
  'uh',
  'um',
  'eh',
  'oh',
  'no',
  'wait',
  'yeah',
  'yes',
  'well',
  'ok',
  'hmm',
  'mmh',
  'the',
  'a',
  'an',
  'and',
  'of',
]);

const ALL_FILLERS = new Set([...FILLER_WORDS_FR, ...FILLER_WORDS_EN]);

// Seuil de similarité Levenshtein normalisé (distance / max(len)).
// 0.25 = "stomei" matche "stromae" (1 / 7 ≈ 0.14, ok),
//        "stromaye" matche "stromae" (1 / 8 = 0.125, ok),
//        "calogero" ne matche pas "stromae".
const FUZZY_THRESHOLD = 0.25;

// ── Normalisation ────────────────────────────────────────────────────────

/**
 * Lowercase + sans accents + sans ponctuation. Préserve les espaces et
 * apostrophes (utiles pour l'anglais).
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Découpe en mots, retire les fillers, retourne le tableau de tokens utiles.
 */
function tokenizeMeaningful(transcript: string): string[] {
  return normalize(transcript)
    .split(' ')
    .filter((w) => w.length >= 2 && !ALL_FILLERS.has(w));
}

// ── Levenshtein ──────────────────────────────────────────────────────────

/**
 * Distance de Levenshtein classique (matrice DP). O(n*m).
 * Pour des chaînes < 50 chars (alias artiste/titre), c'est instantané.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

/** Similarité 0-1 (1 = identique) basée sur Levenshtein normalisé. */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  const max = Math.max(a.length, b.length);
  return 1 - dist / max;
}

// ── Matching d'un candidat alias contre les n-grams du transcript ────────

/**
 * Génère les n-grams du transcript (de 1 à maxN mots consécutifs).
 * Permet de matcher "alors on danse" même si le joueur dit
 * "euh c'est alors on danse non ?".
 */
function generateNgrams(tokens: string[], maxN: number): string[] {
  const out: string[] = [];
  const n = Math.min(maxN, tokens.length);
  for (let size = 1; size <= n; size++) {
    for (let i = 0; i <= tokens.length - size; i++) {
      out.push(tokens.slice(i, i + size).join(' '));
    }
  }
  return out;
}

/**
 * Vérifie si l'un des aliases match au moins un n-gram du transcript via
 * fuzzy similarity. Retourne la meilleure confidence trouvée (0-1).
 */
function matchAnyAlias(
  ngrams: string[],
  aliasesNormalized: string[],
): { matched: boolean; confidence: number; ngram: string | null } {
  if (aliasesNormalized.length === 0) return { matched: false, confidence: 0, ngram: null };
  let best = 0;
  let bestNgram: string | null = null;
  for (const alias of aliasesNormalized) {
    if (alias.length < 2) continue;
    for (const ngram of ngrams) {
      // Si la longueur diverge trop, skip pour ne pas matcher du bruit.
      if (Math.abs(ngram.length - alias.length) > Math.max(3, alias.length * 0.5)) continue;
      const sim = similarity(alias, ngram);
      if (sim > best) {
        best = sim;
        bestNgram = ngram;
      }
      if (best >= 1 - FUZZY_THRESHOLD) {
        return { matched: true, confidence: best, ngram };
      }
    }
  }
  return { matched: best >= 1 - FUZZY_THRESHOLD, confidence: best, ngram: bestNgram };
}

// ── API publique ─────────────────────────────────────────────────────────

export interface MatchInput {
  transcript: string;
  artist: { canonical_name: string; aliases: string[] };
  track: { canonical_title: string; aliases: string[] };
}

export interface MatchResult {
  matched_artist: boolean;
  matched_title: boolean;
  /**
   * true si artiste ET titre ont matché sur le MÊME n-gram (ex. un titre qui
   * contient le nom de l'artiste) → ambigu, ne doit PAS compter "double".
   */
  same_ngram: boolean;
  /** Confiance globale 0-1 (max entre artist et title). */
  confidence: number;
  /** Transcript normalisé pour le log. */
  transcript_normalized: string;
}

export function matchTranscript(input: MatchInput): MatchResult {
  const tokens = tokenizeMeaningful(input.transcript);
  const transcriptNormalized = tokens.join(' ');

  console.info('[Voice Match] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.info('[Voice Match] Transcription Whisper brute:', JSON.stringify(input.transcript));
  console.info('[Voice Match] Transcription normalisée :', JSON.stringify(transcriptNormalized));
  console.info('[Voice Match] Track:', input.track.canonical_title);
  console.info('[Voice Match] Artist:', input.artist.canonical_name);

  if (tokens.length === 0) {
    console.warn('[Voice Match] ❌ tokens vides après filtre fillers');
    return {
      matched_artist: false,
      matched_title: false,
      same_ngram: false,
      confidence: 0,
      transcript_normalized: transcriptNormalized,
    };
  }

  // n-grams 1 à 5 mots — couvre "stromae", "alors on danse", titres
  // composés type "All You Need is Love".
  const ngrams = generateNgrams(tokens, 5);
  console.info('[Voice Match] N-grams testés:', JSON.stringify(ngrams));

  const artistAliases = [input.artist.canonical_name, ...input.artist.aliases]
    .map(normalize)
    .filter((s) => s.length >= 2);

  const titleAliases = [input.track.canonical_title, ...input.track.aliases]
    .map(normalize)
    .filter((s) => s.length >= 2);

  console.info('[Voice Match] Aliases artiste (normalisés):', JSON.stringify(artistAliases));
  console.info('[Voice Match] Aliases titre (normalisés):', JSON.stringify(titleAliases));

  const artistMatch = matchAnyAlias(ngrams, artistAliases);
  const titleMatch = matchAnyAlias(ngrams, titleAliases);

  console.info(
    '[Voice Match] Artist match:',
    artistMatch.matched,
    '(confidence:',
    artistMatch.confidence.toFixed(3),
    ')',
  );
  console.info(
    '[Voice Match] Title match:',
    titleMatch.matched,
    '(confidence:',
    titleMatch.confidence.toFixed(3),
    ')',
  );
  if (!artistMatch.matched) {
    console.warn(
      '[Voice Match] ⚠️ Pas de match artiste. Threshold = ',
      1 - FUZZY_THRESHOLD,
      '. Confidence max trouvée:',
      artistMatch.confidence.toFixed(3),
    );
  }
  console.info('[Voice Match] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Garde "double imérité" : si artiste ET titre matchent sur le MÊME n-gram
  // (titre contenant le nom de l'artiste, p.ex.), c'est ambigu → pas de double.
  const sameNgram =
    artistMatch.matched &&
    titleMatch.matched &&
    artistMatch.ngram !== null &&
    artistMatch.ngram === titleMatch.ngram;

  return {
    matched_artist: artistMatch.matched,
    matched_title: titleMatch.matched,
    same_ngram: sameNgram,
    confidence: Math.max(artistMatch.confidence, titleMatch.confidence),
    transcript_normalized: transcriptNormalized,
  };
}
