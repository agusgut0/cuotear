import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cardSerie, counterKey, isEligible, observeStore, seriesStatus, updateCounters } from '../../src/core/series.js';

/**
 * @param {Partial<import('../../src/stores/types.js').StoreResult>} [overrides]
 * @returns {import('../../src/stores/types.js').StoreResult}
 */
function ok(overrides = {}) {
  return {
    outcome: 'ok',
    listaCents: 100_000_00,
    contado: { valorCents: 100_000_00, medio: 'debito', descuentoPct: 0 },
    tarjetas: {
      visa: { n: 12, cuotaCents: 8_333_33, totalCents: 100_000_00 },
      mastercard: { n: 6, cuotaCents: 16_666_67, totalCents: 100_000_00 },
      naranja: null,
    },
    meta: { requests: 1, ms: 1 },
    ...overrides,
  };
}

/** @type {import('../../src/stores/types.js').StoreResult} */
const FAILED = { outcome: 'falla', failure: { kind: 'blocked', detail: 'x' }, meta: { requests: 1, ms: 1 } };

describe('observations (DRT 7)', () => {
  test('a successful measurement observes cash and each offered card, keyed by card and n', () => {
    const observations = observeStore(ok(), []);
    assert.deepEqual(
      observations.map((o) => [o.serie, o.kind]),
      [
        ['contado', 'ok'],
        ['visa:12', 'ok'],
        ['mastercard:6', 'ok'],
      ],
    );
    assert.deepEqual(observations[1], { serie: 'visa:12', kind: 'ok', data: { total: 100_000_00, cuota: 8_333_33, n: 12 } });
  });

  test('RN-08: a card with another n closes the old series and opens the new one', () => {
    const observations = observeStore(ok(), ['contado', 'visa:6', 'mastercard:6']);
    assert.deepEqual(
      observations.filter((o) => o.serie.startsWith('visa')).map((o) => [o.serie, o.kind, 'estado' in o ? o.estado : undefined]),
      [
        ['visa:6', 'estado', 'cerrada'],
        ['visa:12', 'ok', undefined],
      ],
    );
  });

  test('a URL failure is a failure of every open series, including cash', () => {
    const observations = observeStore(FAILED, ['visa:12', 'mastercard:6']);
    assert.deepEqual(observations.map((o) => [o.serie, o.kind]), [
      ['contado', 'falla'],
      ['visa:12', 'falla'],
      ['mastercard:6', 'falla'],
    ]);
  });

  test('sin_stock and sin_oferta move every open series to that state, not to failure (RN-06)', () => {
    for (const outcome of /** @type {const} */ (['sin_stock', 'sin_oferta'])) {
      const observations = observeStore({ outcome, meta: { requests: 1, ms: 1 } }, ['visa:12']);
      assert.deepEqual(observations, [
        { serie: 'contado', kind: 'estado', estado: outcome },
        { serie: 'visa:12', kind: 'estado', estado: outcome },
      ]);
    }
  });

  test('a card that is no longer offered goes to sin_oferta; an invalid card fails only its own series (RF-14)', () => {
    const gone = observeStore(ok({ tarjetas: { visa: null, mastercard: null, naranja: null } }), ['contado', 'visa:12']);
    assert.deepEqual(gone.find((o) => o.serie === 'visa:12'), { serie: 'visa:12', kind: 'estado', estado: 'sin_oferta' });

    const invalid = observeStore(ok({ tarjetas: { visa: { invalida: true, motivo: 'x' }, mastercard: null, naranja: null } }), ['contado', 'visa:12']);
    assert.deepEqual(invalid.map((o) => [o.serie, o.kind]), [
      ['contado', 'ok'],
      ['visa:12', 'falla'],
    ]);
  });

  test('a cash price that could not be interpreted fails only the cash series (S-05)', () => {
    const observations = observeStore(ok({ contado: { fallido: true } }), []);
    assert.deepEqual(observations.slice(0, 2).map((o) => [o.serie, o.kind]), [
      ['contado', 'falla'],
      ['visa:12', 'ok'],
    ]);
  });
});

describe('failure counters (RF-15, S-01, S-32)', () => {
  const at = '2026-11-22T12:00:00Z';
  const key = counterKey('tv', 'oncity', 'contado');

  /** @param {import('../../src/core/series.js').Counters} counters @param {import('../../src/stores/types.js').StoreResult} result @param {string[]} [open] */
  const run = (counters, result, open = []) => updateCounters(counters, { productId: 'tv', store: 'oncity', observations: observeStore(result, open), at });

  test('N = 4 consecutive failures show "sin datos"; 1 to 3 show "fallida"; a success resets', () => {
    let counters = run({}, ok());
    const statuses = [];
    for (let i = 0; i < 4; i += 1) {
      counters = run(counters, FAILED, ['visa:12', 'mastercard:6']);
      statuses.push(seriesStatus({ lastEstado: 'ok', failures: counters[key]?.failures }));
    }
    assert.deepEqual(statuses, ['fallida', 'fallida', 'fallida', 'sin_datos']);
    assert.equal(counters[counterKey('tv', 'oncity', 'visa:12')]?.failures, 4, 'every open series counts the URL failure');

    counters = run(counters, ok(), ['visa:12', 'mastercard:6']);
    assert.equal(counters[key]?.failures, 0);
    assert.equal(seriesStatus({ lastEstado: 'ok', failures: 0 }), 'valida');
  });

  test('sin_stock and sin_oferta neither count nor reset the counter (S-32)', () => {
    let counters = run({}, FAILED);
    counters = run(counters, FAILED);
    counters = run(counters, { outcome: 'sin_stock', meta: { requests: 1, ms: 1 } });
    counters = run(counters, { outcome: 'sin_oferta', meta: { requests: 1, ms: 1 } });
    assert.equal(counters[key]?.failures, 2);
    for (let i = 0; i < 20; i += 1) counters = run(counters, { outcome: 'sin_stock', meta: { requests: 1, ms: 1 } });
    assert.equal(counters[key]?.failures, 2);
  });

  test('an invalid card counts only for that series', () => {
    const invalid = ok({ tarjetas: { visa: { invalida: true, motivo: 'x' }, mastercard: null, naranja: null } });
    const counters = run({}, invalid, ['visa:12']);
    assert.equal(counters[counterKey('tv', 'oncity', 'visa:12')]?.failures, 1);
    assert.equal(counters[key]?.failures, 0);
  });

  test('a closed series drops its counter and the new series starts at 0 (RN-08)', () => {
    let counters = run({}, FAILED, ['visa:6']);
    assert.equal(counters[counterKey('tv', 'oncity', 'visa:6')]?.failures, 1);
    counters = run(counters, ok(), ['visa:6']);
    assert.equal(counters[counterKey('tv', 'oncity', 'visa:6')], undefined);
    assert.equal(counters[counterKey('tv', 'oncity', 'visa:12')]?.failures, 0);
  });

  test('the input counters are not modified', () => {
    const before = { [key]: { failures: 1 } };
    run(before, FAILED);
    assert.deepEqual(before, { [key]: { failures: 1 } });
  });

  test('after a state loss the last valid date can be recovered from the history', () => {
    const counters = updateCounters({}, { productId: 'tv', store: 'oncity', observations: observeStore(FAILED, []), at, lastValid: () => '2026-11-20T00:00:00Z' });
    assert.deepEqual(counters[key], { failures: 1, lastValidAt: '2026-11-20T00:00:00Z' });
  });
});

describe('status and eligibility (S-26)', () => {
  test('statuses', () => {
    assert.equal(seriesStatus({ lastEstado: 'ok', failures: 0 }), 'valida');
    assert.equal(seriesStatus({ lastEstado: 'ok', failures: 3 }), 'fallida');
    assert.equal(seriesStatus({ lastEstado: 'ok', failures: 4 }), 'sin_datos');
    assert.equal(seriesStatus({ lastEstado: 'ok', failures: 2, failuresForNoData: 2 }), 'sin_datos');
    assert.equal(seriesStatus({ lastEstado: 'sin_stock' }), 'sin_stock');
    assert.equal(seriesStatus({ lastEstado: 'sin_oferta' }), 'sin_datos');
    assert.equal(seriesStatus({ lastEstado: 'cerrada', failures: 9 }), 'cerrada');
    assert.equal(seriesStatus({ failures: 1 }), 'fallida');
    assert.equal(seriesStatus({}), 'sin_datos');
  });

  test('only a valid series is eligible', () => {
    assert.deepEqual(
      /** @type {const} */ (['valida', 'fallida', 'sin_datos', 'sin_stock', 'cerrada']).map(isEligible),
      [true, false, false, false, false],
    );
  });

  test('cardSerie builds the key from card and n', () => {
    assert.equal(cardSerie('naranja', 12), 'naranja:12');
  });
});
