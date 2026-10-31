import { test } from 'node:test';
import assert from 'node:assert/strict';
// manette.ts s'enregistre sur le socket, qui charge le client Supabase :
// valeurs factices, aucun appel réseau ici.
process.env.SUPABASE_URL ??= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test';
const { nettoyerCmd, nettoyerAction } = await import('./manette.js');

test('manette : commandes bornées, champs inconnus ignorés', () => {
  assert.deepEqual(nettoyerCmd({ g: true, d: 'oui', x: 5, y: -0.5, pirate: 1 }), { g: true, d: false, x: 1, y: -0.5 });
  assert.deepEqual(nettoyerCmd(null), { g: false, d: false });
  assert.deepEqual(nettoyerCmd({ x: Number.NaN, y: Infinity }), { g: false, d: false });
});

test('manette : actions nettoyées', () => {
  assert.deepEqual(nettoyerAction({ type: 'tap', manche: 2.4, ms: 312.7 }), { type: 'tap', manche: 2, ms: 313 });
  assert.deepEqual(nettoyerAction({ type: '<script>g' }), { type: 'scriptg' });
  assert.equal(nettoyerAction({ type: 42 }), null);
  assert.equal(nettoyerAction({}), null);
  assert.deepEqual(nettoyerAction({ type: 'tap', ms: 999999 }), { type: 'tap', ms: 60000 });
});
