import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculerPrixCents, estSoiree, jourEtHeureLocale } from './tarifs.js';

const R = {
  tarif_horaire_cents: 2000,
  tarif_horaire_soir_cents: 3000,
  heure_soiree_debut: 18,
  jours_soiree: '5,6',
  validation_automatique: true,
};

describe('tarifs', () => {
  it('lit le jour et l’heure au Luxembourg', () => {
    // Vendredi 26 septembre 2026, 20 h 30 heure du Luxembourg (UTC+2).
    const d = new Date('2026-09-25T18:30:00Z');
    assert.deepEqual(jourEtHeureLocale(d), { jour: 5, heure: 20 });
  });

  it('applique le tarif soirée vendredi soir seulement', () => {
    assert.equal(estSoiree(new Date('2026-09-25T18:30:00Z'), R), true); // vendredi 20 h 30
    assert.equal(estSoiree(new Date('2026-09-25T12:00:00Z'), R), false); // vendredi 14 h
    assert.equal(estSoiree(new Date('2026-09-23T19:00:00Z'), R), false); // mercredi 21 h
  });

  it('facture 3 h de semaine au tarif normal', () => {
    const prix = calculerPrixCents(
      new Date('2026-09-23T17:00:00Z'),
      new Date('2026-09-23T20:00:00Z'),
      R,
    );
    assert.equal(prix, 6000);
  });

  it('facture au prorata des minutes', () => {
    const prix = calculerPrixCents(
      new Date('2026-09-23T17:00:00Z'),
      new Date('2026-09-23T18:30:00Z'),
      R,
    );
    assert.equal(prix, 3000);
  });

  it('coupe le créneau à l’heure de la soirée', () => {
    // Vendredi 17 h → 20 h locales : 1 h normale + 2 h soirée.
    const prix = calculerPrixCents(
      new Date('2026-09-25T15:00:00Z'),
      new Date('2026-09-25T18:00:00Z'),
      R,
    );
    assert.equal(prix, 2000 + 6000);
  });

  it('sans tarif fixé, pas de prix automatique', () => {
    const prix = calculerPrixCents(new Date(), new Date(Date.now() + 3600_000), {
      ...R,
      tarif_horaire_cents: 0,
    });
    assert.equal(prix, null);
  });
});
