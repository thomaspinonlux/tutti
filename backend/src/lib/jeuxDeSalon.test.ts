import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bilanBac, lireGrille, reponseValable, tirerLettre } from './petitBac.js';
// ecrireVoter diffuse par le socket, qui charge le client Supabase : il exige
// ses variables d'environnement. Valeurs factices, aucun appel réseau ici.
process.env.SUPABASE_URL ??= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test';
const { bilanEcrireVoter, demarrerEcriture, ecrire, passerAuVote, voter, etatPublicEcrireVoter, mesChoix } =
  await import('./ecrireVoter.js');

test("P'tit Bac : lettre, accents, articles, longueur", () => {
  assert.equal(reponseValable('Éléphant', 'E'), 'elephant');
  assert.equal(reponseValable("l'Espagne", 'E'), 'espagne');
  assert.equal(reponseValable('Lion', 'E'), '');
  assert.equal(reponseValable('E', 'E'), '');
  assert.equal(reponseValable('', 'E'), '');
});

test("P'tit Bac : unique 20, partagé 10, faux 0", () => {
  const d = bilanBac('B', ['Prénom', 'Pays'], [
    { participant_id: 'a', pseudo: 'A', valeur: JSON.stringify(['Bruno', 'Belgique']) },
    { participant_id: 'b', pseudo: 'B', valeur: JSON.stringify(['Benoît', 'belgique']) },
    { participant_id: 'c', pseudo: 'C', valeur: JSON.stringify(['Paul', '']) },
  ]);
  const a = d.lignes.find((l) => l.participant_id === 'a')!;
  const c = d.lignes.find((l) => l.participant_id === 'c')!;
  assert.deepEqual(a.reponses.map((r) => r.points), [20, 10]);
  assert.equal(a.total, 30);
  assert.equal(c.total, 0);
  assert.equal(d.lignes[0]!.participant_id, 'a', 'trié par total');
});

test("P'tit Bac : grille illisible → cases vides", () => {
  assert.deepEqual(lireGrille('pas du json', 2), ['', '']);
  assert.deepEqual(lireGrille(JSON.stringify(['x', 3]), 3), ['x', '', '']);
});

test("P'tit Bac : pas deux fois la même lettre avant d'avoir tout tiré", () => {
  const vues = new Set<string>();
  for (let i = 0; i < 19; i++) vues.add(tirerLettre('s-bac', i));
  assert.equal(vues.size, 19);
});

test('Bluff : mensonges, vérité, votes, points', () => {
  const S = 's-bluff';
  demarrerEcriture(S, 0, 'BLUFF', { answer_lang1: 'Canberra', answer_aliases_lang1: [] }, ['a', 'b', 'c']);
  assert.deepEqual(ecrire(S, 'a', 'A', 'canberra'), { statut: 'refuse', raison: 'C_EST_LA_VERITE' });
  assert.deepEqual(ecrire(S, 'a', 'A', 'Sydney'), { statut: 'ok', tousOntEcrit: false });
  assert.deepEqual(ecrire(S, 'b', 'B', 'sydney'), { statut: 'ok', tousOntEcrit: false });
  assert.deepEqual(ecrire(S, 'c', 'C', 'Melbourne'), { statut: 'ok', tousOntEcrit: true });
  assert.equal(passerAuVote(S), true);
  const pub = etatPublicEcrireVoter(S)!;
  assert.equal(pub.choix.length, 3, 'Sydney fusionné + Melbourne + vérité');
  assert.ok(!JSON.stringify(pub).includes('auteurs'), 'auteurs cachés pendant le vote');
  const idDe = (t: string) => pub.choix.find((c) => c.texte.toLowerCase() === t.toLowerCase())!.id;
  assert.deepEqual(voter(S, 'a', 'A', idDe('Sydney')), { statut: 'refuse', raison: 'SON_PROPRE_CHOIX' });
  assert.deepEqual(mesChoix(S, 'b'), [idDe('Sydney')]);
  voter(S, 'a', 'A', idDe('Canberra'));
  voter(S, 'b', 'B', idDe('Melbourne'));
  const r = voter(S, 'c', 'C', idDe('Sydney'));
  assert.deepEqual(r, { statut: 'ok', tousOntVote: true });
  const bilan = bilanEcrireVoter(S, 0)!;
  assert.equal(bilan.scores.get('a')!.score, 100 + 50, 'vérité + a piégé C');
  assert.equal(bilan.scores.get('b')!.score, 50, 'a piégé C (mensonge partagé)');
  assert.equal(bilan.scores.get('c')!.score, 50, 'a piégé B');
  const v = bilan.details.choix.find((c) => c.verite)!;
  assert.deepEqual(v.votants, ['A']);
});

test('Réponse drôle : votes et bonus unanime', () => {
  const S = 's-funny';
  demarrerEcriture(S, 1, 'FUNNY', null, ['a', 'b', 'c']);
  ecrire(S, 'a', 'A', 'blague A');
  ecrire(S, 'b', 'B', 'blague B');
  ecrire(S, 'c', 'C', 'blague C');
  passerAuVote(S);
  const pub = etatPublicEcrireVoter(S)!;
  const idA = pub.choix.find((c) => c.texte === 'blague A')!.id;
  const idB = pub.choix.find((c) => c.texte === 'blague B')!.id;
  voter(S, 'b', 'B', idA);
  voter(S, 'c', 'C', idA);
  voter(S, 'a', 'A', idB);
  const bilan = bilanEcrireVoter(S, 1)!;
  assert.equal(bilan.scores.get('a')!.score, 100, '2 votes');
  assert.equal(bilan.scores.get('b')!.score, 50);
  assert.equal(bilan.scores.get('c')!.score, 0);
});

test('Réponse drôle : un seul texte → pas de vote', () => {
  const S = 's-seul';
  demarrerEcriture(S, 2, 'FUNNY', null, ['a', 'b']);
  ecrire(S, 'a', 'A', 'seul');
  assert.equal(passerAuVote(S), false);
});
