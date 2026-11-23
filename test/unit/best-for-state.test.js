import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { bestOption } from '../../src/core/rules.js';
import { bestForState } from '../../src/pipeline/view.js';

const CASH = 120_000_000;

/** @type {import('../../src/core/compare.js').StoreInput[]} */
const cashOnly = [{ store: 'oncity', contadoCents: CASH, cards: [] }];
/** @type {import('../../src/core/compare.js').StoreInput[]} */
const withCards = [{ store: 'oncity', contadoCents: CASH, cards: [{ card: 'visa', offer: { n: 12, cuotaCents: Math.round(CASH / 12), totalCents: CASH } }] }];
/** @type {import('../../src/core/compare.js').StoreInput[]} */
const cardsOnly = [{ store: 'oncity', contadoCents: null, cards: [{ card: 'visa', offer: { n: 12, cuotaCents: Math.round(CASH / 12), totalCents: CASH } }] }];

describe('prevBest uses the best-option definition of the rules (DRT 13.2)', () => {
  test('a cash-only product still has a best option', () => {
    assert.deepEqual(bestForState({ stores: cashOnly, r: 0.025, s: 1 }), { tipo: 'contado', tienda: 'oncity', serie: 'contado', valorCents: CASH, r: 0.025 });
  });

  test('a product with cards but no cash price has a best option too', () => {
    const best = bestForState({ stores: cardsOnly, r: 0.025, s: 1 });
    assert.equal(best?.tipo, 'cuotas');
    assert.equal(best?.serie, 'visa:12');
  });

  test('installments win only when their present value is below the cash price', () => {
    assert.equal(bestForState({ stores: withCards, r: 0.025, s: 1 })?.tipo, 'cuotas');
    assert.equal(bestForState({ stores: withCards, r: 0, s: 1 })?.tipo, 'contado', 'tie goes to cash');
  });

  test('a tie keeps the previous best (S-10)', () => {
    /** @type {import('../../src/core/compare.js').StoreInput[]} */
    const twoStores = [
      { store: 'alfa', contadoCents: CASH, cards: [] },
      { store: 'beta', contadoCents: CASH, cards: [] },
    ];
    assert.equal(bestForState({ stores: twoStores, r: 0.02, s: 1 })?.tienda, 'alfa');
    assert.equal(bestForState({ stores: twoStores, r: 0.02, s: 1, hold: { tipo: 'contado', tienda: 'beta', serie: 'contado' } })?.tienda, 'beta');
  });

  test('without a rate there is no best option to remember', () => {
    assert.equal(bestForState({ stores: withCards, r: null, s: 1 }), null);
    assert.equal(bestOption({ stores: withCards, r: null, s: 1 }), null);
  });

  test('nothing eligible, nothing to remember', () => {
    assert.equal(bestForState({ stores: [], r: 0.02, s: 1 }), null);
  });
});
