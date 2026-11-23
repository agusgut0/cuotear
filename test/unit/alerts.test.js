import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';
import { alertId, buildBestChangeAlert, buildMejorVpAlert, buildSeriesAlert, sortRules } from '../../src/core/alerts.js';

const sha256 = (/** @type {string} */ text) => createHash('sha256').update(text).digest('hex');

describe('alertId (DRT 13.3)', () => {
  const base = { productId: 'tcl-75t6c', serie: 'oncity/contado', prevT: '2026-11-22T12:00:00Z', prevCents: 100_000_000, currentCents: 94_000_000, rules: /** @type {const} */ (['baja_minima_pct']) };

  test('is the sha256 of the pipe-joined fields', () => {
    assert.equal(alertId(base), sha256('tcl-75t6c|oncity/contado|2026-11-22T12:00:00Z|100000000|94000000|baja_minima_pct'));
  });

  test('is stable for the same change and independent of the order of the rules', () => {
    const a = alertId({ ...base, rules: ['precio_objetivo', 'baja_minima_pct'] });
    const b = alertId({ ...base, rules: ['baja_minima_pct', 'precio_objetivo', 'baja_minima_pct'] });
    assert.equal(a, b);
    assert.equal(a, sha256('tcl-75t6c|oncity/contado|2026-11-22T12:00:00Z|100000000|94000000|baja_minima_pct,precio_objetivo'));
    assert.equal(alertId(base), alertId({ ...base }));
  });

  test('changes with any field', () => {
    const id = alertId(base);
    for (const change of [{ productId: 'otro' }, { serie: 'oncity/visa:12' }, { prevT: '2026-11-22T18:00:00Z' }, { prevCents: 100_000_001 }, { currentCents: 93_999_999 }, { rules: /** @type {const} */ (['baja_estricta']) }]) {
      assert.notEqual(alertId({ ...base, ...change }), id, JSON.stringify(change));
    }
  });
});

describe('sortRules', () => {
  test('dedupes and uses the canonical order', () => {
    assert.deepEqual(sortRules(['cambio_mejor_opcion', 'precio_objetivo', 'baja_minima_monto', 'precio_objetivo', 'baja_estricta']), ['baja_estricta', 'baja_minima_monto', 'precio_objetivo', 'cambio_mejor_opcion']);
  });
});

describe('buildSeriesAlert', () => {
  const input = { productId: 'p', tienda: 'oncity', serie: 'contado', rules: /** @type {const} */ (['baja_minima_monto', 'baja_minima_pct']), prevT: '2026-11-22T12:00:00Z', prevCents: 100_000_000, currentCents: 90_000_000, verifyPct: 90, detectedAt: '2026-11-23T00:00:00Z' };

  test('computes the drop and lists the rules in canonical order', () => {
    const alert = buildSeriesAlert(input);
    assert.equal(alert.kind, 'serie');
    assert.deepEqual(alert.rules, ['baja_minima_pct', 'baja_minima_monto']);
    assert.equal(alert.dropCents, 10_000_000);
    assert.equal(alert.dropPct, 10);
    assert.equal(alert.verify, false);
    assert.equal(alert.id, alertId({ productId: 'p', serie: 'oncity/contado', prevT: input.prevT, prevCents: 100_000_000, currentCents: 90_000_000, rules: ['baja_minima_pct', 'baja_minima_monto'] }));
    assert.equal('objetivoCents' in alert, false);
  });

  test('"a verificar" is strict: exactly 90 % is not flagged, above it is', () => {
    assert.equal(buildSeriesAlert({ ...input, currentCents: 10_000_000 }).verify, false);
    assert.equal(buildSeriesAlert({ ...input, currentCents: 9_999_999 }).verify, true);
  });

  test('the same alert detected twice has the same id (retry after a failed commit)', () => {
    assert.equal(buildSeriesAlert(input).id, buildSeriesAlert({ ...input, detectedAt: '2026-11-24T00:00:00Z' }).id);
  });
});

describe('product alerts', () => {
  test('best-change ids depend on the options and values', () => {
    const previous = /** @type {const} */ ({ tipo: 'contado', tienda: 'a', serie: 'contado', valueCents: 100 });
    const current = /** @type {const} */ ({ tipo: 'cuotas', tienda: 'a', serie: 'visa:12', valueCents: 90 });
    const alert = buildBestChangeAlert({ productId: 'p', prevT: 't', previous, current, detectedAt: 'd' });
    assert.equal(alert.id, sha256('p|cambio_mejor_opcion:contado:a/contado>cuotas:a/visa:12|t|100|90|cambio_mejor_opcion'));
    assert.notEqual(alert.id, buildBestChangeAlert({ productId: 'p', prevT: 't', previous: current, current: previous, detectedAt: 'd' }).id);
  });

  test('mejor_vp id', () => {
    const alert = buildMejorVpAlert({ productId: 'p', prevT: 't', prevCents: 120, currentCents: 108, realCents: 107, objetivoCents: 110, detectedAt: 'd' });
    assert.equal(alert.id, sha256('p|mejor_vp|t|120|108|mejor_vp'));
    assert.equal(alert.realCents, 107);
  });
});
