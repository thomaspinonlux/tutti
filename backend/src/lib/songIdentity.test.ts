import { test } from 'node:test';
import assert from 'node:assert/strict';
import { songTitleKey, artistKeys, SongRegistry, dedupeBySong, type SongInfo } from './songIdentity.js';

test('titre : les éditions sont ignorées', () => {
  assert.equal(songTitleKey('Under Pressure'), 'under pressure');
  assert.equal(songTitleKey('Under Pressure (Remastered 2011)'), 'under pressure');
  assert.equal(songTitleKey('Rock the Night - 2013 Remaster'), 'rock the night');
  assert.equal(songTitleKey('Just Can’t Get Enough [Radio Edit]'), 'just cant get enough');
  assert.equal(songTitleKey("Just Can't Get Enough"), 'just cant get enough');
  assert.equal(songTitleKey('Céline feat. X'), 'celine');
});

test('artistes : chaque crédit compte', () => {
  assert.deepEqual(new Set(artistKeys('Queen & David Bowie')), new Set(['queen', 'david bowie', 'queen and david bowie']));
  assert.ok(artistKeys('The Gibson Brothers').includes('gibson brothers'));
  assert.ok(artistKeys('Earth, Wind & Fire').includes('earth wind and fire'));
});

test('cas du 16/10 : Under Pressure Queen / Queen & David Bowie = même chanson', () => {
  const r = new SongRegistry();
  r.add({ title: 'Under Pressure', artist: 'Queen' });
  assert.equal(r.has({ title: 'Under Pressure', artist: 'Queen & David Bowie' }), true);
});

test('cas du 16/10 : même chanson, autre exemplaire Apple', () => {
  const r = new SongRegistry();
  r.add({ title: "Just Can't Get Enough", artist: 'Depeche Mode' });
  r.add({ title: 'Rock the Night', artist: 'Europe' });
  assert.equal(r.has({ title: 'Just Can’t Get Enough (2006 Remaster)', artist: 'Depeche Mode' }), true);
  assert.equal(r.has({ title: 'Rock The Night', artist: 'Europe' }), true);
});

test('reprise par un autre artiste = chanson différente', () => {
  const r = new SongRegistry();
  r.add({ title: 'Hallelujah', artist: 'Leonard Cohen' });
  assert.equal(r.has({ title: 'Hallelujah', artist: 'Jeff Buckley' }), false);
});

test('dedupeBySong : doublon dans la manche et déjà joué', () => {
  const info = new Map<string, SongInfo>([
    ['a', { title: 'Under Pressure', artist: 'Queen' }],
    ['b', { title: 'Under Pressure', artist: 'Queen & David Bowie' }],
    ['c', { title: 'Let’s Dance', artist: 'David Bowie' }],
    ['d', { title: 'Rock the Night', artist: 'Europe' }],
  ]);
  const deja = new SongRegistry();
  deja.add({ title: 'Rock the Night (Remastered)', artist: 'Europe' });
  assert.deepEqual(dedupeBySong(['a', 'b', 'c', 'd'], info, deja), ['a', 'c']);
});
