import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { HARD_BYTES, limitHistory, SIZE_CAUSE_HARD, SIZE_CAUSE_WARN, sizeLevel, SOFT_BYTES, WARN_BYTES } from '../../src/core/history-size.js';
import { serializeHistory } from '../../src/core/history.js';

const NOW = new Date('2026-11-22T12:00:00Z');
const MB = 1024 * 1024;

/** A point inflated by a long store name so a few thousand lines reach tens of MB. */
const point = (/** @type {string} */ t, /** @type {number} */ pad, /** @type {string} */ serie = 'contado') => ({ t, tienda: 'x'.repeat(pad), serie, estado: /** @type {const} */ ('ok'), valor: 100 });

/** @param {number} targetBytes @param {string} serie */
function pointsOfSize(targetBytes, serie) {
  const pad = 1000;
  const count = Math.ceil(targetBytes / (pad + 70));
  return Array.from({ length: count }, (_, i) => point(`2026-11-0${1 + (i % 9)}T00:00:${String(i % 60).padStart(2, '0')}Z`, pad, `${serie}${i}`));
}

describe('sizeLevel', () => {
  test('thresholds: 45 MB warns, above 50 MB is soft, above 100 MB is hard', () => {
    assert.equal(sizeLevel(WARN_BYTES - 1), 'ok');
    assert.equal(sizeLevel(WARN_BYTES), 'warn');
    assert.equal(sizeLevel(SOFT_BYTES), 'warn');
    assert.equal(sizeLevel(SOFT_BYTES + 1), 'soft');
    assert.equal(sizeLevel(HARD_BYTES), 'soft');
    assert.equal(sizeLevel(HARD_BYTES + 1), 'hard');
  });
});

describe('limitHistory', () => {
  test('small history: everything proposed is written, no cause', () => {
    const proposed = [point('2026-11-01T00:00:00Z', 3)];
    const result = limitHistory({ products: [{ id: 'a', previous: [], proposed }], now: NOW });
    assert.deepEqual(result.writes.get('a'), proposed);
    assert.equal(result.cause, null);
    assert.equal(result.frozen, false);
  });

  test('between 45 and 100 MB: warns but still records the new points', () => {
    const previous = pointsOfSize(46 * MB, 'a');
    const proposed = [...previous, point('2026-11-22T00:00:00Z', 3, 'nueva')];
    const result = limitHistory({ products: [{ id: 'a', previous, proposed }], now: NOW });
    assert.equal(result.cause, SIZE_CAUSE_WARN);
    assert.equal(result.frozen, false);
    assert.equal(result.writes.get('a')?.length, proposed.length);
  });

  test('above 50 MB the warning stays (soft limit) and points are still recorded', () => {
    const previous = pointsOfSize(51 * MB, 'a');
    const proposed = [...previous, point('2026-11-22T00:00:00Z', 3, 'nueva')];
    const result = limitHistory({ products: [{ id: 'a', previous, proposed }], now: NOW });
    assert.equal(result.level, 'soft');
    assert.equal(result.cause, SIZE_CAUSE_WARN);
    assert.equal(result.writes.get('a')?.length, proposed.length);
  });

  test('above 100 MB the new points are dropped and the previous ones are kept', () => {
    const previous = pointsOfSize(99.9 * MB, 'a');
    const added = pointsOfSize(0.5 * MB, 'b');
    const result = limitHistory({ products: [{ id: 'a', previous, proposed: [...previous, ...added] }], now: NOW });
    assert.equal(result.frozen, true);
    assert.equal(result.cause, SIZE_CAUSE_HARD);
    assert.equal(result.writes.get('a')?.length, previous.length);
    assert.equal(serializeHistory(result.writes.get('a') ?? []), serializeHistory(previous));
  });

  test('when frozen, retention still applies so the history can shrink back', () => {
    const old = pointsOfSize(60 * MB, 'old').map((p) => ({ ...p, t: '2024-01-01T00:00:00Z' }));
    const recent = pointsOfSize(40.5 * MB, 'new');
    const added = pointsOfSize(1 * MB, 'add');
    const result = limitHistory({ products: [{ id: 'a', previous: [...old, ...recent], proposed: [...old, ...recent, ...added] }], now: NOW, retentionMonths: 12 });
    assert.equal(result.frozen, true);
    // old points are dropped except the last point of each (distinct) series
    assert.ok((result.writes.get('a')?.length ?? 0) >= recent.length);
  });

  test('size is the sum over products', () => {
    const half = pointsOfSize(24 * MB, 'a');
    const result = limitHistory({
      products: [
        { id: 'a', previous: half, proposed: half },
        { id: 'b', previous: half, proposed: half },
      ],
      now: NOW,
    });
    assert.equal(result.cause, SIZE_CAUSE_WARN);
  });
});
