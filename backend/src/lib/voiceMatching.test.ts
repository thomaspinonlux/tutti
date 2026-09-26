/**
 * voiceMatching.test.ts — feat/voice-fuzzy-matching-backend
 *
 * Tests unitaires via le runner natif `node:test` (zero new dep). Lancer :
 *   pnpm --filter @tutti/backend run test
 *
 * Couvre les 4 cas critiques de la spec PO + tests de normalisation et de
 * matchAnswer combiné title/artist.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  combinedScore,
  donneLaFormeCourte,
  levenshteinScore,
  matchAnswer,
  normalizeText,
  phoneticScore,
  ressembleAUneFauteDeFrappe,
  teteDeLOeuvre,
  unSeulMotDEcart,
} from './voiceMatching.js';

// ───── normalizeText ──────────────────────────────────────────────────────

describe('normalizeText', () => {
  it('lowercase et retire accents', () => {
    assert.equal(normalizeText('CAFÉ Crème'), 'cafe creme');
  });

  it('retire ponctuation', () => {
    assert.equal(normalizeText('Like a Prayer!!'), 'like prayer');
  });

  it('retire stopwords FR (le/la/les/un/une/des/de/du)', () => {
    assert.equal(normalizeText('Le chat de la voisine'), 'chat voisine');
  });

  it('retire stopwords EN (the/a/an)', () => {
    assert.equal(normalizeText('The Beatles'), 'beatles');
  });

  // fix/elision-collee — l elision est SOUDEE au mot, plus jetee. Avant,
  // « L'été indien » donnait « ete indien » mais la transcription collee
  // « lété indien » donnait « lete indien » : 55 %, refuse. Les trois
  // graphies convergent desormais.
  it("soude l elision quelle que soit sa graphie (l’ l' l␣ collé)", () => {
    assert.equal(normalizeText("L'été indien"), 'lete indien');
    assert.equal(normalizeText('l’été indien'), 'lete indien');
    assert.equal(normalizeText('l été indien'), 'lete indien');
    assert.equal(normalizeText('lété indien'), 'lete indien');
    assert.equal(normalizeText("c'est bon"), 'cest bon');
    assert.equal(normalizeText('c est bon'), 'cest bon');
  });

  it('chaîne vide → vide', () => {
    assert.equal(normalizeText(''), '');
  });
});

// ───── Cas critiques de la spec PO ────────────────────────────────────────

describe('Cas critiques spec PO', () => {
  it('Cas 1 : "like a prayer" vs "Like a Prayer" → 100%', () => {
    const score = combinedScore('like a prayer', 'Like a Prayer');
    assert.equal(score, 100, `attendu 100, reçu ${score}`);
  });

  it('Cas 2 : "laïk a préyeur" vs "Like a Prayer" → ≥70% (phonetic save)', () => {
    const score = combinedScore('laïk a préyeur', 'Like a Prayer');
    assert.ok(score >= 70, `attendu ≥70, reçu ${score}`);
  });

  it('Cas 3 : "bohemian rapsodi" vs "Bohemian Rhapsody" → ≥85% (Levenshtein)', () => {
    const score = combinedScore('bohemian rapsodi', 'Bohemian Rhapsody');
    assert.ok(score >= 85, `attendu ≥85, reçu ${score}`);
  });

  it('Cas 4 : "yo banane" vs "Like a Prayer" → <10%', () => {
    const score = combinedScore('yo banane', 'Like a Prayer');
    assert.ok(score < 10, `attendu <10, reçu ${score}`);
  });
});

// ───── levenshteinScore détaillé ──────────────────────────────────────────

describe('levenshteinScore', () => {
  it('identité = 100', () => {
    assert.equal(levenshteinScore('hello', 'hello'), 100);
  });

  it('insensible casse + accents (via normalize)', () => {
    assert.equal(levenshteinScore('Hello', 'héllo'), 100);
  });

  it('1 typo sur 8 chars ≈ 87%', () => {
    const score = levenshteinScore('madonna', 'madonan');
    assert.ok(score >= 70 && score <= 90, `attendu 70-90, reçu ${score}`);
  });

  // fix/points-sans-rien-dire — DEUX CHAÎNES VIDES NE VALENT PLUS 100.
  // Un joueur qui buzzait sans rien dire, ou dont la reconnaissance tombait en
  // panne, obtenait une correspondance parfaite dès que le titre se réduisait à
  // rien après normalisation. Le test attendait l'ancien comportement.
  it('chaînes vides → 0 (aucune parole ne vaut jamais une bonne réponse)', () => {
    assert.equal(levenshteinScore('', ''), 0);
  });

  it('une vide / une non-vide → 0', () => {
    assert.equal(levenshteinScore('', 'hello'), 0);
    assert.equal(levenshteinScore('hello', ''), 0);
  });
});

// ───── phoneticScore détaillé ─────────────────────────────────────────────

describe('phoneticScore', () => {
  it('mots homophones EN → 100', () => {
    // "night" et "knight" partagent le code metaphone "NT"
    assert.equal(phoneticScore('night', 'knight'), 100);
  });

  it('approximation phonétique FR ≈ EN', () => {
    // "préyeur" et "prayer" → metaphones similaires (PRR / PR)
    const score = phoneticScore('préyeur', 'prayer');
    assert.ok(score >= 50, `attendu ≥50, reçu ${score}`);
  });

  it('mots totalement différents → 0', () => {
    assert.equal(phoneticScore('chat', 'piano'), 0);
  });
});

// ───── matchAnswer (title + artist combo) ────────────────────────────────

describe('matchAnswer', () => {
  // fix/artiste-seul-jamais-reconnu — non regression. Ces cas viennent de la
  // soiree du 10/09 : le joueur nomme l artiste et RIEN d autre. L ancienne
  // regle ne comparait qu au titre et au combo « artiste titre » : elle rendait
  // 0 et le joueur ne marquait pas.
  it('reconnait l artiste seul (Adele)', () => {
    const r = matchAnswer('adele', { title: 'Make You Feel My Love', artist: 'Adele' });
    assert.equal(r.target, 'artist');
    assert.ok(r.score >= 80, `score ${r.score} < 80`);
  });

  it('reconnait l artiste seul dans une phrase (Sam Smith)', () => {
    const r = matchAnswer('euh attends sam smith', { title: 'Stay With Me', artist: 'Sam Smith' });
    assert.equal(r.target, 'artist');
    assert.ok(r.score >= 80, `score ${r.score} < 80`);
  });

  it('prefere toujours le combo quand les deux sont dits', () => {
    const r = matchAnswer('adele make you feel my love', {
      title: 'Make You Feel My Love',
      artist: 'Adele',
    });
    assert.equal(r.target, 'artist_title');
  });

  it('ne reconnait pas un artiste qui n a rien a voir', () => {
    const r = matchAnswer('yo banane', { title: 'Stay With Me', artist: 'Sam Smith' });
    assert.ok(r.score < 80, `score ${r.score} >= 80`);
  });

  it('match sur le title seul', () => {
    const r = matchAnswer('like a prayer', { title: 'Like a Prayer', artist: 'Madonna' });
    assert.equal(r.target, 'title');
    assert.equal(r.score, 100);
  });

  it('match sur "artist title" combiné', () => {
    const r = matchAnswer('madonna like a prayer', {
      title: 'Like a Prayer',
      artist: 'Madonna',
    });
    assert.equal(r.target, 'artist_title');
    assert.ok(r.score >= 90, `attendu ≥90, reçu ${r.score}`);
  });

  it('score 0 si transcript totalement différent', () => {
    const r = matchAnswer('yo banane', { title: 'Like a Prayer', artist: 'Madonna' });
    assert.ok(r.score < 20, `attendu <20, reçu ${r.score}`);
  });

  it('expose les scores détaillés pour debug UI', () => {
    const r = matchAnswer('madonna like a prayer', {
      title: 'Like a Prayer',
      artist: 'Madonna',
    });
    assert.ok(r.scores.artist_title_combined >= r.scores.title_combined);
    assert.equal(typeof r.scores.title_lev, 'number');
    assert.equal(typeof r.scores.artist_title_phon, 'number');
  });
});

// ───── Les corrections du 19/09, mesurees sur les refus du 18/09 ──────────

describe('les espaces ne font pas une reponse fausse', () => {
  it('accepte « murder on the dance floor » pour Murder on the Dancefloor', () => {
    // Refuse a 77 % le 18/09.
    assert.equal(combinedScore('murder on the dance floor', 'Murder on the Dancefloor'), 100);
  });

  it('accepte « tatayoyo » pour Tata Yoyo', () => {
    // Refuse a 73 % le 18/09.
    assert.equal(combinedScore('tatayoyo', 'Tata Yoyo'), 100);
  });

  it('ne rapproche pas deux reponses reellement differentes', () => {
    assert.ok(combinedScore('mulan', 'Braveheart') < 80);
    assert.ok(combinedScore('coldplay', 'Kaiser Chiefs') < 80);
  });
});

describe('forme courte du titre d une oeuvre', () => {
  it('coupe sur le developpement', () => {
    assert.equal(teteDeLOeuvre('Snow White and the Seven Dwarfs'), 'Snow White');
    assert.equal(teteDeLOeuvre('Blanche-Neige et les sept nains'), 'Blanche-Neige');
  });

  it('coupe sur le sous-titre', () => {
    assert.equal(teteDeLOeuvre('Star Wars: A New Hope'), 'Star Wars');
  });

  it('ne coupe pas un titre sans coupure', () => {
    assert.equal(teteDeLOeuvre('Another One Bites the Dust'), null);
    assert.equal(teteDeLOeuvre('Braveheart'), null);
  });

  it('accepte la forme courte, refuse une autre oeuvre', () => {
    // Refusee trois fois le 18/09.
    assert.ok(donneLaFormeCourte('snow white', 'Snow White and the Seven Dwarfs'));
    assert.ok(!donneLaFormeCourte('alice in wonderland', 'Snow White and the Seven Dwarfs'));
    assert.ok(!donneLaFormeCourte('mulan', 'Snow White and the Seven Dwarfs'));
  });
});

describe('fix/sept-nains — les nombres écrits valent les chiffres', () => {
  it('« 7 nains » vaut « sept nains »', () => {
    assert.equal(normalizeText('les 7 nains'), normalizeText('les sept nains'));
    assert.ok(combinedScore('Blanche neige des 7 nains', 'blanche neige et les sept nains') >= 80);
  });

  it('marche aussi en anglais', () => {
    assert.equal(normalizeText('seven dwarfs'), normalizeText('7 dwarfs'));
  });
});

describe('feat/un-mot-d-ecart — un mot de travers sur un titre long', () => {
  it('rattrape un mot changé', () => {
    assert.ok(unSeulMotDEcart('Should I start or should I go', 'Should I Stay or Should I Go'));
  });

  it('rattrape un mot oublié', () => {
    assert.ok(unSeulMotDEcart('Give Love A Bad Name', 'You Give Love A Bad Name'));
    assert.ok(unSeulMotDEcart("I Can't Get Enough", "Just Can't Get Enough"));
  });

  it('refuse sur un titre court : un mot y change tout', () => {
    assert.ok(!unSeulMotDEcart('Beautiful Life', 'Beautiful Liar'));
    assert.ok(!unSeulMotDEcart('End of world', 'End of the Road'));
  });

  it('refuse deux mots de travers', () => {
    assert.ok(!unSeulMotDEcart('Should I run or should I stop', 'Should I Stay or Should I Go'));
  });

  it('refuse une récitation plus longue que le titre', () => {
    assert.ok(
      !unSeulMotDEcart(
        'Should I Stay or Should I Go plus deux trois quatre',
        'Should I Stay or Should I Go',
      ),
    );
  });
});

describe('feat/faute-de-frappe — une touche à côté reste une bonne réponse', () => {
  it('accepte la lettre de travers', () => {
    assert.ok(ressembleAUneFauteDeFrappe('dirty danxing', 'Dirty Dancing'));
    assert.ok(ressembleAUneFauteDeFrappe('sarurday nught fver', 'Saturday Night Fever'));
    assert.ok(ressembleAUneFauteDeFrappe('wawing flaag', "Wavin' Flag"));
    assert.ok(ressembleAUneFauteDeFrappe('cramberries', 'The Cranberries'));
  });

  it('refuse un simple fragment du titre', () => {
    assert.ok(!ressembleAUneFauteDeFrappe('flag', "Wavin' Flag"));
    assert.ok(!ressembleAUneFauteDeFrappe('dance', 'La dernière danse'));
  });

  it('refuse un titre trop court pour juger', () => {
    assert.ok(!ressembleAUneFauteDeFrappe('lovy', 'Lovely'));
  });
});
