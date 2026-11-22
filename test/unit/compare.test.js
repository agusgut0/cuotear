import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  annualToMonthlyRate,
  compareOption,
  compareProduct,
  presentValueCents,
  resolveMonthlyRate,
} from '../../src/core/compare.js';

const PESO = 100;

/**
 * Asserts |actual - expected| <= tolerance.
 * @param {number|null|undefined} actual
 * @param {number} expected
 * @param {number} tolerance
 * @param {string} [label]
 */
function assertNear(actual, expected, tolerance, label = '') {
  assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) <= tolerance, `${label} expected ${expected} ± ${tolerance}, got ${actual}`);
}

/** DAF RF-21 worked example: Pc = 1.000.000, Visa 12 x 100.000 (T = 1.200.000). */
const pcCents = 1_000_000 * PESO;
const visa12 = { n: 12, cuotaCents: 100_000 * PESO, totalCents: 1_200_000 * PESO };

describe('RF-21: worked examples A, B and C', () => {
  test('A: r = 3 %, s = 1 -> conviene cuotas, diferencia marginal', () => {
    const result = compareOption({ pcCents, offer: visa12, r: 0.03, s: 1 });
    assert.equal(result.difCents, 200_000 * PESO);
    assert.equal(result.difPct, 20);
    assertNear(result.vpCents, 995_400 * PESO, PESO, 'VP');
    assertNear(result.difVpCents, -4_600 * PESO, PESO, 'DifVP$');
    assert.equal(result.difVpPct?.toFixed(2), '-0.46');
    assert.equal(result.verdict, 'cuotas');
    assert.equal(result.marginal, true);
  });

  test('B: r = 1 %, s = 1 -> conviene contado, not marginal', () => {
    const result = compareOption({ pcCents, offer: visa12, r: 0.01, s: 1 });
    assertNear(result.vpCents, 1_125_508 * PESO, PESO, 'VP');
    assertNear(result.difVpCents, 125_508 * PESO, PESO, 'DifVP$');
    assert.equal(result.difVpPct?.toFixed(2), '12.55');
    assert.equal(result.verdict, 'contado');
    assert.equal(result.marginal, false);
  });

  test('C: r = 3 %, s = 0 -> conviene contado', () => {
    const result = compareOption({ pcCents, offer: visa12, r: 0.03, s: 0 });
    assertNear(result.vpCents, 1_025_262 * PESO, PESO, 'VP');
    assert.equal(result.difVpPct?.toFixed(2), '2.53');
    assert.equal(result.verdict, 'contado');
    assert.equal(result.marginal, false);
  });
});

describe('RF-21: acceptance criteria', () => {
  test('r = 0 gives VP = n x C for s = 1 and s = 0, and cash wins', () => {
    for (const s of /** @type {const} */ ([1, 0])) {
      const result = compareOption({ pcCents, offer: visa12, r: 0, s });
      assert.equal(result.vpCents, 1_200_000 * PESO);
      assert.equal(result.verdict, 'contado');
    }
  });

  test('a tie (VP = Pc) goes to cash and is marginal', () => {
    const result = compareOption({ pcCents: 1_200_000 * PESO, offer: visa12, r: 0, s: 1 });
    assert.equal(result.vpCents, 1_200_000 * PESO);
    assert.equal(result.difVpCents, 0);
    assert.equal(result.difVpPct, 0);
    assert.equal(result.verdict, 'contado');
    assert.equal(result.marginal, true);
  });

  test('1 % boundary: exactly -1.00 % is not marginal; -1.12 % is not; -0.40 % is', () => {
    /** @param {number} cuota installment in pesos */
    const at = (cuota) => compareOption({ pcCents, offer: { n: 12, cuotaCents: cuota * PESO, totalCents: 12 * cuota * PESO }, r: 0, s: 1 });

    const boundary = at(82_500);
    assert.equal(boundary.vpCents, 990_000 * PESO);
    assert.equal(boundary.difVpPct, -1);
    assert.equal(boundary.verdict, 'cuotas');
    assert.equal(boundary.marginal, false);

    const below = at(82_400);
    assert.equal(below.vpCents, 988_800 * PESO);
    assert.equal(below.difVpPct?.toFixed(2), '-1.12');
    assert.equal(below.verdict, 'cuotas');
    assert.equal(below.marginal, false);

    const above = at(83_000);
    assert.equal(above.vpCents, 996_000 * PESO);
    assert.equal(above.difVpPct?.toFixed(2), '-0.40');
    assert.equal(above.verdict, 'cuotas');
    assert.equal(above.marginal, true);
  });

  test('the marginal threshold is configurable', () => {
    const result = compareOption({ pcCents, offer: visa12, r: 0.01, s: 1, marginalPct: 20 });
    assert.equal(result.marginal, true);
  });

  test('annual 40 % -> r = 2.8436 % monthly, VP ~ 1.004.757 (+-5), cash wins marginally', () => {
    const r = annualToMonthlyRate(40);
    assertNear(r * 100, 2.8436, 0.00005, 'r %');
    const result = compareOption({ pcCents, offer: visa12, r, s: 1 });
    assertNear(result.vpCents, 1_004_757 * PESO, 5 * PESO, 'VP');
    assert.equal(result.verdict, 'contado');
    assert.equal(result.marginal, true);
  });

  test('REM annual 21.8 % -> r = 1.657 % monthly, the same for 3 and 18 installments', () => {
    const { r, origin } = resolveMonthlyRate({ fuente: 'manual', manual: { periodo: 'anual', pct: 21.8 } });
    assert.equal(origin, 'manual');
    assertNear(Number(r) * 100, 1.657, 0.0005, 'r %');
    assertNear(annualToMonthlyRate(21.8), Number(r), 1e-15);
  });

  test('s outside {0, 1} is rejected', () => {
    // @ts-expect-error s = 2 is invalid and must be rejected at runtime too
    assert.throws(() => compareOption({ pcCents, offer: visa12, r: 0.03, s: 2 }), RangeError);
    // @ts-expect-error s = -1 is invalid
    assert.throws(() => presentValueCents(visa12, 0.03, -1), RangeError);
  });

  test('a negative r is rejected', () => {
    assert.throws(() => presentValueCents(visa12, -0.01, 1), RangeError);
    assert.throws(() => annualToMonthlyRate(-5), RangeError);
    assert.throws(() => resolveMonthlyRate({ fuente: 'manual', manual: { periodo: 'mensual', pct: -1 } }), RangeError);
  });

  test('without a rate there is no verdict but the nominal comparison is kept', () => {
    const result = compareOption({ pcCents, offer: visa12, r: null, s: 1 });
    assert.equal(result.verdict, 'sin_veredicto');
    assert.equal(result.marginal, false);
    assert.equal(result.difCents, 200_000 * PESO);
    assert.equal(result.difPct, 20);
    assert.equal(result.vpCents, null);
    assert.equal(result.difVpPct, null);
  });

  test('invalid amounts and installment counts are rejected', () => {
    /** @param {typeof visa12} offer */
    const bad = (offer) => () => compareOption({ pcCents, offer, r: 0.01, s: 1 });
    assert.throws(bad({ ...visa12, n: 1 }), RangeError);
    assert.throws(bad({ ...visa12, n: 73 }), RangeError);
    assert.throws(bad({ ...visa12, n: 12.5 }), RangeError);
    assert.throws(bad({ ...visa12, cuotaCents: 100.5 }), RangeError);
    assert.throws(bad({ ...visa12, totalCents: 0 }), RangeError);
    assert.throws(() => compareOption({ pcCents: 0, offer: visa12, r: 0.01, s: 1 }), RangeError);
  });
});

describe('inflation source resolution', () => {
  test('manual source: monthly and annual values', () => {
    assert.deepEqual(resolveMonthlyRate({ fuente: 'manual', manual: { periodo: 'mensual', pct: 2.5 } }), { r: 0.025, origin: 'manual' });
    assert.equal(resolveMonthlyRate({ fuente: 'manual', manual: { periodo: 'mensual', pct: 0 } }).r, 0);
  });

  test('REM source (not available yet) falls back to the manual value as backup', () => {
    assert.deepEqual(resolveMonthlyRate({ fuente: 'rem', manual: { periodo: 'mensual', pct: 3 } }), { r: 0.03, origin: 'backup' });
  });

  test('no source at all means no rate', () => {
    assert.deepEqual(resolveMonthlyRate({ fuente: 'rem' }), { r: null, origin: 'none' });
    assert.deepEqual(resolveMonthlyRate({ fuente: 'manual' }), { r: null, origin: 'none' });
  });
});

describe('product verdict (RF-21 point 5)', () => {
  /** @param {typeof visa12} offer */
  const cards = (offer) => [{ card: /** @type {const} */ ('visa'), offer }];

  test('lowest cash price across stores against lowest VP across all store x card options', () => {
    const result = compareProduct({
      r: 0.03,
      s: 1,
      stores: [
        { store: 'oncity', contadoCents: 1_000_000 * PESO, cards: [] },
        { store: 'carrefour', contadoCents: 1_100_000 * PESO, cards: cards({ n: 12, cuotaCents: 85_000 * PESO, totalCents: 1_020_000 * PESO }) },
      ],
    });
    assert.equal(result.pcStarCents, 1_000_000 * PESO);
    assertNear(result.vpStarCents, 846_100 * PESO, 100 * PESO);
    assert.equal(result.verdict, 'cuotas');
    assert.deepEqual(result.best, { tipo: 'cuotas', store: 'carrefour', card: 'visa', n: 12 });
    assert.equal(result.marginal, false);
    // The per-store detail compares against the cash price of the same store.
    assert.equal(result.stores[1]?.cards[0]?.comparison?.difCents, -80_000 * PESO);
    assert.equal(result.stores[0]?.cards.length, 0);
  });

  test('cash wins and is the best option when installments are worse', () => {
    const result = compareProduct({
      r: 0.01,
      s: 1,
      stores: [{ store: 'oncity', contadoCents: pcCents, cards: cards(visa12) }],
    });
    assert.equal(result.verdict, 'contado');
    assert.deepEqual(result.best, { tipo: 'contado', store: 'oncity' });
    assert.equal(result.difVpPct?.toFixed(2), '12.55');
  });

  test('a tie between VP* and Pc* goes to cash', () => {
    const result = compareProduct({
      r: 0,
      s: 1,
      stores: [{ store: 'oncity', contadoCents: 1_200_000 * PESO, cards: cards(visa12) }],
    });
    assert.equal(result.verdict, 'contado');
    assert.equal(result.marginal, true);
  });

  test('a card of a store without eligible cash still competes for VP*, without a same-store comparison', () => {
    const result = compareProduct({
      r: 0.03,
      s: 1,
      stores: [
        { store: 'oncity', contadoCents: 1_000_000 * PESO, cards: [] },
        { store: 'naranja-shop', contadoCents: null, cards: cards({ n: 12, cuotaCents: 50_000 * PESO, totalCents: 600_000 * PESO }) },
      ],
    });
    assert.deepEqual(result.best, { tipo: 'cuotas', store: 'naranja-shop', card: 'visa', n: 12 });
    assert.equal(result.stores[1]?.cards[0]?.comparison, null);
  });

  test('no eligible cash price or no eligible card means no verdict', () => {
    const withoutCash = compareProduct({ r: 0.03, s: 1, stores: [{ store: 'a', contadoCents: null, cards: cards(visa12) }] });
    assert.equal(withoutCash.verdict, 'sin_veredicto');
    assert.equal(withoutCash.best, null);
    const withoutCards = compareProduct({ r: 0.03, s: 1, stores: [{ store: 'a', contadoCents: pcCents, cards: [] }] });
    assert.equal(withoutCards.verdict, 'sin_veredicto');
    assert.equal(withoutCards.pcStarCents, pcCents);
    assert.equal(compareProduct({ r: 0.03, s: 1, stores: [] }).verdict, 'sin_veredicto');
  });

  test('without a rate: no verdict, but nominal differences per store remain', () => {
    const result = compareProduct({ r: null, s: 1, stores: [{ store: 'a', contadoCents: pcCents, cards: cards(visa12) }] });
    assert.equal(result.verdict, 'sin_veredicto');
    assert.equal(result.vpStarCents, null);
    assert.equal(result.stores[0]?.cards[0]?.comparison?.difPct, 20);
    assert.equal(result.stores[0]?.cards[0]?.comparison?.verdict, 'sin_veredicto');
  });

  test('equal values are resolved deterministically by store id', () => {
    const stores = ['b', 'a'].map((store) => ({ store, contadoCents: pcCents, cards: cards(visa12) }));
    const forward = compareProduct({ r: 0.01, s: 1, stores });
    const backward = compareProduct({ r: 0.01, s: 1, stores: [...stores].reverse() });
    assert.deepEqual(forward.best, backward.best);
    assert.deepEqual(forward.best, { tipo: 'contado', store: 'a' });
    const expensiveCash = stores.map((entry) => ({ ...entry, contadoCents: 2 * pcCents }));
    assert.deepEqual(compareProduct({ r: 0.01, s: 1, stores: expensiveCash }).best, { tipo: 'cuotas', store: 'a', card: 'visa', n: 12 });
  });
});
