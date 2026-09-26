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
/**
 * fix/titre-mange-par-les-mots-outils — UN MOT-OUTIL QUI EST LE TITRE DOIT
 * SURVIVRE.
 *
 * « Yeah! » (Usher) se reduisait a la chaine VIDE : « yeah » figure dans la
 * liste des mots sans interet, jetee des deux cotes. Le titre ne pouvait donc
 * mathematiquement jamais etre reconnu — et c est un alias de titre contenant
 * le nom de l artiste (« usher yeah ») qui rattrapait le coup, en donnant les
 * points du TITRE a qui disait seulement « Usher ». Soiree du 11/09 : quatre
 * bonus doubles voles de cette facon.
 *
 * `motsProteges` contient les mots-outils presents dans la reponse ATTENDUE :
 * ceux-la restent, des deux cotes. « yeah » compte quand le titre est
 * *Yeah!*, et reste ignore partout ailleurs.
 */
export function normalizeText(text: string, motsProteges?: Set<string>): string {
  if (!text) return '';
  const base = text
    .toLowerCase()
    // Décomposition Unicode (é → e + ´) puis retire les diacritiques.
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    // Apostrophes : remplace les variantes typographiques par '
    .replace(/[‘’ʼ]/g, "'")
    // fix/elision-collee — « L'Aventurier » devenait « aventurier » (le l'
    // etait jete comme mot outil) alors que la transcription arrive souvent
    // COLLEE : « laventurier » -> 55 %, refuse ; « l'aventurier » -> 100 %.
    // Meme titre, deux resultats selon l humeur du transcripteur. On soude
    // l elision des DEUX cotes : l'aventurier, laventurier et l aventurier
    // donnent tous « laventurier ». Touche tous les titres francais en L',
    // C', J', D', N', S', T', M', QU'.
    .replace(/\b(qu|[lcdjnstm])'(?=\p{L})/gu, '$1')
    // ... et l elision transcrite avec un ESPACE (« l aventurier », « c est
    // bon ») : meme soudure, sinon le « l » isole partait en mot outil.
    .replace(/\b(qu|[lcdjnstm]) (?=[aeiouyh]\p{L})/gu, '$1')
    // Retire toute ponctuation sauf l'apostrophe (gardée pour "l'" "d'").
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    // Collapse multiple whitespace.
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return '';

  // Tokenize sur espaces + apostrophes (pour séparer "l'ete" → ["l", "ete"]).
  // On split sur apostrophe ET espace, puis filtre les stopwords.
  const bruts = base.split(/[\s']+/).filter((tok) => tok.length > 0);
  const tokens = bruts.filter((tok) => !STOPWORDS.has(tok) || motsProteges?.has(tok));
  // Un titre entierement compose de mots-outils (« Yeah! », « Oh la la ») ne
  // doit pas devenir une chaine vide : on garde alors les mots tels quels.
  if (tokens.length === 0) return bruts.map(enChiffre).join(' ');
  return tokens.map(enChiffre).join(' ');
}

/**
 * fix/sept-nains — « 7 » ET « SEPT » SONT LE MÊME MOT.
 *
 * Soirée du 25/09, quatre réponses perdues sur *Blanche-Neige et les sept
 * nains* : l'alias français est bien en base, mais le transcripteur écrit
 * « les 7 nains » quand le catalogue dit « les sept nains ». Deux écritures
 * du même mot, deux résultats. On ramène donc tous les nombres à leur
 * chiffre, des deux côtés — « sept », « seven », « siete » et « 7 » sont
 * désormais la même chose.
 */
const NOMBRES: Record<string, string> = {
  zero: '0',
  un: '1',
  une: '1',
  deux: '2',
  trois: '3',
  quatre: '4',
  cinq: '5',
  six: '6',
  sept: '7',
  huit: '8',
  neuf: '9',
  dix: '10',
  onze: '11',
  douze: '12',
  treize: '13',
  quatorze: '14',
  quinze: '15',
  seize: '16',
  vingt: '20',
  trente: '30',
  quarante: '40',
  cinquante: '50',
  soixante: '60',
  cent: '100',
  mille: '1000',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  twenty: '20',
  thirty: '30',
  forty: '40',
  fifty: '50',
  sixty: '60',
  hundred: '100',
  thousand: '1000',
  uno: '1',
  dos: '2',
  tres: '3',
  cuatro: '4',
  cinco: '5',
  siete: '7',
  ocho: '8',
  nueve: '9',
  diez: '10',
};

/** Le mot, ramené à son chiffre quand c'en est un. */
function enChiffre(mot: string): string {
  return NOMBRES[mot] ?? mot;
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
export function levenshteinScore(a: string, b: string, motsProteges?: Set<string>): number {
  const na = normalizeText(a, motsProteges);
  const nb = normalizeText(b, motsProteges);
  // fix/points-sans-rien-dire — DEUX CHAÎNES VIDES NE VALENT PAS 100 %.
  // La normalisation retire les mots outils : un titre très court composé
  // uniquement de ces mots se réduit à une chaîne vide. Combiné à une
  // transcription vide (panne de reconnaissance), le score valait 100 et les
  // points étaient accordés à qui buzzait sans rien dire.
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
export function phoneticScore(a: string, b: string, motsProteges?: Set<string>): number {
  const na = normalizeText(a, motsProteges);
  const nb = normalizeText(b, motsProteges);
  // fix/points-sans-rien-dire — DEUX CHAÎNES VIDES NE VALENT PAS 100 %.
  // La normalisation retire les mots outils : un titre très court composé
  // uniquement de ces mots se réduit à une chaîne vide. Combiné à une
  // transcription vide (panne de reconnaissance), le score valait 100 et les
  // points étaient accordés à qui buzzait sans rien dire.
  if (na === '' || nb === '') return 0;
  const tokensA = na.split(' ').filter((t) => t.length > 0);
  const tokensB = nb.split(' ').filter((t) => t.length > 0);
  // fix/points-sans-rien-dire — cf. ci-dessus : aucun jeton des deux côtés
  // ne vaut pas une correspondance parfaite.
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
/**
 * Mots-outils a garder pour cette comparaison — cf. normalizeText.
 *
 * UNIQUEMENT quand la reponse attendue n est faite QUE de mots-outils
 * (« Yeah! », « Oh la la ») : sans cela elle se reduit a rien et ne peut
 * jamais etre reconnue. Des qu il reste un mot porteur, on ne protege rien :
 * garder le « a » de *Like a Prayer* ajoutait un jeton qui se rapprochait
 * phonetiquement de n importe quoi (« yo banane » passait de 6 a 27).
 */
export function motsAProteger(expected: string): Set<string> {
  const bruts = (expected ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/[\s']+/)
    .filter(Boolean);
  if (bruts.length === 0 || bruts.some((m) => !STOPWORDS.has(m))) return new Set();
  return new Set(bruts);
}

export function combinedScore(transcript: string, expected: string): number {
  const proteges = motsAProteger(expected);
  const lev = levenshteinScore(transcript, expected, proteges);
  const phon = phoneticScore(transcript, expected, proteges);
  let combined = Math.round(0.6 * lev + 0.4 * phon);
  if (lev < 30 && phon === 0) {
    combined = Math.floor(combined * 0.5);
  }
  // Boost #1 — contenance par MOTS ENTIERS.
  //
  // fix/alias-court-dans-un-mot — c etait une sous-chaine brute : l alias
  // « mas » (Jeanne Mas) etait trouve a l interieur de « masque », et « la
  // compagnie creole le bal masque » creditait Jeanne Mas. Mesure sur 1 953
  // titres : une reponse totalement fausse etait acceptee dans 0,15 % des
  // cas, toujours par ce mecanisme. L alias doit desormais apparaitre comme
  // une suite de mots entiers du transcript.
  const nt = normalizeText(transcript, proteges);
  const ne = normalizeText(expected, proteges);
  if (ne.length >= 3 && nt.length >= ne.length) {
    const motsT = nt.split(' ');
    const motsE = ne.split(' ');
    let contenu = false;
    for (let i = 0; i + motsE.length <= motsT.length && !contenu; i++) {
      contenu = motsE.every((m, k) => motsT[i + k] === m);
    }
    if (contenu) combined = Math.max(combined, 90);
  }
  // Boost #1 bis — LES ESPACES NE SONT PAS UNE REPONSE FAUSSE.
  //
  // Soiree du 18/09 : « murder on the dance floor » refuse a 77 % pour
  // *Murder on the Dancefloor*, « tatayoyo » refuse a 73 % pour *Tata Yoyo*.
  // Le joueur a donne la bonne reponse, lettre pour lettre ; seule la coupure
  // des mots differe, et personne ne sait ou Apple met l espace. On compare
  // donc aussi les deux chaines soudees : quand la suite de lettres est
  // identique, c est juste, point.
  //
  // Aucun risque d acceptation a tort : deux reponses differentes ne donnent
  // pas la meme suite de lettres. On exige 4 lettres au minimum pour ne pas
  // faire passer « ou » pour « o u ».
  const soude = (v: string): string => v.replace(/[^\p{L}\p{N}]/gu, '');
  const st = soude(nt);
  const se = soude(ne);
  if (se.length >= 4 && st === se) {
    combined = 100;
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

/**
 * feat/titre-partiel — UNE PARTIE DU TITRE PEUT SUFFIRE, MAIS PAS N IMPORTE
 * LAQUELLE.
 *
 * Demande de Thomas apres le 11/09 : « Morena » pour *Baila Morena*, « Of the
 * Tiger » pour *Eye of the Tiger* — le joueur connait le morceau, le moteur
 * refusait. Regle demandee : la moitie du titre suffit.
 *
 * MESURE AVANT DE LIVRER, et elle a fait changer la regle. Sur les 1 011
 * reponses du 11/09 et 2 718 reponses « bon artiste + titre d un autre
 * morceau » :
 *
 *   moitie des mots           ~7 reponses rattrapees   647 fausses acceptees
 *   deux tiers, mots qui se suivent   3 rattrapees      81 fausses
 *
 * A « la moitie », on donne des points a « Billie Eilish, Lonely » pour
 * *Lovely* et a « Beyonce, Beautiful Life » pour *Beautiful Liar*. Retenu donc,
 * et c est ce que fait le code ci-dessous :
 *
 *   1. on ne compte QUE les mots qui portent du sens — « of », « the », « la »,
 *      « pour » sont dans des centaines de titres et ne prouvent rien ;
 *   2. on ne compte PAS les mots du titre qui sont aussi dans le nom de
 *      l artiste — sinon dire « Santana » donnait le titre *Smooth* en prime
 *      via l alias « Santana Smooth » ;
 *   3. il faut les deux tiers de ces mots-la, et qui se suivent dans le titre ;
 *   4. la regle ne s applique qu au titre officiel, jamais aux alias (ils
 *      contiennent souvent le nom de l artiste) ;
 *   5. et l appelant verifie en plus que le fragment ne designe pas un AUTRE
 *      morceau de la manche (runMatchAndCommit) : sur les titres joues le meme
 *      soir, cette garde ramene les fausses acceptations a zero.
 *
 * L artiste doit de toute facon etre reconnu : un bout de titre ne se suffit
 * jamais a lui-meme.
 */

/** Mots-outils : presents dans des centaines de titres, ils ne prouvent rien. */
const MOTS_OUTILS = new Set([
  'le',
  'la',
  'les',
  'un',
  'une',
  'des',
  'du',
  'de',
  'd',
  'l',
  'au',
  'aux',
  'et',
  'ou',
  'a',
  'en',
  'dans',
  'sur',
  'pour',
  'par',
  'avec',
  'sans',
  'mon',
  'ma',
  'mes',
  'ton',
  'ta',
  'tes',
  'son',
  'sa',
  'ses',
  'ce',
  'cet',
  'cette',
  'qui',
  'que',
  'quoi',
  'ne',
  'pas',
  'plus',
  'je',
  'tu',
  'il',
  'elle',
  'on',
  'nous',
  'vous',
  'ils',
  'elles',
  'me',
  'te',
  'se',
  'y',
  'si',
  'the',
  'an',
  'of',
  'to',
  'in',
  'on',
  'at',
  'for',
  'with',
  'and',
  'or',
  'but',
  'my',
  'your',
  'his',
  'her',
  'its',
  'our',
  'their',
  'you',
  'he',
  'she',
  'it',
  'we',
  'they',
  'is',
  'are',
  'was',
  'were',
  'be',
  'am',
  'do',
  'not',
  'no',
  'all',
  'up',
  'down',
  'out',
  'so',
  'that',
  'this',
  'i',
  'im',
  'dont',
  'el',
  'los',
  'las',
  'del',
  'una',
  'mi',
  'su',
]);

/**
 * Le transcript couvre-t-il assez du titre officiel pour valoir le titre ?
 * `artiste` sert a ne pas compter deux fois les mots deja portes par la moitie
 * « artiste » (cf. point 2 ci-dessus).
 */
export function couvreAssezDuTitre(transcript: string, titre: string, artiste: string): boolean {
  const mots = normalizeText(titre).split(' ').filter(Boolean);
  if (mots.length === 0) return false;
  const dits = normalizeText(transcript).split(' ').filter(Boolean);
  if (dits.length === 0) return false;

  const consomme = new Array<boolean>(dits.length).fill(false);
  const presents = mots.map((m) => {
    const i = dits.findIndex(
      (d, k) => !consomme[k] && (d === m || (m.length >= 4 && levenshteinScore(d, m) >= 80)),
    );
    if (i >= 0) consomme[i] = true;
    return i >= 0;
  });

  // Plus long bloc de mots qui se suivent.
  let debut = -1;
  let longueur = 0;
  let courantDebut = -1;
  let courant = 0;
  presents.forEach((ok, i) => {
    if (!ok) {
      courant = 0;
      return;
    }
    if (courant === 0) courantDebut = i;
    courant += 1;
    if (courant > longueur) {
      longueur = courant;
      debut = courantDebut;
    }
  });
  if (longueur === 0) return false;

  const motsArtiste = new Set(normalizeText(artiste).split(' ').filter(Boolean));
  const porteDuSens = (m: string): boolean =>
    m.length >= 3 && !MOTS_OUTILS.has(m) && !motsArtiste.has(m);

  const attendus = mots.filter(porteDuSens);
  if (attendus.length === 0) return false; // titre sans mot propre : rien a verifier
  const dansLeBloc = mots.filter((m, i) => i >= debut && i < debut + longueur && porteDuSens(m));
  if (dansLeBloc.length === 0) return false;
  if (dansLeBloc.join('').length < 5) return false;
  return dansLeBloc.length / attendus.length >= 2 / 3;
}

/**
 * feat/forme-courte-de-l-oeuvre — « SNOW WHITE » EST LE NOM DU FILM.
 *
 * Soiree du 18/09 : « snow white » refuse trois fois pour *Snow White and the
 * Seven Dwarfs*. Personne ne dit le titre complet d un film a rallonge — on
 * dit *Star Wars*, pas *Star Wars: A New Hope*, et *Blanche-Neige*, pas
 * *Blanche-Neige et les sept nains*.
 *
 * La regle de titre partiel existante ne couvrait pas ce cas : elle exige les
 * deux tiers des mots ET que l artiste soit reconnu. En mode « devine l
 * oeuvre », l artiste est le compositeur du generique : aucun joueur ne le
 * dit. La forme courte n etait donc jamais rattrapable.
 *
 * On ne prend pas n importe quel debut de titre : seulement la TETE, c est a
 * dire ce qui precede un sous-titre (« : », « - ») ou un developpement
 * (« and the », « et les »). *Snow White* and the Seven Dwarfs, *Star Wars*:
 * A New Hope, *Le Seigneur des anneaux* : la Communaute de l anneau. Un debut
 * arbitraire comme « another one » pour *Another One Bites the Dust* ne passe
 * pas : il n y a pas de coupure.
 *
 * Et l appelant verifie que cette tete ne designe pas AUSSI une autre oeuvre
 * de la manche — sinon « Star Wars » vaudrait n importe lequel des episodes.
 */
const COUPURES_OEUVRE = /\s*(?::|\s[–—-]\s|\set\sles?\s|\set\sla\s|\sand\sthe\s|\sand\sa\s|,\s)/iu;

/**
 * Tete d un titre d oeuvre : ce qui precede le sous-titre ou le developpement.
 * `null` si le titre n a pas de coupure, ou si la tete est trop courte pour
 * designer quoi que ce soit.
 */
export function teteDeLOeuvre(titre: string): string | null {
  if (!titre) return null;
  const m = COUPURES_OEUVRE.exec(titre);
  if (!m || m.index <= 0) return null;
  const tete = titre.slice(0, m.index).trim();
  // Il doit rester quelque chose a deviner APRES la coupure, sinon ce n est
  // pas une forme courte, c est le titre entier.
  if (titre.slice(m.index + m[0].length).trim().length === 0) return null;
  // Une tete d une lettre ou faite uniquement de mots-outils ne prouve rien.
  const normalisee = normalizeText(tete);
  if (normalisee.replace(/[^\p{L}\p{N}]/gu, '').length < 4) return null;
  return tete;
}

/**
 * Le transcript donne-t-il la forme courte de cette oeuvre ?
 * Reserve aux morceaux joues en mode « devine l oeuvre » — l appelant le
 * verifie avec `track.work_title`.
 */
export function donneLaFormeCourte(transcript: string, titreOeuvre: string, seuil = 80): boolean {
  const tete = teteDeLOeuvre(titreOeuvre);
  if (!tete) return false;
  return combinedScore(transcript, tete) >= seuil;
}

/**
 * feat/un-mot-d-ecart — UN MOT DE TRAVERS SUR UN TITRE LONG, C'EST JUSTE.
 *
 * Soirée du 25/09 : « Should I start or should I go » refusé pour *Should I
 * Stay or Should I Go*, « Give Love a Bad Name » pour *You Give Love a Bad
 * Name*, « Can't Get Enough » pour *Just Can't Get Enough*. Le joueur
 * connaît le morceau ; il manque ou il change UN mot sur six.
 *
 * La règle ne vaut que sur les titres d'au moins quatre mots : en dessous,
 * un mot d'écart change le titre (*Beautiful Liar* / *Beautiful Life*,
 * *End of the Road* / *End of World*), et la mesure sur l'historique le
 * confirme. Les mots comparés le sont à la lettre près (ou presque, pour
 * absorber une faute), et l'ordre doit tenir.
 */
export function unSeulMotDEcart(transcript: string, attendu: string): boolean {
  const a = normalizeText(attendu).split(' ').filter(Boolean);
  const t = normalizeText(transcript).split(' ').filter(Boolean);
  if (a.length < 4 || t.length < 3) return false;
  // Trop de mots en plus : le joueur récite autre chose, pas ce titre.
  if (t.length > a.length + 1) return false;

  const memeMot = (x: string, y: string): boolean =>
    x === y || (Math.max(x.length, y.length) >= 5 && levenshteinDistance(x, y) <= 1);

  // Distance d'édition au niveau des MOTS : une substitution, un oubli ou un
  // ajout comptent pour un.
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(t.length + 1);
    cur[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const cout = memeMot(a[i - 1]!, t[j - 1]!) ? 0 : 1;
      cur[j] = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cout);
    }
    prev = cur;
  }
  return prev[t.length]! <= 1;
}

/**
 * feat/faute-de-frappe — CE QUI EST TAPÉ SE TAPE MAL.
 *
 * Soirée du 25/09 : « dirty danxing », « wawing flaag », « sarurday nught
 * fver », « cramberries » — quatre bonnes réponses perdues pour une touche à
 * côté. Au clavier, l'erreur est une LETTRE, pas un son : le score phonétique
 * (40 % de la note) fait chuter la note alors que le mot est presque exact.
 *
 * On compare donc, pour les réponses tapées seulement, la suite de lettres
 * brute. Il faut une réponse d'une longueur suffisante — sinon « flag » vaut
 * *Wavin' Flag* — et une ressemblance très haute, qui ne laisse passer que
 * la faute de frappe.
 */
export function ressembleAUneFauteDeFrappe(transcript: string, attendu: string): boolean {
  const a = normalizeText(attendu).split(' ').filter(Boolean);
  const t = normalizeText(transcript).split(' ').filter(Boolean);
  if (a.length === 0 || t.length === 0) return false;
  // Il faut TOUT le titre : « flag » n'est pas une faute de frappe de
  // *Wavin' Flag*, c'est un morceau de réponse.
  if (t.length < a.length || t.length > a.length + 1) return false;
  const lettres = a.join('');
  if (lettres.length < 8) return false;

  /** Ce qu'on pardonne sur un mot : une touche, deux sur un mot long. */
  const pardon = (mot: string): number => (mot.length <= 4 ? 1 : 2);

  let total = 0;
  let j = 0;
  for (const mot of a) {
    // Le mot correspondant peut être décalé d'un cran (un mot en trop).
    let trouve = -1;
    for (let k = j; k < Math.min(j + 2, t.length); k++) {
      if (levenshteinDistance(mot, t[k]!) <= pardon(mot)) {
        trouve = k;
        break;
      }
    }
    if (trouve < 0) return false;
    total += levenshteinDistance(mot, t[trouve]!);
    j = trouve + 1;
  }
  // Trois lettres de travers au total : au-delà, ce n'est plus une faute de
  // frappe, c'est une autre réponse.
  return total <= 3;
}

/** Ce que le transcript a permis de reconnaître. */
export type MatchTarget = 'title' | 'artist' | 'artist_title';

export interface MatchResult {
  /** Score combiné meilleur match (0-100). */
  score: number;
  /** Cible matchée : titre seul, artiste seul, ou les deux. */
  target: MatchTarget;
  /** Détail des scores pour debug / UI tooltip. */
  scores: {
    title_combined: number;
    title_lev: number;
    title_phon: number;
    artist_combined: number;
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
  /** Seuil de reconnaissance d une moitie (defaut = celui du serveur). */
  seuil = 80,
  /** La réponse a été TAPÉE : on tolère alors la faute de frappe. */
  options: { clavier?: boolean } = {},
): MatchResult {
  const titleLev = levenshteinScore(transcript, expected.title);
  const titlePhon = phoneticScore(transcript, expected.title);
  let titleCombined = combinedScore(transcript, expected.title);
  // Un seul mot d'écart sur un titre long, et la faute de frappe au clavier :
  // deux façons de dire juste que la note brute punissait.
  if (titleCombined < seuil && unSeulMotDEcart(transcript, expected.title)) {
    titleCombined = Math.max(titleCombined, seuil + 10);
  }
  if (
    titleCombined < seuil &&
    options.clavier &&
    ressembleAUneFauteDeFrappe(transcript, expected.title)
  ) {
    titleCombined = Math.max(titleCombined, seuil + 10);
  }

  const combo = `${expected.artist} ${expected.title}`;
  const comboLev = levenshteinScore(transcript, combo);
  const comboPhon = phoneticScore(transcript, combo);
  const comboCombined = combinedScore(transcript, combo);

  // fix/artiste-seul-jamais-reconnu — LE NOM DE L ARTISTE SEUL N ETAIT COMPARE
  // A RIEN.
  //
  // Ce moteur ne testait que « le titre » et « artiste + titre ». Un joueur qui
  // dit seulement « Adele » ne pouvait donc MATHEMATIQUEMENT pas marquer : son
  // transcript etait compare a « Make You Feel My Love » et a « Adele Make You
  // Feel My Love », deux scores tres bas. Soiree du 10/09 : 99 buzz dans ce cas
  // sur 728, dont « Sam Smith », « Usher », « The Weeknd », « Celine Dion »,
  // « Beyonce » — tous refuses.
  //
  // Le defaut etait masque : beaucoup de titres avaient un alias de TITRE egal
  // au nom de l artiste, et dire l artiste matchait ce faux alias de titre. Le
  // nettoyage de ces alias (9d49479), fait pour que les points titre/chanteur
  // soient justes, a retire la bequille et rendu le trou visible.
  //
  // La regle du jeu (gameScoring.ts) est pourtant explicite : artiste OU titre
  // trouve -> points de position ; les deux -> bonus double. Ce moteur ne savait
  // pas exprimer « artiste seul ».
  let artistCombined = combinedScore(transcript, expected.artist);
  if (
    artistCombined < seuil &&
    options.clavier &&
    ressembleAUneFauteDeFrappe(transcript, expected.artist)
  ) {
    artistCombined = Math.max(artistCombined, seuil + 10);
  }

  // fix/bonus-double-imerite — LA CIBLE SE DECIDE SUR CHAQUE MOITIE, PAS SUR
  // LE COMBO.
  //
  // L ancienne regle prenait le combo « artiste titre » des qu il egalait le
  // meilleur des deux. Or le score de proximite ignore les mots en trop : pour
  // « Yeah! » de Usher, le joueur qui dit seulement « usher » obtient 100 sur
  // l artiste ET 100 sur le combo « Usher Yeah! ». Egalite -> combo -> bonus
  // double alors qu il n a jamais dit le titre. Six buzz dans ce cas rien que
  // sur ce titre le 10/09.
  //
  // La regle du jeu se lit moitie par moitie : le joueur a-t-il dit l artiste ?
  // a-t-il dit le titre ? On teste donc chaque moitie SEPAREMENT contre le
  // seuil. Consequence utile : l ordre n a plus aucune importance — « Usher
  // Yeah », « Yeah Usher », ou l un puis l autre apres une hesitation donnent
  // le meme resultat, alors que le combo imposait implicitement « artiste puis
  // titre ».
  //
  // Le combo ne sert plus qu au repechage : quand aucune moitie ne passe seule
  // mais que l ensemble ressemble (« adele make you feel » tronque), il porte
  // le score.
  const artisteSeulPasse = artistCombined >= seuil;
  const titreSeulPasse = titleCombined >= seuil;
  let target: MatchTarget;
  if (artisteSeulPasse && titreSeulPasse) {
    target = 'artist_title';
  } else if (artisteSeulPasse) {
    target = 'artist';
  } else if (titreSeulPasse) {
    target = 'title';
  } else {
    // Aucune moitie ne passe seule : on retombe sur le meilleur des trois.
    target =
      comboCombined >= titleCombined && comboCombined >= artistCombined
        ? 'artist_title'
        : artistCombined > titleCombined
          ? 'artist'
          : 'title';
  }
  const score = Math.max(titleCombined, comboCombined, artistCombined);

  return {
    score,
    target,
    scores: {
      title_combined: titleCombined,
      title_lev: titleLev,
      title_phon: titlePhon,
      artist_combined: artistCombined,
      artist_title_combined: comboCombined,
      artist_title_lev: comboLev,
      artist_title_phon: comboPhon,
    },
  };
}
