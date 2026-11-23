import { createHash } from 'node:crypto';

/**
 * Alert objects and their deduplication id (DRT 13.2 and 13.3, RF-22, RF-23).
 * Pure: no I/O, no clock. Alerts are plain JSON so they can live in
 * `state.pendingAlerts` and be retried.
 *
 * @typedef {'baja_estricta'|'baja_minima_pct'|'baja_minima_monto'|'precio_objetivo'|'mejor_vp'|'cambio_mejor_opcion'} RuleName
 *
 * @typedef {Object} BestRef identity of a best option (type, store, series) and its value
 * @property {'contado'|'cuotas'} tipo
 * @property {string} tienda
 * @property {string} serie `contado` or `<card>:<n>`
 * @property {number} valueCents cash price, or present value rounded to the centavo
 *
 * @typedef {Object} SeriesAlert one per (product, series), listing every satisfied rule
 * @property {'serie'} kind
 * @property {string} id
 * @property {string} productId
 * @property {string} tienda
 * @property {string} serie
 * @property {RuleName[]} rules satisfied rules, in canonical order
 * @property {string} prevT timestamp of the previous valid point
 * @property {number} prevCents
 * @property {number} currentCents
 * @property {number} dropCents prevCents - currentCents (> 0)
 * @property {number} dropPct dropCents * 100 / prevCents
 * @property {boolean} verify RN-13: the drop exceeds `verificar_baja_pct`, "a verificar"
 * @property {number} [objetivoCents] present when `precio_objetivo` fired
 * @property {string} [medio] cash condition of the current point (`transferencia`, `debito`...); only for the cash series, only to render the alert
 * @property {number|null} [desc] cash discount of the current point, percent
 * @property {string} detectedAt run timestamp (used to discard stale pending alerts)
 *
 * @typedef {Object} BestChangeAlert one per product
 * @property {'cambio_mejor_opcion'} kind
 * @property {string} id
 * @property {string} productId
 * @property {RuleName[]} rules
 * @property {string} prevT newest valid point of the previous history among the compared series
 * @property {BestRef} previous best option on the comparable set, with previous values
 * @property {BestRef} current best option with current values
 * @property {string} detectedAt
 *
 * @typedef {Object} MejorVpAlert one per product
 * @property {'mejor_vp'} kind
 * @property {string} id
 * @property {string} productId
 * @property {RuleName[]} rules
 * @property {string} prevT
 * @property {number} prevCents VP* with previous values and the previous rate
 * @property {number} currentCents VP* with current values and the previous rate
 * @property {number} realCents VP* with current values and the current rate
 * @property {number} objetivoCents
 * @property {string} detectedAt
 *
 * @typedef {SeriesAlert | BestChangeAlert | MejorVpAlert} Alert
 */

/** Canonical order of the rules inside an alert (stable ids). */
export const RULE_ORDER = /** @type {const} */ (['baja_estricta', 'baja_minima_pct', 'baja_minima_monto', 'precio_objetivo', 'mejor_vp', 'cambio_mejor_opcion']);

/**
 * @param {readonly RuleName[]} rules
 * @returns {RuleName[]} without duplicates, canonical order
 */
export const sortRules = (rules) => RULE_ORDER.filter((rule) => rules.includes(rule));

/**
 * `sha256(productoId | serie | tPuntoPrevio | prevCents | actualCents | regla(s))`
 * (DRT 13.3), hex. `serie` is `<store>/<serie>` for series alerts and the
 * alert kind for product alerts. The same change detected again (for example
 * after a failed commit) yields the same id.
 * @param {{ productId: string, serie: string, prevT: string, prevCents: number, currentCents: number, rules: readonly RuleName[] }} input
 * @returns {string}
 */
export function alertId({ productId, serie, prevT, prevCents, currentCents, rules }) {
  const text = [productId, serie, prevT, String(prevCents), String(currentCents), sortRules(rules).join(',')].join('|');
  return createHash('sha256').update(text).digest('hex');
}

/**
 * @param {{
 *   productId: string, tienda: string, serie: string, rules: readonly RuleName[],
 *   prevT: string, prevCents: number, currentCents: number, verifyPct: number,
 *   objetivoCents?: number, medio?: string, desc?: number|null, detectedAt: string,
 * }} input
 * @returns {SeriesAlert}
 */
export function buildSeriesAlert({ productId, tienda, serie, rules, prevT, prevCents, currentCents, verifyPct, objetivoCents, medio, desc, detectedAt }) {
  const ordered = sortRules(rules);
  const dropCents = prevCents - currentCents;
  const dropPct = (dropCents * 100) / prevCents;
  return {
    kind: 'serie',
    id: alertId({ productId, serie: `${tienda}/${serie}`, prevT, prevCents, currentCents, rules: ordered }),
    productId,
    tienda,
    serie,
    rules: ordered,
    prevT,
    prevCents,
    currentCents,
    dropCents,
    dropPct,
    verify: dropPct > verifyPct,
    ...(objetivoCents === undefined ? {} : { objetivoCents }),
    ...(medio === undefined ? {} : { medio }),
    ...(desc === undefined ? {} : { desc }),
    detectedAt,
  };
}

/**
 * @param {BestRef} ref
 * @returns {string}
 */
const refKey = (ref) => `${ref.tipo}:${ref.tienda}/${ref.serie}`;

/**
 * @param {{ productId: string, prevT: string, previous: BestRef, current: BestRef, detectedAt: string }} input
 * @returns {BestChangeAlert}
 */
export function buildBestChangeAlert({ productId, prevT, previous, current, detectedAt }) {
  return {
    kind: 'cambio_mejor_opcion',
    id: alertId({
      productId,
      serie: `cambio_mejor_opcion:${refKey(previous)}>${refKey(current)}`,
      prevT,
      prevCents: previous.valueCents,
      currentCents: current.valueCents,
      rules: ['cambio_mejor_opcion'],
    }),
    productId,
    rules: ['cambio_mejor_opcion'],
    prevT,
    previous,
    current,
    detectedAt,
  };
}

/**
 * @param {{ productId: string, prevT: string, prevCents: number, currentCents: number, realCents: number, objetivoCents: number, detectedAt: string }} input
 * @returns {MejorVpAlert}
 */
export function buildMejorVpAlert({ productId, prevT, prevCents, currentCents, realCents, objetivoCents, detectedAt }) {
  return {
    kind: 'mejor_vp',
    id: alertId({ productId, serie: 'mejor_vp', prevT, prevCents, currentCents, rules: ['mejor_vp'] }),
    productId,
    rules: ['mejor_vp'],
    prevT,
    prevCents,
    currentCents,
    realCents,
    objetivoCents,
    detectedAt,
  };
}
