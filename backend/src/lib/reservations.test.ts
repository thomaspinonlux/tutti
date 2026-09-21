import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aDeLaPlace,
  capaciteClients,
  chevauchent,
  creneauOuvert,
  genererCode,
  normaliserCode,
  picSimultane,
  verifierCreneau,
} from './reservations.js';

const h = (heure: number, minute = 0): Date => new Date(Date.UTC(2026, 9, 2, heure, minute));
const iv = (a: number, b: number) => ({ debut: h(a), fin: h(b) });
const reglages = { duree_min_minutes: 60, duree_max_minutes: 360, ouverture_avant_minutes: 30 };

describe('capacité : un compte reste à la brasserie', () => {
  it('3 comptes → 2 parties clients', () => assert.equal(capaciteClients(3), 2));
  it('1 compte → 0 partie client', () => assert.equal(capaciteClients(1), 0));
  it('0 compte → 0, jamais négatif', () => assert.equal(capaciteClients(0), 0));
});

describe('chevauchement', () => {
  it('bord contre bord ne se chevauche pas', () => assert.equal(chevauchent(iv(20, 22), iv(22, 23)), false));
  it('recouvrement partiel se chevauche', () => assert.equal(chevauchent(iv(20, 22), iv(21, 23)), true));
});

describe('pic simultané', () => {
  it('deux créneaux qui touchent la fenêtre sans jamais être ensemble comptent pour 1', () => {
    assert.equal(picSimultane([iv(18, 20), iv(21, 23)], iv(18, 23)), 1);
  });
  it('deux créneaux superposés comptent pour 2', () => {
    assert.equal(picSimultane([iv(19, 22), iv(20, 23)], iv(18, 23)), 2);
  });
  it('fin et début au même instant ne se cumulent pas', () => {
    assert.equal(picSimultane([iv(18, 20), iv(20, 22)], iv(18, 22)), 1);
  });
});

describe('place disponible avec 3 comptes (capacité 2)', () => {
  it('deux créneaux déjà pris en même temps → le troisième est refusé', () => {
    assert.equal(aDeLaPlace([iv(20, 23), iv(20, 23)], iv(21, 22), 2), false);
  });
  it('un seul créneau pris → le second passe', () => {
    assert.equal(aDeLaPlace([iv(20, 23)], iv(21, 22), 2), true);
  });
  it('deux pris mais pas en même temps → un troisième qui chevauche un seul passe', () => {
    assert.equal(aDeLaPlace([iv(18, 20), iv(21, 23)], iv(19, 20), 2), true);
  });
  it('capacité nulle → toujours refusé', () => {
    assert.equal(aDeLaPlace([], iv(20, 22), 0), false);
  });
});

describe('créneau demandé', () => {
  const maintenant = h(12);
  it('valide', () => assert.equal(verifierCreneau(iv(20, 23), reglages, maintenant), null));
  it('fin avant début', () => assert.match(verifierCreneau(iv(22, 20), reglages, maintenant) ?? '', /après/));
  it('dans le passé', () => assert.match(verifierCreneau(iv(8, 10), reglages, maintenant) ?? '', /futur/));
  it('trop court', () => {
    const c = { debut: h(20), fin: h(20, 30) };
    assert.match(verifierCreneau(c, reglages, maintenant) ?? '', /minimum/);
  });
  it('trop long', () => assert.match(verifierCreneau(iv(13, 23), reglages, maintenant) ?? '', /maximum/));
});

describe('ouverture de la partie', () => {
  const c = iv(20, 23);
  it('fermée une heure avant', () => assert.equal(creneauOuvert(c, 30, h(19)), false));
  it('ouverte 30 min avant', () => assert.equal(creneauOuvert(c, 30, h(19, 30)), true));
  it('ouverte pendant', () => assert.equal(creneauOuvert(c, 30, h(21)), true));
  it('fermée après la fin', () => assert.equal(creneauOuvert(c, 30, h(23, 1)), false));
});

describe('codes gratuits', () => {
  it('normalise espaces et casse', () => assert.equal(normaliserCode(' tutti-ab2c -x7yz '), 'TUTTI-AB2C-X7YZ'));
  it('génère au bon format, sans caractères ambigus', () => {
    const code = genererCode();
    assert.match(code, /^TUTTI-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  });
});
