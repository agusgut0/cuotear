import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { causeText, computeCauses } from '../../src/pipeline/ops-causes.js';
import { summaryLines, summaryMarkdown } from '../../src/pipeline/summary.js';

/**
 * @param {string} store
 * @param {Record<string, number>} outcomes
 * @param {Record<string, number>} [failures]
 * @returns {import('../../src/pipeline/measure.js').StoreReport}
 */
const report = (store, outcomes, failures = {}) => ({ store, urls: Object.values(outcomes).reduce((a, b) => a + b, 0), outcomes, failures, requests: 1, ms: 5 });

describe('computeCauses (RNF-12, RNF-15)', () => {
  test('no reports, or healthy stores: no cause', () => {
    assert.deepEqual(computeCauses([]), []);
    assert.deepEqual(computeCauses([report('oncity', { ok: 1 }), report('naldo', { ok: 2 })]), []);
  });

  test('one robots failure opens robots:<store> only', () => {
    assert.deepEqual(computeCauses([report('oncity', { ok: 1 }), report('naldo', { falla: 1 }, { robots: 1 }), report('megatone', { ok: 1 })]), ['robots:naldo']);
  });

  test('several stores are sorted', () => {
    const reports = [report('naldo', { ok: 1, falla: 1 }, { robots: 1 }), report('carrefour', { falla: 1 }, { robots: 2 }), report('oncity', { ok: 1 })];
    assert.deepEqual(computeCauses(reports), ['robots:carrefour', 'robots:naldo']);
  });

  test('every measured URL failing opens todas-tiendas-fallan', () => {
    assert.deepEqual(computeCauses([report('oncity', { falla: 1 }, { http: 1 }), report('naldo', { falla: 2 }, { timeout: 2 })]), ['todas-tiendas-fallan']);
  });

  test('a mix of failures and successes does not open todas-tiendas-fallan', () => {
    assert.deepEqual(computeCauses([report('oncity', { falla: 1 }, { http: 1 }), report('naldo', { ok: 1 })]), []);
    assert.deepEqual(computeCauses([report('oncity', { falla: 1, ok: 1 }, { http: 1 })]), []);
  });

  test('zero measured URLs: no cause', () => {
    assert.deepEqual(computeCauses([report('oncity', {})]), []);
  });

  test('when everything fails because of robots both causes appear, sorted and without duplicates', () => {
    assert.deepEqual(computeCauses([report('oncity', { falla: 3 }, { robots: 3 })]), ['robots:oncity', 'todas-tiendas-fallan']);
  });
});

describe('operational notices in the summary', () => {
  /** @param {string[]} avisos @returns {import('../../src/pipeline/summary.js').RunSummary} */
  const summary = (avisos) => ({
    dryRun: false,
    configKind: 'repo',
    products: 1,
    rate: { r: null, origin: 'none' },
    s: 1,
    stores: [report('oncity', { falla: 1 }, { robots: 1 })],
    avisos,
    pointsAdded: 0,
    pointsPurged: 0,
    seriesOpened: 0,
    seriesClosed: 0,
    filesWritten: 0,
    filesRemoved: 0,
    requests: 1,
    durationMs: 10,
    stateRebuilt: false,
  });

  test('notices are listed in the log lines and a markdown table', () => {
    const value = summary(['robots:oncity']);
    assert.ok(summaryLines(value).some((line) => line === `[cuotear] notice robots:oncity: ${causeText('robots:oncity')}`));
    const markdown = summaryMarkdown(value);
    assert.match(markdown, /### Operational notices/);
    assert.match(markdown, /\| `robots:oncity` \|/);
  });

  test('without notices there is no section', () => {
    assert.doesNotMatch(summaryMarkdown(summary([])), /Operational notices/);
    assert.ok(!summaryLines(summary([])).some((line) => line.includes('notice')));
  });
});

describe('computeCauses and causeText: edge cases (RNF-15)', () => {
  test('causeText falls back to a neutral text for an unknown cause', () => {
    assert.equal(causeText('something-else'), 'operational notice');
    assert.equal(causeText(''), 'operational notice');
  });

  test('a store whose outcomes mix falla and sin_stock does not open todas-tiendas-fallan', () => {
    assert.deepEqual(computeCauses([report('megatone', { falla: 1, sin_stock: 1 }, { http: 1 })]), []);
    assert.deepEqual(computeCauses([report('oncity', { falla: 1 }, { http: 1 }), report('megatone', { sin_stock: 2 })]), []);
  });
});
