/**
 * Tests du client LRCLIB avec `fetch` mocké.
 *
 * Le point critique testé ici : le garde-fou de DURÉE. Un LRC synchronisé dont
 * la durée s'écarte de plus de 2 s de la version Apple ne doit JAMAIS être
 * retenu — c'est ce qui évite d'afficher les paroles d'un remix ou d'un live
 * par-dessus la version studio.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchSyncedLyrics } from './lrclibClient.js';

const realFetch = globalThis.fetch;

/** Installe un faux fetch qui route sur /get puis /search. */
function mockFetch(handlers: {
  get?: () => { status: number; body?: unknown };
  search?: () => { status: number; body?: unknown };
}): void {
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    const which = url.includes('/api/get') ? handlers.get : handlers.search;
    const res = which?.() ?? { status: 404 };
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: async () => res.body,
      text: async () => JSON.stringify(res.body ?? ''),
    } as Response;
  }) as typeof globalThis.fetch;
}

const SYNCED = ['[00:10.00]une', '[00:20.00]deux', '[00:30.00]trois'].join('\n');
const INPUT = {
  artist: 'O-Zone',
  title: 'Dragostea Din Tei',
  album: 'DiscO-Zone',
  durationMs: 215_000,
};

describe('fetchSyncedLyrics', () => {
  beforeEach(() => mockFetch({}));
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('retourne found quand /get répond 200 avec syncedLyrics', async () => {
    mockFetch({
      get: () => ({ status: 200, body: { id: 42, duration: 215, syncedLyrics: SYNCED } }),
    });
    const r = await fetchSyncedLyrics(INPUT);
    assert.equal(r.status, 'found');
    assert.equal(r.lrc, SYNCED);
    assert.equal(r.sourceId, 42);
    assert.equal(r.sourceDurationMs, 215_000);
  });

  it('retourne instrumental quand LRCLIB marque le morceau instrumental', async () => {
    mockFetch({ get: () => ({ status: 200, body: { id: 7, instrumental: true } }) });
    const r = await fetchSyncedLyrics(INPUT);
    assert.equal(r.status, 'instrumental');
    assert.equal(r.lrc, null);
  });

  it('retourne plain_only quand seules des paroles non synchronisées existent', async () => {
    mockFetch({
      get: () => ({ status: 200, body: { id: 9, plainLyrics: 'des paroles', syncedLyrics: null } }),
    });
    const r = await fetchSyncedLyrics(INPUT);
    assert.equal(r.status, 'plain_only');
    assert.equal(r.lrc, null);
  });

  it('bascule sur /search en 404 et ACCEPTE un écart de durée de 1 s', async () => {
    mockFetch({
      get: () => ({ status: 404 }),
      search: () => ({
        status: 200,
        body: [{ id: 100, duration: 216, syncedLyrics: SYNCED }], // 216 s vs 215 s → 1 s
      }),
    });
    const r = await fetchSyncedLyrics(INPUT);
    assert.equal(r.status, 'found');
    assert.equal(r.sourceId, 100);
  });

  it('REFUSE un écart de durée de 5 s → other_version', async () => {
    mockFetch({
      get: () => ({ status: 404 }),
      search: () => ({
        status: 200,
        body: [{ id: 101, duration: 220, syncedLyrics: SYNCED }], // 220 s vs 215 s → 5 s
      }),
    });
    const r = await fetchSyncedLyrics(INPUT);
    assert.equal(r.status, 'other_version');
    assert.equal(r.lrc, null);
  });

  it('choisit, à durée valable, le candidat avec le plus de lignes', async () => {
    const court = '[00:10.00]une\n[00:20.00]deux';
    const long = '[00:10.00]une\n[00:20.00]deux\n[00:30.00]trois\n[00:40.00]quatre';
    mockFetch({
      get: () => ({ status: 404 }),
      search: () => ({
        status: 200,
        body: [
          { id: 1, duration: 215, syncedLyrics: court },
          { id: 2, duration: 216, syncedLyrics: long },
        ],
      }),
    });
    const r = await fetchSyncedLyrics(INPUT);
    assert.equal(r.status, 'found');
    assert.equal(r.sourceId, 2);
  });

  it('retourne none quand /search ne renvoie aucun résultat', async () => {
    mockFetch({ get: () => ({ status: 404 }), search: () => ({ status: 200, body: [] }) });
    const r = await fetchSyncedLyrics(INPUT);
    assert.equal(r.status, 'none');
  });

  it('retourne plain_only si /search ne contient que du texte non synchronisé', async () => {
    mockFetch({
      get: () => ({ status: 404 }),
      search: () => ({ status: 200, body: [{ id: 5, duration: 215, plainLyrics: 'texte' }] }),
    });
    const r = await fetchSyncedLyrics(INPUT);
    assert.equal(r.status, 'plain_only');
  });

  it('retourne fetch_error si le réseau échoue (après retries)', async () => {
    globalThis.fetch = (async () => {
      throw new Error('réseau indisponible');
    }) as typeof globalThis.fetch;
    const r = await fetchSyncedLyrics(INPUT);
    assert.equal(r.status, 'fetch_error');
    assert.ok(r.error);
  });
});
