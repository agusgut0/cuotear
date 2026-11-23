import { compareProduct } from '../core/compare.js';
import { lastOkPoint } from '../core/history.js';
import { cardOfSerie, CONTADO, cardSerie } from '../core/series.js';

/**
 * What the site and the run state need about one product after a run: the
 * series records, the history and the comparison over the eligible series.
 *
 * @typedef {import('../core/record.js').SeriesRecord} SeriesRecord
 * @typedef {import('../core/history.js').HistoryPoint} HistoryPoint
 *
 * @typedef {Object} ProductView
 * @property {string} id
 * @property {string} nombre untrusted text from the configuration
 * @property {Record<string, string>} urls store id -> product URL
 * @property {readonly SeriesRecord[]} records
 * @property {readonly HistoryPoint[]} points history after this run
 * @property {import('../core/compare.js').ProductComparison} comparison
 */

/**
 * Eligible series (S-26) turned into the input of the comparison engine: the
 * values are those of the last valid point of each series.
 * @param {readonly string[]} stores store ids in configuration order
 * @param {readonly SeriesRecord[]} records
 * @param {readonly HistoryPoint[]} points
 * @returns {import('../core/compare.js').StoreInput[]}
 */
export function storeInputs(stores, records, points) {
  return stores.map((store) => {
    /** @type {import('../core/compare.js').StoreInput} */
    const input = { store, contadoCents: null, cards: [] };
    for (const record of records) {
      if (record.store !== store || !record.eligible) continue;
      const point = lastOkPoint(points, store, record.serie);
      if (point === undefined) continue;
      if (record.serie === CONTADO) {
        input.contadoCents = point.valor ?? null;
        continue;
      }
      const card = cardOfSerie(record.serie);
      if (card !== null && point.n !== undefined && point.cuota !== undefined && point.total !== undefined) {
        input.cards.push({ card, offer: { n: point.n, cuotaCents: point.cuota, totalCents: point.total } });
      }
    }
    return input;
  });
}

/**
 * @param {{
 *   product: import('../config/types.js').Product,
 *   records: readonly SeriesRecord[],
 *   points: readonly HistoryPoint[],
 *   r: number|null,
 *   s: 0|1,
 *   marginalPct: number,
 * }} input
 * @returns {ProductView}
 */
export function buildView({ product, records, points, r, s, marginalPct }) {
  const comparison = compareProduct({ stores: storeInputs(Object.keys(product.urls), records, points), r, s, marginalPct });
  return { id: product.id, nombre: product.nombre, urls: product.urls, records, points, comparison };
}

/**
 * The best option in the shape the run state keeps (`prevBest`).
 * @param {import('../core/compare.js').ProductComparison} comparison
 * @param {number|null} r
 * @returns {import('../state/schema.js').RunState['prevBest'][string] | null}
 */
export function bestForState(comparison, r) {
  const { best } = comparison;
  if (best === null) return null;
  if (best.tipo === 'contado') return { tipo: 'contado', tienda: best.store, serie: CONTADO, valorCents: comparison.pcStarCents ?? 0, r };
  return { tipo: 'cuotas', tienda: best.store, serie: cardSerie(best.card, best.n), valorCents: Math.round(comparison.vpStarCents ?? 0), r };
}
