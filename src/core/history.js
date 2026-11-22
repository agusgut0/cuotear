import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

/**
 * Price history: points, change detection, retention and deterministic
 * JSON Lines serialization (DRT 8, RF-24, RN-06, ADR-0003). Pure functions:
 * file access lives in `history-files.js`.
 *
 * A point is appended ONLY when the value, condition, list price,
 * installments or the state (ok | sin_stock | sin_oferta | cerrada) of a
 * series changes. Failures never produce points: they live in the failure
 * counters of the run state (RF-15).
 *
 * @typedef {import('./series.js').Observation} Observation
 * @typedef {import('./series.js').ContadoData} ContadoData
 * @typedef {import('./series.js').CardData} CardData
 * @typedef {'ok'|'sin_stock'|'sin_oferta'|'cerrada'} Estado
 *
 * @typedef {Object} HistoryPoint
 * @property {string} t UTC ISO 8601, second precision
 * @property {string} tienda store id
 * @property {string} serie `contado` or `<card>:<n>`
 * @property {Estado} estado
 * @property {number} [valor] cash price, centavos
 * @property {number} [lista] list price, centavos
 * @property {import('../stores/types.js').Medio} [medio]
 * @property {number|null} [desc] discount percent
 * @property {number} [total] card total, centavos
 * @property {number} [cuota] installment value, centavos
 * @property {number} [n] installments
 */

/** Months of history kept besides the last point of each series (S-13). */
export const DEFAULT_RETENTION_MONTHS = 12;

/** Property order of a serialized point: stable so diffs are minimal. */
const KEY_ORDER = /** @type {const} */ (['t', 'tienda', 'serie', 'estado', 'valor', 'lista', 'medio', 'desc', 'total', 'cuota', 'n']);

/** @type {import('ajv').ValidateFunction | undefined} */
let compiledSchema;

/** @returns {import('ajv').ValidateFunction} */
function pointValidator() {
  compiledSchema ??= new Ajv2020.default({ allErrors: false, strict: true, strictRequired: false }).compile(JSON.parse(readFileSync(new URL('./history.schema.json', import.meta.url), 'utf8')));
  return compiledSchema;
}

/**
 * @param {Date} date
 * @returns {string} `2026-11-22T12:17:41Z`
 */
export const formatTimestamp = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Identity of a series inside one product's history.
 * @param {{ tienda: string, serie: string }} point
 * @returns {string}
 */
export const pointSeriesKey = (point) => `${point.tienda}/${point.serie}`;

/**
 * Last point of each series, by order in the file (`<store>/<serie>` -> point).
 * @param {readonly HistoryPoint[]} points
 * @returns {Map<string, HistoryPoint>}
 */
export function lastPoints(points) {
  /** @type {Map<string, HistoryPoint>} */
  const last = new Map();
  for (const point of points) last.set(pointSeriesKey(point), point);
  return last;
}

/**
 * The last valid value of a series (RN-06: on restock the new value is
 * compared against this one).
 * @param {readonly HistoryPoint[]} points
 * @param {string} tienda
 * @param {string} serie
 * @returns {HistoryPoint | undefined}
 */
export function lastOkPoint(points, tienda, serie) {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const point = /** @type {HistoryPoint} */ (points[i]);
    if (point.tienda === tienda && point.serie === serie && point.estado === 'ok') return point;
  }
  return undefined;
}

/**
 * Series of a store whose last point is not `cerrada`.
 * @param {readonly HistoryPoint[]} points
 * @param {string} tienda
 * @returns {string[]}
 */
export function openSeriesOf(points, tienda) {
  return [...lastPoints(points).values()].filter((point) => point.tienda === tienda && point.estado !== 'cerrada').map((point) => point.serie);
}

/** @param {Observation} observation @param {string} tienda @param {string} t @returns {HistoryPoint | null} */
function candidate(observation, tienda, t) {
  if (observation.kind === 'falla') return null;
  if (observation.kind === 'estado') return { t, tienda, serie: observation.serie, estado: observation.estado };
  return { t, tienda, serie: observation.serie, estado: 'ok', ...observation.data };
}

/**
 * Do two points carry the same information, ignoring the timestamp?
 * @param {HistoryPoint} a
 * @param {HistoryPoint} b
 * @returns {boolean}
 */
function sameContent(a, b) {
  return KEY_ORDER.every((key) => key === 't' || a[key] === b[key]);
}

/**
 * Points to append for a store's observations: only those that change the
 * last point of their series (value, condition, list, installments or state).
 * @param {{ tienda: string, observations: readonly Observation[], previous: ReadonlyMap<string, HistoryPoint>, t: string }} input
 * @returns {HistoryPoint[]}
 */
export function changedPoints({ tienda, observations, previous, t }) {
  /** @type {HistoryPoint[]} */
  const added = [];
  for (const observation of observations) {
    const point = candidate(observation, tienda, t);
    if (point === null) continue;
    const last = previous.get(pointSeriesKey(point));
    if (last === undefined || !sameContent(last, point)) added.push(point);
  }
  return added;
}

/**
 * Retention (RF-24, S-13): drops the points older than `months` calendar
 * months, EXCEPT the last point of each series, which always stays (a value
 * unchanged for 13 months is still the current price).
 * @param {readonly HistoryPoint[]} points
 * @param {Date} now
 * @param {number} [months]
 * @returns {{ points: HistoryPoint[], removed: number }}
 */
export function purge(points, now, months = DEFAULT_RETENTION_MONTHS) {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  const cutoffText = formatTimestamp(cutoff);
  const keep = new Set(lastPoints(points).values());
  const kept = points.filter((point) => point.t >= cutoffText || keep.has(point));
  return { points: kept, removed: points.length - kept.length };
}

/**
 * @param {HistoryPoint} a
 * @param {HistoryPoint} b
 * @returns {number}
 */
const byTimeThenSerie = (a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0) || (a.serie < b.serie ? -1 : a.serie > b.serie ? 1 : 0) || (a.tienda < b.tienda ? -1 : a.tienda > b.tienda ? 1 : 0);

/**
 * Deterministic JSON Lines: stable key order, points sorted by time, serie and
 * store (stable, so lines already in order never move), one line per point and
 * a trailing newline. Empty history is the empty string.
 * @param {readonly HistoryPoint[]} points
 * @returns {string}
 */
export function serializeHistory(points) {
  const ordered = [...points].sort(byTimeThenSerie);
  return ordered
    .map((point) => `${JSON.stringify(Object.fromEntries(KEY_ORDER.filter((key) => point[key] !== undefined).map((key) => [key, point[key]])))}\n`)
    .join('');
}

/**
 * Parses a history file. Lines that are not valid points are ignored and
 * counted: they never break a run (DRT 8.1).
 * @param {string} text
 * @returns {{ points: HistoryPoint[], ignored: number }}
 */
export function parseHistory(text) {
  const validate = pointValidator();
  /** @type {HistoryPoint[]} */
  const points = [];
  let ignored = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      /** @type {unknown} */
      const parsed = JSON.parse(line);
      if (validate(parsed) && isConsistent(/** @type {HistoryPoint} */ (parsed))) points.push(/** @type {HistoryPoint} */ (parsed));
      else ignored += 1;
    } catch {
      ignored += 1;
    }
  }
  return { points, ignored };
}

/**
 * The `n` of a card point must match its serie key.
 * @param {HistoryPoint} point
 * @returns {boolean}
 */
function isConsistent(point) {
  const [, n] = point.serie.split(':');
  return n === undefined || point.estado !== 'ok' || point.n === Number(n);
}
