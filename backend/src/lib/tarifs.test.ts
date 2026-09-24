import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculerDevis, calculerPrixCents, estSoiree, jourEtHeureLocale } from './tarifs.js';

const R = {
  tarif_horaire_cents: 2000,
  tarif_horaire_soir_cents: 3000,
  heure_soiree_debut: 18,
  jours_soiree: '5,6',
  validation_automatique: true,
  tarif_horaire_propre_cents: 1200,
  tarif_horaire_propre_soir_cents: 1800,
  validation_auto_comptes: false,
  reduction_pct: 0,
  reduction_libelle: '',
  reduction_fin: null,
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

  it('applique la grille réduite au client qui a son compte', () => {
    const prix = calculerPrixCents(
      new Date('2026-09-23T17:00:00Z'),
      new Date('2026-09-23T20:00:00Z'),
      R,
      { compteClient: true },
    );
    assert.equal(prix, 3600); // 3 h × 12 €
  });

  it('grille réduite non fixée → grille normale', () => {
    const prix = calculerPrixCents(
      new Date('2026-09-23T17:00:00Z'),
      new Date('2026-09-23T20:00:00Z'),
      { ...R, tarif_horaire_propre_cents: 0 },
      { compteClient: true },
    );
    assert.equal(prix, 6000);
  });

  it('applique l’offre de lancement et garde le prix plein visible', () => {
    const devis = calculerDevis(
      new Date('2026-09-23T17:00:00Z'),
      new Date('2026-09-23T20:00:00Z'),
      { ...R, reduction_pct: 50, reduction_libelle: 'Offre de lancement' },
    );
    assert.equal(devis?.prix_plein_cents, 6000);
    assert.equal(devis?.prix_cents, 3000);
    assert.equal(devis?.reduction_libelle, 'Offre de lancement');
  });

  it('ignore une offre terminée', () => {
    const devis = calculerDevis(
      new Date('2026-09-23T17:00:00Z'),
      new Date('2026-09-23T20:00:00Z'),
      {
        ...R,
        reduction_pct: 50,
        reduction_libelle: 'Offre de lancement',
        reduction_fin: new Date('2026-09-01T00:00:00Z'),
      },
      { maintenant: new Date('2026-09-23T10:00:00Z') },
    );
    assert.equal(devis?.prix_cents, 6000);
    assert.equal(devis?.reduction_pct, 0);
  });

  it('cumule remise et grille réduite du client avec son compte', () => {
    const prix = calculerPrixCents(
      new Date('2026-09-23T17:00:00Z'),
      new Date('2026-09-23T20:00:00Z'),
      { ...R, reduction_pct: 25 },
      { compteClient: true },
    );
    assert.equal(prix, 2700); // 3 h × 12 € − 25 %
  });
});
