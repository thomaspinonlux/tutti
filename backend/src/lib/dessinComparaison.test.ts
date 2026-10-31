import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparerProposition, masquerMot } from './dessinComparaison.js';

const mot = (m: string, alias: string[] = []) => ({ answer_lang1: m, answer_aliases_lang1: alias });

test('masquerMot : lettres masquées, espaces / tirets / apostrophes gardés', () => {
  assert.equal(masquerMot('chat'), '____');
  assert.equal(masquerMot('tour Eiffel'), '____ ______');
  assert.equal(masquerMot("arc-en-ciel"), '___-__-____');
  assert.equal(masquerMot("pomme d'api"), "_____ _'___");
  assert.equal(masquerMot('élève'), '_____');
});

test('comparerProposition : le mot exact, sans accents, sans casse', () => {
  assert.equal(comparerProposition(mot('Éléphant'), 'elephant'), 'oui');
  assert.equal(comparerProposition(mot('chat'), 'CHAT'), 'oui');
});

test('comparerProposition : articles et pluriel ignorés', () => {
  assert.equal(comparerProposition(mot('chat'), 'le chat'), 'oui');
  assert.equal(comparerProposition(mot('chat'), 'des chats'), 'oui');
  assert.equal(comparerProposition(mot('avion'), "l'avion"), 'oui');
});

test('comparerProposition : petite faute tolérée sur un mot long', () => {
  assert.equal(comparerProposition(mot('parapluie'), 'parapuie'), 'oui');
  assert.equal(comparerProposition(mot('crocodile'), 'crocodil'), 'oui');
});

test('comparerProposition : le mot noyé dans une phrase compte (pas affiché à la TV)', () => {
  assert.equal(comparerProposition(mot('chat'), "c'est un chat !"), 'oui');
  assert.equal(comparerProposition(mot('tour Eiffel'), 'la tour eiffel à paris'), 'oui');
});

test('comparerProposition : les alias comptent', () => {
  assert.equal(comparerProposition(mot('vélo', ['bicyclette']), 'bicyclette'), 'oui');
});

test('comparerProposition : ligatures', () => {
  assert.equal(comparerProposition(mot('œuf'), 'oeuf'), 'oui');
});

test('comparerProposition : proche mais faux → « proche »', () => {
  assert.equal(comparerProposition(mot('chaton'), 'chat'), 'proche');
});

test('comparerProposition : faux → « non »', () => {
  assert.equal(comparerProposition(mot('chat'), 'chien'), 'non');
  assert.equal(comparerProposition(mot('soleil'), 'lune'), 'non');
  assert.equal(comparerProposition(mot('chat'), ''), 'non');
});
