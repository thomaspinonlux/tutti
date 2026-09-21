import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { encoderFormulaire, signatureValide } from './stripe.js';

const SECRET = 'whsec_test_secret';
const signer = (corps: string, t: number, secret = SECRET): string =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${corps}`).digest('hex')}`;

describe('signature du webhook Stripe', () => {
  const corps = '{"id":"evt_1","type":"checkout.session.completed"}';
  const t = 1_790_000_000;

  it('accepte une signature juste, dans les délais', () => {
    assert.equal(signatureValide(corps, signer(corps, t), SECRET, t + 10), true);
  });
  it('accepte aussi le corps en Buffer (ce que reçoit express.raw)', () => {
    assert.equal(signatureValide(Buffer.from(corps), signer(corps, t), SECRET, t), true);
  });
  it('refuse un corps modifié', () => {
    assert.equal(signatureValide(corps.replace('evt_1', 'evt_2'), signer(corps, t), SECRET, t), false);
  });
  it('refuse le mauvais secret', () => {
    assert.equal(signatureValide(corps, signer(corps, t, 'autre'), SECRET, t), false);
  });
  it('refuse un vieil appel rejoué', () => {
    assert.equal(signatureValide(corps, signer(corps, t), SECRET, t + 301), false);
  });
  it('refuse un en-tête absent ou vide', () => {
    assert.equal(signatureValide(corps, undefined, SECRET, t), false);
    assert.equal(signatureValide(corps, '', SECRET, t), false);
  });
  it('accepte quand l une de plusieurs signatures v1 est juste (rotation de secret)', () => {
    const entete = `t=${t},v1=deadbeef,${signer(corps, t).split(',')[1]}`;
    assert.equal(signatureValide(corps, entete, SECRET, t), true);
  });
});

describe('encodage du formulaire Stripe', () => {
  it('imbrique objets et tableaux à crochets', () => {
    const paires = encoderFormulaire({
      mode: 'payment',
      line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: 4500 } }],
      metadata: { reservation_id: 'abc' },
    }).map(decodeURIComponent);
    assert.deepEqual(paires, [
      'mode=payment',
      'line_items[0][quantity]=1',
      'line_items[0][price_data][currency]=eur',
      'line_items[0][price_data][unit_amount]=4500',
      'metadata[reservation_id]=abc',
    ]);
  });
  it('omet les valeurs absentes', () => {
    assert.deepEqual(encoderFormulaire({ a: undefined, b: null, c: 'x' }), ['c=x']);
  });
});
