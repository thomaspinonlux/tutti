/**
 * Tests du parsing LRC et du FILTRE QUALITÉ.
 *
 * Ce filtre est la garantie produit « paroles propres uniquement » : chaque
 * raison de rejet a son test, plus un cas nominal.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLrc, evaluateLrc } from './lrc.js';

/** LRC valide de 10 lignes sur un morceau de 200 s. */
const GOOD_LRC = [
  '[ar:Un Artiste]',
  '[ti:Un Titre]',
  '[00:10.00]Première ligne',
  '[00:20.50]Deuxième ligne',
  '[00:30.00]Troisième ligne',
  '[00:40.00]Quatrième ligne',
  '[00:50.00]Cinquième ligne',
  '[01:00.00]Sixième ligne',
  '[01:10.00]Septième ligne',
  '[01:20.00]Huitième ligne',
  '[01:30.00]Neuvième ligne',
  '[01:40.00]Dixième ligne',
].join('\n');

const DURATION_MS = 200_000;

describe('parseLrc', () => {
  it('extrait les lignes horodatées et ignore les tags de métadonnées', () => {
    const lines = parseLrc(GOOD_LRC);
    assert.equal(lines.length, 10);
    assert.equal(lines[0]?.t_ms, 10_000);
    assert.equal(lines[0]?.text, 'Première ligne');
    // Aucun tag [ar:]/[ti:] ne doit ressortir comme parole.
    assert.ok(!lines.some((l) => l.text.includes('Un Artiste')));
  });

  it('gère plusieurs timestamps sur une même ligne (refrain répété)', () => {
    const lines = parseLrc('[00:12.00][01:04.00]Refrain');
    assert.equal(lines.length, 2);
    assert.deepEqual(
      lines.map((l) => l.t_ms),
      [12_000, 64_000],
    );
    assert.ok(lines.every((l) => l.text === 'Refrain'));
  });

  it('trie par temps croissant même si la source est dans le désordre', () => {
    const lines = parseLrc('[00:30.00]C\n[00:10.00]A\n[00:20.00]B');
    assert.deepEqual(
      lines.map((l) => l.text),
      ['A', 'B', 'C'],
    );
  });

  it('gère les fractions à 1, 2 et 3 chiffres', () => {
    const lines = parseLrc('[00:01.5]a\n[00:02.25]b\n[00:03.125]c');
    assert.deepEqual(
      lines.map((l) => l.t_ms),
      [1500, 2250, 3125],
    );
  });

  it('conserve les lignes vides horodatées (interludes)', () => {
    const lines = parseLrc('[00:10.00]Chant\n[00:20.00]');
    assert.equal(lines.length, 2);
    assert.equal(lines[1]?.text, '');
  });

  it('renvoie un tableau vide sur une entrée vide ou sans timestamp', () => {
    assert.deepEqual(parseLrc(''), []);
    assert.deepEqual(parseLrc('juste du texte sans timestamp'), []);
  });
});

describe('evaluateLrc', () => {
  it('accepte un LRC propre', () => {
    const r = evaluateLrc(GOOD_LRC, DURATION_MS);
    assert.equal(r.ok, true);
    assert.equal(r.lineCount, 10);
    assert.equal(r.reason, undefined);
  });

  it('rejette too_few_lines (< 8 lignes chantées)', () => {
    const lrc = ['[00:10.00]une', '[00:20.00]deux', '[00:30.00]trois'].join('\n');
    const r = evaluateLrc(lrc, DURATION_MS);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'too_few_lines');
    assert.equal(r.lineCount, 3);
  });

  it('rejette non_monotonic (timestamps décroissants dans la source)', () => {
    const lines = [];
    for (let i = 0; i < 10; i += 1)
      lines.push(`[00:${String(10 + i).padStart(2, '0')}.00]ligne ${i}`);
    // Insère une régression temporelle au milieu.
    lines.splice(5, 0, '[00:02.00]retour en arrière');
    const r = evaluateLrc(lines.join('\n'), DURATION_MS);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'non_monotonic');
  });

  it('rejette out_of_range quand la 1re parole arrive après 50 % du morceau', () => {
    // Morceau de 60 s, 1re ligne à 40 s (> 30 s) → paroles d'une autre version.
    const lines = [];
    for (let i = 0; i < 10; i += 1)
      lines.push(`[00:${String(40 + i).padStart(2, '0')}.00]ligne ${i}`);
    const r = evaluateLrc(lines.join('\n'), 60_000);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'out_of_range');
  });

  it('rejette out_of_range quand la fin dépasse la durée + 3 s', () => {
    const lines = [];
    for (let i = 0; i < 9; i += 1)
      lines.push(`[00:${String(10 + i).padStart(2, '0')}.00]ligne ${i}`);
    lines.push('[02:00.00]bien après la fin');
    // Morceau de 60 s → dernière ligne à 120 s.
    const r = evaluateLrc(lines.join('\n'), 60_000);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'out_of_range');
  });

  it('tolère un léger dépassement (≤ 3 s) en fin de morceau', () => {
    const lines = [];
    for (let i = 0; i < 9; i += 1)
      lines.push(`[00:${String(10 + i).padStart(2, '0')}.00]ligne ${i}`);
    lines.push('[01:01.00]dernière');
    // Morceau de 60 s, dernière ligne à 61 s → dans la tolérance.
    const r = evaluateLrc(lines.join('\n'), 60_000);
    assert.equal(r.ok, true);
  });

  it('rejette plain_only en présence de HTML', () => {
    const lrc = GOOD_LRC.replace('Première ligne', 'Première <b>ligne</b>');
    const r = evaluateLrc(lrc, DURATION_MS);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'plain_only');
  });

  it('rejette plain_only si une ligne dépasse 200 caractères', () => {
    const lrc = GOOD_LRC.replace('Première ligne', 'x'.repeat(201));
    const r = evaluateLrc(lrc, DURATION_MS);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'plain_only');
  });

  it('ne teste pas les bornes temporelles si la durée est inconnue (0)', () => {
    const r = evaluateLrc(GOOD_LRC, 0);
    assert.equal(r.ok, true);
  });
});
