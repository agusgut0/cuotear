import { recordProduct } from '../../src/core/record.js';
import { buildView } from '../../src/pipeline/view.js';

/**
 * Builds site models from synthetic store results by running the real
 * recording and comparison code, so the pages are tested on realistic data.
 */

/** @param {Partial<import('../../src/stores/types.js').StoreResult> & { cash?: number }} [overrides] @returns {import('../../src/stores/types.js').StoreResult} */
export function okResult({ cash = 100_000_000, ...overrides } = {}) {
  return {
    outcome: 'ok',
    listaCents: cash,
    contado: { valorCents: cash, medio: 'transferencia', descuentoPct: 0 },
    tarjetas: {
      visa: { n: 12, cuotaCents: Math.round(cash / 12), totalCents: cash },
      mastercard: null,
      naranja: null,
    },
    meta: { requests: 1, ms: 1 },
    ...overrides,
  };
}

/** @type {import('../../src/stores/types.js').StoreResult} */
export const FAILED = { outcome: 'falla', failure: { kind: 'blocked', detail: 'test' }, meta: { requests: 1, ms: 1 } };

/**
 * @param {{ id?: string, nombre?: string, urls?: Record<string, string>, runs: { at: string, result: import('../../src/stores/types.js').StoreResult }[], r?: number|null }} input
 * @returns {import('../../src/pipeline/view.js').ProductView}
 */
export function simulate({ id = 'producto', nombre = 'Producto de prueba', urls = { oncity: 'https://www.oncity.com/producto/p' }, runs, r = 0.025 }) {
  /** @type {import('../../src/core/history.js').HistoryPoint[]} */
  let points = [];
  let counters = {};
  /** @type {readonly import('../../src/core/record.js').SeriesRecord[]} */
  let records = [];
  for (const { at, result } of runs) {
    const recorded = recordProduct({ productId: id, points, measurements: [{ store: 'oncity', result }], counters, now: new Date(at) });
    points = recorded.points;
    counters = recorded.counters;
    records = recorded.series;
  }
  return buildView({ product: { id, nombre, urls }, records, points, r, s: 1, marginalPct: 1 });
}

/**
 * @param {import('../../src/pipeline/view.js').ProductView[]} products
 * @param {Partial<import('../../src/site/build.js').SiteModel>} [overrides]
 * @returns {import('../../src/site/build.js').SiteModel}
 */
export function siteModel(products, overrides = {}) {
  return {
    builtAt: new Date('2026-11-22T13:00:00Z'),
    products,
    rate: { r: 0.025, origin: 'manual' },
    s: 1,
    staleHours: 12,
    marginalPct: 1,
    usingFallbackConfig: false,
    storeNames: { oncity: 'On City' },
    failingStores: [],
    ...overrides,
  };
}
