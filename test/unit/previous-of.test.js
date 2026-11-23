import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { previousOf } from '../../src/pipeline/run-pipeline.js';
import { emptyState } from '../../src/state/schema.js';

describe('S4: previousOf reads only own keys of the state maps', () => {
  const hash = `sha256:${'a'.repeat(64)}`;

  test('a product id that names an Object.prototype property finds nothing in an empty state', () => {
    const state = { ...emptyState(), products: {} };
    for (const productId of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
      assert.equal(previousOf({ state, rebuilt: false, productId }), undefined, productId);
    }
  });

  test('without products (a state from before F4) the rules treat the product as unknown', () => {
    const state = { ...emptyState(), eligible: { tv: ['oncity/contado'] } };
    assert.equal(previousOf({ state, rebuilt: false, productId: 'tv' }), undefined);
  });

  test('a known product returns what the rules need, with and without a best option', () => {
    const state = {
      ...emptyState(),
      products: { tv: { configHash: hash, s: /** @type {const} */ (1), r: 0.02 } },
      eligible: { tv: ['oncity/contado'] },
      prevBest: { tv: { tipo: /** @type {const} */ ('contado'), tienda: 'oncity', serie: 'contado', valorCents: 100, r: null } },
    };
    assert.deepEqual(previousOf({ state, rebuilt: false, productId: 'tv' }), { eligible: ['oncity/contado'], r: 0.02, s: 1, configHash: hash, best: { tipo: 'contado', tienda: 'oncity', serie: 'contado' } });
    assert.equal(previousOf({ state: { ...state, prevBest: {} }, rebuilt: false, productId: 'tv' })?.best, null);
    assert.equal(previousOf({ state, rebuilt: true, productId: 'tv' }), undefined);
  });
});
