import { changedPoints, DEFAULT_RETENTION_MONTHS, formatTimestamp, lastOkPoint, lastPoints, openSeriesOf, purge } from './history.js';
import { counterKey, DEFAULT_FAILURES_FOR_NO_DATA, isEligible, observeStore, seriesStatus, updateCounters } from './series.js';

/**
 * Combines series, counters and history for one product and one run
 * (DRT 7 and 8): turns the store results into the points to append, the
 * updated failure counters and the status of every series. Pure.
 *
 * @typedef {import('./history.js').HistoryPoint} HistoryPoint
 * @typedef {import('./series.js').Counters} Counters
 * @typedef {import('./series.js').SeriesStatus} SeriesStatus
 *
 * @typedef {Object} SeriesRecord
 * @property {string} store
 * @property {string} serie
 * @property {SeriesStatus} status
 * @property {boolean} eligible
 * @property {number} failures
 * @property {string} [lastValidAt] last valid measurement (state, else the last `ok` point)
 * @property {HistoryPoint} [last] last history point of the series
 *
 * @typedef {Object} RecordResult
 * @property {HistoryPoint[]} points history after this run (new points appended, retention applied)
 * @property {HistoryPoint[]} added points appended by this run
 * @property {number} removed points dropped by the retention
 * @property {Counters} counters
 * @property {SeriesRecord[]} series
 */

/**
 * @param {{
 *   productId: string,
 *   points: readonly HistoryPoint[],
 *   measurements: readonly { store: string, result: import('../stores/types.js').StoreResult }[],
 *   counters: Counters,
 *   now: Date,
 *   failuresForNoData?: number,
 *   retentionMonths?: number,
 * }} input
 * @returns {RecordResult}
 */
export function recordProduct({ productId, points, measurements, counters, now, failuresForNoData = DEFAULT_FAILURES_FOR_NO_DATA, retentionMonths = DEFAULT_RETENTION_MONTHS }) {
  const t = formatTimestamp(now);
  const previous = lastPoints(points);

  /** @type {HistoryPoint[]} */
  const added = [];
  let updated = counters;
  for (const { store, result } of measurements) {
    const observations = observeStore(result, openSeriesOf(points, store));
    updated = updateCounters(updated, { productId, store, observations, at: t, lastValid: (serie) => lastOkPoint(points, store, serie)?.t });
    added.push(...changedPoints({ tienda: store, observations, previous, t }));
  }

  const purged = purge([...points, ...added], now, retentionMonths);
  return {
    points: purged.points,
    added,
    removed: purged.removed,
    counters: updated,
    series: statusesOf({ productId, points: purged.points, counters: updated, failuresForNoData }),
  };
}

/**
 * Status of every series of a product, from its history and counters.
 * @param {{ productId: string, points: readonly HistoryPoint[], counters: Counters, failuresForNoData?: number }} input
 * @returns {SeriesRecord[]}
 */
export function statusesOf({ productId, points, counters, failuresForNoData = DEFAULT_FAILURES_FOR_NO_DATA }) {
  const last = lastPoints(points);
  const prefix = `${productId}|`;
  const keys = new Set([...last.keys(), ...Object.keys(counters).filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length))]);

  return [...keys].sort().map((key) => {
    const [store = '', serie = ''] = [key.slice(0, key.indexOf('/')), key.slice(key.indexOf('/') + 1)];
    const counter = counters[counterKey(productId, store, serie)];
    const lastPoint = last.get(key);
    const failures = counter?.failures ?? 0;
    const status = seriesStatus({ ...(lastPoint ? { lastEstado: lastPoint.estado } : {}), failures, failuresForNoData });
    const lastValidAt = counter?.lastValidAt ?? lastOkPoint(points, store, serie)?.t;
    return { store, serie, status, eligible: isEligible(status), failures, ...(lastValidAt === undefined ? {} : { lastValidAt }), ...(lastPoint ? { last: lastPoint } : {}) };
  });
}
