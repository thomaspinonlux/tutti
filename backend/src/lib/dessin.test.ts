import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setActiveQuestion, getActiveQuestion } from './gameStateQuizz.js';
import {
  ajouterTrait,
  annulerTrait,
  bilanDessin,
  demarrerDessin,
  effacerDessin,
  etatPublic,
  motPourDessinateur,
  proposer,
} from './dessin.js';

const S = '00000000-0000-0000-0000-00000000d001';

function ouvrir(): void {
  setActiveQuestion(S, {
    question_index: 3,
    question_id: 'q3',
    question_type: 'DRAWING',
    time_limit_ms: 75_000,
    points: 100,
    expected_participants: ['bob', 'cleo'],
  });
  demarrerDessin(S, 3, { answer_lang1: 'chat', answer_aliases_lang1: [] }, { id: 'alice', pseudo: 'Alice' });
}

test('le mot ne va qu’au dessinateur et n’est pas dans l’état public', () => {
  ouvrir();
  assert.equal(motPourDessinateur(S, 'bob'), null);
  assert.deepEqual(motPourDessinateur(S, 'alice'), { question_index: 3, mot: 'chat' });
  assert.ok(!JSON.stringify(etatPublic(S)).includes('chat'));
});

test('seul le dessinateur trace ; nouveau trait puis suite du trait', () => {
  ouvrir();
  assert.equal(ajouterTrait(S, 'bob', { q: 3, i: 0, c: '#000000', w: 10, p: [1, 2] }), false);
  assert.equal(ajouterTrait(S, 'alice', { q: 3, i: 0, c: '#000000', w: 10, p: [1, 2, 3, 4] }), true);
  assert.equal(ajouterTrait(S, 'alice', { q: 3, i: 0, p: [5, 6] }), true);
  assert.equal(ajouterTrait(S, 'alice', { q: 3, i: 5, c: '#000000', w: 10, p: [1, 2] }), false, 'index hors suite');
  assert.equal(ajouterTrait(S, 'alice', { q: 2, i: 1, c: '#000000', w: 10, p: [1, 2] }), false, 'autre question');
  assert.equal(ajouterTrait(S, 'alice', { q: 3, i: 1, c: 'rouge', w: 10, p: [1, 2] }), false, 'couleur invalide');
  assert.equal(ajouterTrait(S, 'alice', { q: 3, i: 1, c: '#FF0000', w: 999, p: [5000, -3] }), true);
  const e = etatPublic(S)!;
  assert.equal(e.traits.length, 2);
  assert.deepEqual(e.traits[0]!.p, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(e.traits[1]!.p, [1000, 0], 'coordonnées bornées');
  assert.equal(e.traits[1]!.w, 60, 'épaisseur bornée');
  assert.equal(annulerTrait(S, 'bob'), false);
  assert.equal(annulerTrait(S, 'alice'), true);
  assert.equal(etatPublic(S)!.traits.length, 1);
  assert.equal(effacerDessin(S, 'alice'), true);
  assert.equal(etatPublic(S)!.traits.length, 0);
});

test('propositions : plusieurs essais, la bonne compte, le dessinateur ne devine pas', async () => {
  ouvrir();
  assert.deepEqual(proposer(S, 'alice', 'Alice', 'chat'), { statut: 'refuse', raison: 'DESSINATEUR' });
  assert.deepEqual(proposer(S, 'bob', 'Bob', 'chien'), { statut: 'rate' });
  assert.deepEqual(proposer(S, 'bob', 'Bob', 'chaton'), { statut: 'refuse', raison: 'TROP_VITE' });
  await new Promise((r) => setTimeout(r, 650));
  assert.deepEqual(proposer(S, 'bob', 'Bob', 'chaton'), { statut: 'proche' });
  await new Promise((r) => setTimeout(r, 650));
  const r = proposer(S, 'bob', 'Bob', 'un chat');
  assert.deepEqual(r, { statut: 'trouve', rang: 1, allAnswered: false });
  assert.equal(getActiveQuestion(S)!.answers.get('bob')!.value, 'chat', 'on enregistre le mot, pas la phrase');
  await new Promise((r2) => setTimeout(r2, 650));
  assert.deepEqual(proposer(S, 'bob', 'Bob', 'chat'), { statut: 'refuse', raison: 'DEJA_TROUVE' });
  const r2 = proposer(S, 'cleo', 'Cléo', 'Chats');
  assert.deepEqual(r2, { statut: 'trouve', rang: 2, allAnswered: true });
  const e = etatPublic(S)!;
  assert.deepEqual(e.propositions, [{ pseudo: 'Bob', texte: 'chien' }], 'seule la fausse proposition est publique');
  assert.deepEqual(bilanDessin(S, 3), { dessinateurId: 'alice', dessinateurPseudo: 'Alice', trouves: 2 });
});

test('après la révélation, plus de trait ni de proposition', () => {
  ouvrir();
  getActiveQuestion(S)!.phase = 'revealed';
  assert.equal(ajouterTrait(S, 'alice', { q: 3, i: 0, c: '#000000', w: 10, p: [1, 2] }), false);
  assert.deepEqual(proposer(S, 'bob', 'Bob', 'chat'), { statut: 'refuse', raison: 'PAS_DE_DESSIN' });
});
