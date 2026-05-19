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
  normalizeText,
  levenshteinScore,
  phoneticScore,
  combinedScore,
  matchAnswer,
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

  it('gère apostrophes typographiques (l’ d’)', () => {
    assert.equal(normalizeText("L'été indien"), 'ete indien');
    assert.equal(normalizeText('l’ami'), 'ami');
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

  it('chaînes vides → 100', () => {
    assert.equal(levenshteinScore('', ''), 100);
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
