import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_VERIFY_DROP_PCT, evaluateProduct, resolveRules } from '../../src/core/rules.js';

/** @typedef {import('../../src/core/history.js').HistoryPoint} HistoryPoint */
/** @typedef {import('../../src/core/rules.js').EvaluateInput} EvaluateInput */

const T0 = '2026-11-22T12:00:00Z';
const T1 = '2026-11-22T18:00:00Z';

/**
 * Pesos to centavos.
 * @param {number} pesos
 * @returns {number}
 */
const $ = (pesos) => Math.round(pesos * 100);

/**
 * One store of the real (current) comparison input.
 * @param {string} store
 * @param {number|null} contadoCents
 * @param {...{ card: 'visa'|'mastercard'|'naranja', offer: { n: number, cuotaCents: number, totalCents: number } }} cards
 * @returns {import('../../src/core/compare.js').StoreInput}
 */
const S = (store, contadoCents, ...cards) => ({ store, contadoCents, cards });

/**
 * @param {'visa'|'mastercard'|'naranja'} brand
 * @param {number} n
 * @param {number} cuotaCents
 */
const plan = (brand, n, cuotaCents) => ({ card: brand, offer: { n, cuotaCents, totalCents: n * cuotaCents } });


/**
 * @param {string} t
 * @param {string} tienda
 * @param {number} cents
 * @returns {HistoryPoint}
 */
const cash = (t, tienda, cents) => ({ t, tienda, serie: 'contado', estado: 'ok', valor: cents, lista: cents });

/**
 * @param {string} t
 * @param {string} tienda
 * @param {'visa'|'mastercard'|'naranja'} brand
 * @param {number} n
 * @param {number} cuotaCents
 * @returns {HistoryPoint}
 */
const card = (t, tienda, brand, n, cuotaCents) => ({ t, tienda, serie: `${brand}:${n}`, estado: 'ok', total: n * cuotaCents, cuota: cuotaCents, n });

/**
 * @param {Partial<EvaluateInput>} overrides
 */
function run(overrides) {
  return evaluateProduct({ productId: 'tcl', prevPoints: [], added: [], eligible: [], stores: [], r: null, s: 1, configHash: 'h', t: T1, ...overrides });
}

/**
 * One cash series moving from `prev` to `current` centavos.
 * @param {number} prev
 * @param {number} current
 * @param {Partial<EvaluateInput>} [extra]
 */
const cashMove = (prev, current, extra = {}) => run({ prevPoints: [cash(T0, 'oncity', prev)], added: [cash(T1, 'oncity', current)], eligible: ['oncity/contado'], ...extra });

describe('resolveRules (S-10, S-31)', () => {
  test('no key at any level -> implicit strict drop', () => {
    assert.equal(resolveRules(undefined, undefined).implicit, true);
    assert.equal(resolveRules({}, {}).implicit, true);
    assert.equal(resolveRules({ aplica_a: 'total_cuotas' }, undefined).implicit, true);
  });

  test('a disabled key still counts as a key: no implicit rule', () => {
    const rules = resolveRules({ baja_minima_pct: /** @type {const} */ (false) }, undefined);
    assert.equal(rules.implicit, false);
    assert.equal(rules.bajaPct, null);
    assert.equal(resolveRules(undefined, { cambio_mejor_opcion: false }).implicit, false);
    assert.equal(resolveRules({ precio_objetivo: 'no' }, undefined).objetivoCents, null);
  });

  test('the product value replaces the global one per rule', () => {
    const rules = resolveRules({ baja_minima_pct: 5, baja_minima_monto: 50_000, cambio_mejor_opcion: true }, { baja_minima_pct: 20, baja_minima_monto: 'no', precio_objetivo: 1_999_999.99 });
    assert.equal(rules.bajaPct, 20);
    assert.equal(rules.bajaMontoCents, null);
    assert.equal(rules.objetivoCents, 199_999_999);
    assert.equal(rules.cambioMejorOpcion, true);
    assert.equal(rules.aplicaA, 'contado');
  });

  test('aplica_a: product, then global, then contado', () => {
    assert.equal(resolveRules({ aplica_a: 'mejor_vp' }, undefined).aplicaA, 'mejor_vp');
    assert.equal(resolveRules({ aplica_a: 'mejor_vp' }, { aplica_a: 'total_cuotas' }).aplicaA, 'total_cuotas');
    assert.equal(resolveRules({}, {}).aplicaA, 'contado');
  });

  test('amounts are converted from pesos to centavos', () => {
    assert.equal(resolveRules({ baja_minima_monto: 50_000 }, undefined).bajaMontoCents, 5_000_000);
  });
});

describe('implicit strict drop', () => {
  test('any drop alerts, down to one centavo', () => {
    const [alert, ...rest] = cashMove($(1_000_000), $(1_000_000) - 1);
    assert.equal(rest.length, 0);
    assert.ok(alert?.kind === 'serie');
    assert.deepEqual(alert.rules, ['baja_estricta']);
    assert.equal(alert.prevCents, 100_000_000);
    assert.equal(alert.currentCents, 99_999_999);
    assert.equal(alert.dropCents, 1);
    assert.equal(alert.prevT, T0);
    assert.equal(alert.detectedAt, T1);
  });

  test('same value or a rise does not alert', () => {
    assert.deepEqual(cashMove($(1_000_000), $(1_000_000)), []);
    assert.deepEqual(cashMove($(1_000_000), $(1_000_001)), []);
  });

  test('a condition change at the same price does not alert', () => {
    const changed = { ...cash(T1, 'oncity', $(1_000_000)), lista: $(1_100_000), desc: 9 };
    assert.deepEqual(run({ prevPoints: [cash(T0, 'oncity', $(1_000_000))], added: [changed], eligible: ['oncity/contado'] }), []);
  });

  test('card totals are watched too', () => {
    const alerts = run({ prevPoints: [card(T0, 'oncity', 'visa', 12, $(100_000))], added: [card(T1, 'oncity', 'visa', 12, $(99_000))], eligible: ['oncity/visa:12'] });
    assert.equal(alerts.length, 1);
    const [alert] = alerts;
    assert.ok(alert?.kind === 'serie');
    assert.equal(alert.serie, 'visa:12');
    assert.equal(alert.prevCents, $(1_200_000));
    assert.equal(alert.currentCents, $(1_188_000));
  });

  test('is not applied when any rule key exists, even if all are disabled', () => {
    assert.deepEqual(cashMove($(1_000_000), $(500_000), { globalRules: { cambio_mejor_opcion: false } }), []);
    assert.deepEqual(cashMove($(1_000_000), $(500_000), { globalRules: { baja_minima_pct: 'no', baja_minima_monto: false, precio_objetivo: 'no', cambio_mejor_opcion: false } }), []);
    assert.deepEqual(cashMove($(1_000_000), $(500_000), { globalRules: { baja_minima_pct: 5 }, productRules: { baja_minima_pct: /** @type {const} */ (false) } }), []);
  });
});

describe('baja_minima_pct (RF-22)', () => {
  const globalRules = { baja_minima_pct: 5 };

  test('-4 % does not alert, -6 % does', () => {
    assert.deepEqual(cashMove($(1_000_000), $(960_000), { globalRules }), []);
    const [alert] = cashMove($(1_000_000), $(940_000), { globalRules });
    assert.ok(alert?.kind === 'serie');
    assert.deepEqual(alert.rules, ['baja_minima_pct']);
    assert.equal(alert.dropPct, 6);
  });

  test('the threshold is inclusive: exactly -5 % alerts, one centavo less does not', () => {
    assert.equal(cashMove($(1_000_000), $(950_000), { globalRules }).length, 1);
    assert.equal(cashMove($(1_000_000), $(950_000) + 1, { globalRules }).length, 0);
  });

  test('a decimal threshold is exact at the boundary', () => {
    assert.equal(cashMove($(1_000), $(926.5), { globalRules: { baja_minima_pct: 7.35 } }).length, 1);
    assert.equal(cashMove($(1_000), $(926.51), { globalRules: { baja_minima_pct: 7.35 } }).length, 0);
  });
});

describe('baja_minima_monto (RF-22)', () => {
  const globalRules = { baja_minima_monto: 50_000 };

  test('a drop of exactly 50.000 alerts (inclusive)', () => {
    const [alert] = cashMove($(1_000_000), $(950_000), { globalRules });
    assert.ok(alert?.kind === 'serie');
    assert.deepEqual(alert.rules, ['baja_minima_monto']);
  });

  test('one centavo short does not alert', () => {
    assert.deepEqual(cashMove($(1_000_000), $(950_000) + 1, { globalRules }), []);
  });
});

describe('precio_objetivo, aplica_a contado and total_cuotas (RF-22)', () => {
  test('crossing prev > objetivo >= current alerts, reaching exactly the target counts', () => {
    const globalRules = { precio_objetivo: 900_000 };
    const [alert] = cashMove($(950_000), $(900_000), { globalRules });
    assert.ok(alert?.kind === 'serie');
    assert.deepEqual(alert.rules, ['precio_objetivo']);
    assert.equal(alert.objetivoCents, $(900_000));
    assert.equal(cashMove($(950_000), $(900_000) + 1, { globalRules }).length, 0);
  });

  test('it does not repeat while the price stays below, nor when prev is exactly the target', () => {
    const globalRules = { precio_objetivo: 900_000 };
    assert.deepEqual(cashMove($(890_000), $(850_000), { globalRules }), []);
    assert.deepEqual(cashMove($(900_000), $(850_000), { globalRules }), []);
  });

  test('by default and with aplica_a contado it watches only cash series', () => {
    const prevPoints = [cash(T0, 'oncity', $(950_000)), card(T0, 'oncity', 'visa', 12, $(100_000))];
    const added = [cash(T1, 'oncity', $(890_000)), card(T1, 'oncity', 'visa', 12, $(70_000))];
    const eligible = ['oncity/contado', 'oncity/visa:12'];
    for (const globalRules of [{ precio_objetivo: 900_000 }, { precio_objetivo: 900_000, aplica_a: /** @type {const} */ ('contado') }]) {
      const alerts = run({ prevPoints, added, eligible, globalRules });
      assert.deepEqual(
        alerts.map((alert) => alert.kind === 'serie' && alert.serie),
        ['contado'],
      );
    }
  });

  test('aplica_a total_cuotas watches the card totals only', () => {
    const prevPoints = [cash(T0, 'oncity', $(950_000)), card(T0, 'oncity', 'visa', 12, $(100_000))];
    const added = [cash(T1, 'oncity', $(850_000)), card(T1, 'oncity', 'visa', 12, $(70_000))];
    const alerts = run({ prevPoints, added, eligible: ['oncity/contado', 'oncity/visa:12'], globalRules: { precio_objetivo: 1_000_000, aplica_a: 'total_cuotas' } });
    assert.equal(alerts.length, 1);
    const [alert] = alerts;
    assert.ok(alert?.kind === 'serie');
    assert.equal(alert.serie, 'visa:12');
    assert.equal(alert.prevCents, $(1_200_000));
    assert.equal(alert.currentCents, $(840_000));
    assert.deepEqual(alert.rules, ['precio_objetivo']);
  });

  test('a disabled target never alerts', () => {
    assert.deepEqual(cashMove($(950_000), $(800_000), { globalRules: { precio_objetivo: 900_000, baja_minima_pct: 'no' }, productRules: { precio_objetivo: 'no' } }), []);
  });

  test('a product target replaces the global one', () => {
    const globalRules = { precio_objetivo: 900_000, baja_minima_pct: /** @type {const} */ (false) };
    assert.equal(cashMove($(950_000), $(920_000), { globalRules, productRules: { precio_objetivo: 930_000 } }).length, 1);
    assert.equal(cashMove($(950_000), $(920_000), { globalRules }).length, 0);
  });
});

describe('one alert per series listing every satisfied rule', () => {
  test('pct + monto + objetivo together', () => {
    const alerts = cashMove($(1_000_000), $(890_000), { globalRules: { baja_minima_pct: 5, baja_minima_monto: 50_000, precio_objetivo: 900_000 } });
    assert.equal(alerts.length, 1);
    const [alert] = alerts;
    assert.ok(alert?.kind === 'serie');
    assert.deepEqual(alert.rules, ['baja_minima_pct', 'baja_minima_monto', 'precio_objetivo']);
  });

  test('rules combine with OR: one is enough', () => {
    const [alert] = cashMove($(1_000_000), $(940_000), { globalRules: { baja_minima_pct: 5, baja_minima_monto: 100_000 } });
    assert.ok(alert?.kind === 'serie');
    assert.deepEqual(alert.rules, ['baja_minima_pct']);
  });

  test('two stores give two alerts in store order', () => {
    const alerts = run({
      prevPoints: [cash(T0, 'oncity', $(1_000_000)), cash(T0, 'carrefour', $(1_000_000))],
      added: [cash(T1, 'oncity', $(900_000)), cash(T1, 'carrefour', $(900_000))],
      eligible: ['oncity/contado', 'carrefour/contado'],
    });
    assert.deepEqual(
      alerts.map((alert) => alert.kind === 'serie' && alert.tienda),
      ['carrefour', 'oncity'],
    );
  });
});

describe('RN-12: no previous valid point, no alert', () => {
  test('a first measurement below the target does not alert', () => {
    assert.deepEqual(run({ added: [cash(T1, 'oncity', $(100))], eligible: ['oncity/contado'], globalRules: { precio_objetivo: 900_000 } }), []);
    assert.deepEqual(run({ added: [cash(T1, 'oncity', $(100))], eligible: ['oncity/contado'] }), []);
  });

  test('a new number of installments opens a series without antecedent', () => {
    const closed = { ...card(T1, 'oncity', 'visa', 12, $(100_000)), estado: /** @type {const} */ ('cerrada') };
    const alerts = run({
      prevPoints: [card(T0, 'oncity', 'visa', 12, $(100_000)), closed],
      added: [card(T1, 'oncity', 'visa', 6, $(50_000))],
      eligible: ['oncity/visa:6'],
    });
    assert.deepEqual(alerts, []);
  });

  test('only a sin_stock point before is no antecedent', () => {
    const outOfStock = { t: T0, tienda: 'oncity', serie: 'contado', estado: /** @type {const} */ ('sin_stock') };
    assert.deepEqual(run({ prevPoints: [outOfStock], added: [cash(T1, 'oncity', $(1))], eligible: ['oncity/contado'] }), []);
  });

  test('restock compares against the last valid price (RN-06)', () => {
    const outOfStock = { t: T0, tienda: 'oncity', serie: 'contado', estado: /** @type {const} */ ('sin_stock') };
    const prevPoints = [cash('2026-11-20T00:00:00Z', 'oncity', $(1_000_000)), outOfStock];
    const [alert] = run({ prevPoints, added: [cash(T1, 'oncity', $(900_000))], eligible: ['oncity/contado'] });
    assert.ok(alert?.kind === 'serie');
    assert.equal(alert.prevCents, $(1_000_000));
    assert.equal(alert.prevT, '2026-11-20T00:00:00Z');
  });

  test('points that are not ok (sin_stock now) never alert', () => {
    const outOfStock = { t: T1, tienda: 'oncity', serie: 'contado', estado: /** @type {const} */ ('sin_stock') };
    assert.deepEqual(run({ prevPoints: [cash(T0, 'oncity', $(1_000_000))], added: [outOfStock] }), []);
  });
});

describe('RN-13: "a verificar"', () => {
  test('1.000.000 -> 80.000 (-92 %) is flagged', () => {
    const [alert] = cashMove($(1_000_000), $(80_000));
    assert.ok(alert?.kind === 'serie');
    assert.equal(alert.dropPct, 92);
    assert.equal(alert.verify, true);
  });

  test('exactly -90 % (100.000) is not flagged, one centavo more is', () => {
    const [exact] = cashMove($(1_000_000), $(100_000));
    assert.ok(exact?.kind === 'serie');
    assert.equal(exact.dropPct, 90);
    assert.equal(exact.verify, false);
    const [more] = cashMove($(1_000_000), $(100_000) - 1);
    assert.ok(more?.kind === 'serie' && more.verify);
  });

  test('the threshold is configurable and the default is 90', () => {
    assert.equal(DEFAULT_VERIFY_DROP_PCT, 90);
    const [alert] = cashMove($(1_000_000), $(400_000), { verificarBajaPct: 50 });
    assert.ok(alert?.kind === 'serie' && alert.verify);
    const [normal] = cashMove($(1_000_000), $(400_000));
    assert.ok(normal?.kind === 'serie' && !normal.verify);
  });
});

describe('dedupe id stability', () => {
  test('re-detecting the same change gives the same id even in a later run', () => {
    const [first] = cashMove($(1_000_000), $(940_000), { globalRules: { baja_minima_pct: 5 } });
    const [again] = cashMove($(1_000_000), $(940_000), { globalRules: { baja_minima_pct: 5 }, t: '2026-11-23T06:00:00Z' });
    assert.ok(first && again);
    assert.equal(first.id, again.id);
    const [other] = cashMove($(1_000_000), $(930_000), { globalRules: { baja_minima_pct: 5 } });
    assert.notEqual(other?.id, first.id);
  });
});


/** @type {import('../../src/core/rules.js').PreviousProductState} */
const prevState = { eligible: [], r: 0, s: 1, configHash: 'h', best: null };

describe('cambio_mejor_opcion (RF-22)', () => {
  const globalRules = { cambio_mejor_opcion: true };

  /**
   * Stores a and b, cash only. Previously a 1.000.000 < b 1.100.000; now a is 1.150.000.
   * @param {Partial<EvaluateInput>} extra
   */
  const twoStores = (extra) =>
    run({
      globalRules,
      prevPoints: [cash(T0, 'a', $(1_000_000)), cash(T0, 'b', $(1_100_000))],
      added: [cash(T1, 'a', $(1_150_000))],
      eligible: ['a/contado', 'b/contado'],
      prev: { ...prevState, eligible: ['a/contado', 'b/contado'], best: { tipo: 'contado', tienda: 'a', serie: 'contado' } },
      stores: [S('a', $(1_150_000)), S('b', $(1_100_000))],
      r: 0,
      ...extra,
    });

  test('alerts when the best option changes because of values of series eligible in both runs', () => {
    const alerts = twoStores({});
    assert.equal(alerts.length, 1);
    const [alert] = alerts;
    assert.ok(alert?.kind === 'cambio_mejor_opcion');
    assert.deepEqual(alert.previous, { tipo: 'contado', tienda: 'a', serie: 'contado', valueCents: $(1_000_000) });
    assert.deepEqual(alert.current, { tipo: 'contado', tienda: 'b', serie: 'contado', valueCents: $(1_100_000) });
    assert.equal(alert.prevT, T0);
    assert.equal(alert.productId, 'tcl');
    assert.deepEqual(alert.rules, ['cambio_mejor_opcion']);
  });

  test('the product or the global level can switch it off, and it is off when not configured', () => {
    assert.deepEqual(twoStores({ productRules: { cambio_mejor_opcion: false } }), []);
    assert.deepEqual(twoStores({ globalRules: { cambio_mejor_opcion: false } }), []);
    assert.deepEqual(twoStores({ globalRules: { baja_minima_pct: 5 } }), []);
  });

  test('no change of identity, no alert (a stays cheapest while b drops)', () => {
    const alerts = run({
      globalRules,
      prevPoints: [cash(T0, 'a', $(1_000_000)), cash(T0, 'b', $(1_100_000))],
      added: [cash(T1, 'b', $(1_050_000))],
      eligible: ['a/contado', 'b/contado'],
      prev: { ...prevState, eligible: ['a/contado', 'b/contado'] },
      stores: [S('a', $(1_000_000)), S('b', $(1_050_000))],
      r: 0,
    });
    assert.deepEqual(alerts, []);
  });

  test('state lost: no alert', () => {
    assert.deepEqual(twoStores({ prev: undefined }), []);
  });

  test('previous rate unknown: no alert', () => {
    assert.deepEqual(twoStores({ prev: { ...prevState, r: null, eligible: ['a/contado', 'b/contado'] } }), []);
  });

  test('product configuration hash changed: no alert', () => {
    assert.deepEqual(twoStores({ configHash: 'otro' }), []);
  });

  test('s changed: no alert', () => {
    assert.deepEqual(twoStores({ s: 0 }), []);
  });

  test('the difference comes only from a series leaving: no alert', () => {
    const alerts = run({
      globalRules,
      prevPoints: [cash(T0, 'a', $(1_000_000)), cash(T0, 'b', $(1_100_000))],
      added: [],
      eligible: ['b/contado'],
      prev: { ...prevState, eligible: ['a/contado', 'b/contado'], best: { tipo: 'contado', tienda: 'a', serie: 'contado' } },
      stores: [S('b', $(1_100_000))],
      r: 0,
    });
    assert.deepEqual(alerts, []);
  });

  test('the difference comes only from a series entering: no alert', () => {
    const alerts = run({
      globalRules,
      prevPoints: [cash(T0, 'a', $(1_000_000))],
      added: [cash(T1, 'c', $(900_000))],
      eligible: ['a/contado', 'c/contado'],
      prev: { ...prevState, eligible: ['a/contado'], best: { tipo: 'contado', tienda: 'a', serie: 'contado' } },
      stores: [S('a', $(1_000_000)), S('c', $(900_000))],
      r: 0,
    });
    assert.deepEqual(alerts, []);
  });

  test('the real best must equal the current best over E: a newcomer winning for real suppresses it', () => {
    const alerts = twoStores({ eligible: ['a/contado', 'b/contado', 'c/contado'], stores: [S('a', $(1_150_000)), S('b', $(1_100_000)), S('c', $(1_000_000))] });
    assert.deepEqual(alerts, []);
  });

  test('a rate-only change does not alert: no new points, E is evaluated with the previous rate', () => {
    // At r = 0 cash wins (the plan is worth 1.200.000). With r = 5 % the plan is the real best, but nothing changed in the series.
    const alerts = run({
      globalRules,
      prevPoints: [cash(T0, 'a', $(1_000_000)), card(T0, 'a', 'visa', 12, $(100_000))],
      added: [],
      eligible: ['a/contado', 'a/visa:12'],
      prev: { ...prevState, eligible: ['a/contado', 'a/visa:12'], best: { tipo: 'contado', tienda: 'a', serie: 'contado' } },
      stores: [S('a', $(1_000_000), plan('visa', 12, $(100_000)))],
      r: 0.05,
    });
    assert.deepEqual(alerts, []);
  });

  test('a contado to cuotas flip caused by a price change in both runs alerts', () => {
    // At r = 0 the plan is worth n x C: 12 x 90.000 = 1.080.000 (above cash 1.000.000), then 12 x 80.000 = 960.000 (below).
    const alerts = run({
      globalRules,
      prevPoints: [cash(T0, 'a', $(1_000_000)), card(T0, 'a', 'visa', 12, $(90_000))],
      added: [card(T1, 'a', 'visa', 12, $(80_000))],
      eligible: ['a/contado', 'a/visa:12'],
      prev: { ...prevState, eligible: ['a/contado', 'a/visa:12'], best: { tipo: 'contado', tienda: 'a', serie: 'contado' } },
      stores: [S('a', $(1_000_000), plan('visa', 12, $(80_000)))],
      r: 0,
    });
    assert.equal(alerts.length, 1);
    const [alert] = alerts;
    assert.ok(alert?.kind === 'cambio_mejor_opcion');
    assert.deepEqual(alert.previous, { tipo: 'contado', tienda: 'a', serie: 'contado', valueCents: $(1_000_000) });
    assert.deepEqual(alert.current, { tipo: 'cuotas', tienda: 'a', serie: 'visa:12', valueCents: $(960_000) });
  });

  test('a tie of value with the previous best keeps it (S-10)', () => {
    const alerts = run({
      globalRules,
      prevPoints: [cash(T0, 'a', $(1_010_000)), cash(T0, 'b', $(1_000_000))],
      added: [cash(T1, 'a', $(1_000_000))],
      eligible: ['a/contado', 'b/contado'],
      prev: { ...prevState, eligible: ['a/contado', 'b/contado'], best: { tipo: 'contado', tienda: 'b', serie: 'contado' } },
      stores: [S('a', $(1_000_000)), S('b', $(1_000_000))],
      r: 0,
    });
    assert.deepEqual(alerts, []);
  });

  test('a series back from a stock-out uses its last valid value as the previous one', () => {
    const alerts = run({
      globalRules,
      prevPoints: [cash('2026-11-20T00:00:00Z', 'a', $(1_000_000)), cash(T0, 'b', $(1_100_000))],
      added: [cash(T1, 'a', $(1_150_000))],
      eligible: ['a/contado', 'b/contado'],
      prev: { ...prevState, eligible: ['a/contado', 'b/contado'], best: { tipo: 'contado', tienda: 'a', serie: 'contado' } },
      stores: [S('a', $(1_150_000)), S('b', $(1_100_000))],
      r: 0,
    });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]?.kind === 'cambio_mejor_opcion' && alerts[0].prevT, T0);
  });
});

describe('precio_objetivo con aplica_a mejor_vp (RF-22)', () => {
  const globalRules = { precio_objetivo: 1_100_000, aplica_a: /** @type {const} */ ('mejor_vp'), baja_minima_pct: /** @type {const} */ (false) };

  /**
   * Visa 12 in store a: cuota 100.000 -> 90.000. With the previous rate r = 0 the
   * present value is n x C: 1.200.000 -> 1.080.000, crossing the target 1.100.000.
   * @param {Partial<EvaluateInput>} extra
   */
  const crossing = (extra) =>
    run({
      globalRules,
      prevPoints: [card(T0, 'a', 'visa', 12, $(100_000))],
      added: [card(T1, 'a', 'visa', 12, $(90_000))],
      eligible: ['a/visa:12'],
      prev: { ...prevState, eligible: ['a/visa:12'] },
      stores: [S('a', null, plan('visa', 12, $(90_000)))],
      r: 0,
      ...extra,
    });

  test('alerts on the crossing, one alert per product', () => {
    const alerts = crossing({});
    assert.equal(alerts.length, 1);
    const [alert] = alerts;
    assert.ok(alert?.kind === 'mejor_vp');
    assert.equal(alert.prevCents, $(1_200_000));
    assert.equal(alert.currentCents, $(1_080_000));
    assert.equal(alert.realCents, $(1_080_000));
    assert.equal(alert.objetivoCents, $(1_100_000));
    assert.equal(alert.prevT, T0);
  });

  test('exactly on the target counts (<=); a target equal to the previous value is not crossed', () => {
    assert.equal(crossing({ globalRules: { ...globalRules, precio_objetivo: 1_080_000 } }).length, 1);
    assert.equal(crossing({ globalRules: { ...globalRules, precio_objetivo: 1_200_000 } }).length, 0);
  });

  test('the real best value with the current rate must also be at or below the target', () => {
    assert.deepEqual(crossing({ stores: [S('a', null, plan('visa', 12, $(96_000)))] }), []);
  });

  test('a crossing caused only by the rate does not alert', () => {
    const alerts = run({
      globalRules,
      prevPoints: [card(T0, 'a', 'visa', 12, $(100_000))],
      added: [],
      eligible: ['a/visa:12'],
      prev: { ...prevState, eligible: ['a/visa:12'] },
      stores: [S('a', null, plan('visa', 12, $(100_000)))],
      r: 0.03,
    });
    assert.deepEqual(alerts, []);
  });

  test('uses the previous rate on both sides (DAF example A: r = 3 %, s = 1)', () => {
    // At 3 %/month 12 x 100.500 is worth about 1.000.377 and 12 x 100.000 about 995.400 (factor 9,954004): they straddle 1.000.000.
    const alerts = run({
      globalRules: { ...globalRules, precio_objetivo: 1_000_000 },
      prevPoints: [card(T0, 'a', 'visa', 12, $(100_500))],
      added: [card(T1, 'a', 'visa', 12, $(100_000))],
      eligible: ['a/visa:12'],
      prev: { ...prevState, eligible: ['a/visa:12'], r: 0.03 },
      stores: [S('a', null, plan('visa', 12, $(100_000)))],
      r: 0.03,
    });
    assert.equal(alerts.length, 1);
    const [alert] = alerts;
    assert.ok(alert?.kind === 'mejor_vp');
    assert.ok(Math.abs(alert.prevCents - $(1_000_377.4)) <= 100, `prev ${alert.prevCents}`);
    assert.ok(Math.abs(alert.currentCents - $(995_400.4)) <= 100, `current ${alert.currentCents}`);
  });

  test('state lost, unknown previous rate, no current rate or a series outside E: no alert', () => {
    assert.deepEqual(crossing({ prev: undefined }), []);
    assert.deepEqual(crossing({ prev: { ...prevState, eligible: ['a/visa:12'], r: null } }), []);
    assert.deepEqual(crossing({ stores: [], r: null }), []);
    assert.deepEqual(crossing({ prev: { ...prevState, eligible: [] } }), []);
  });

  test('is silent when aplica_a is not mejor_vp, and when the target is disabled', () => {
    assert.deepEqual(crossing({ globalRules: { ...globalRules, aplica_a: 'contado' } }), []);
    assert.deepEqual(crossing({ productRules: { precio_objetivo: 'no' } }), []);
  });

  test('does not produce series alerts for the card totals', () => {
    assert.ok(crossing({}).every((alert) => alert.kind === 'mejor_vp'));
  });
});
