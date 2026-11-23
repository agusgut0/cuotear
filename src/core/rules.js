import { buildBestChangeAlert, buildMejorVpAlert, buildSeriesAlert } from './alerts.js';
import { presentValueCents } from './compare.js';
import { lastOkPoint } from './history.js';
import { cardOfSerie, cardSerie, CONTADO } from './series.js';

/**
 * Alert rules engine (DRT 13.2, RF-22, RN-12, RN-13, S-10, S-31). Pure
 * functions: no I/O, no clock, nothing is wired into the pipeline here.
 * Money is integer centavos (ADR-0012); the configuration states amounts in
 * pesos and is converted here.
 *
 * Rules, per product:
 * - `baja_minima_pct`, `baja_minima_monto`, implicit `baja_estricta`: one
 *   series (cash, or card + n; never the present value), previous valid
 *   value against the current one. Thresholds are inclusive.
 * - `precio_objetivo` with `aplica_a` `contado` / `total_cuotas`: per series,
 *   crossing `prev > objetivo >= current`.
 * - `precio_objetivo` with `aplica_a` `mejor_vp`: crossing of the best present
 *   value over E (series eligible in both runs) with the previous rate, and
 *   the real best present value (current rate) must also be <= objetivo.
 * - `cambio_mejor_opcion`: best option over E with the previous rate, before
 *   and after; the real best option must equal the current best over E.
 *
 * @typedef {import('./history.js').HistoryPoint} HistoryPoint
 * @typedef {import('./alerts.js').Alert} Alert
 * @typedef {import('./alerts.js').RuleName} RuleName
 * @typedef {import('../config/types.js').AlertRules} AlertRules
 * @typedef {import('../config/types.js').AppliesTo} AppliesTo
 *
 * @typedef {Object} ResolvedRules
 * @property {boolean} implicit no rule key exists at any level: implicit "baja estricta" (`baja > 0`)
 * @property {number|null} bajaPct `baja_minima_pct` in percent; null when absent or disabled
 * @property {number|null} bajaMontoCents `baja_minima_monto` in centavos; null when absent or disabled
 * @property {number|null} objetivoCents `precio_objetivo` in centavos; null when absent or disabled
 * @property {AppliesTo} aplicaA
 * @property {boolean} cambioMejorOpcion
 *
 * What the run state remembered about the product after the previous run.
 * Pass `undefined` instead when that state was lost (S-25): the rules that
 * need it (`mejor_vp`, `cambio_mejor_opcion`) stay silent.
 * @typedef {Object} PreviousProductState
 * @property {readonly string[]} eligible `<store>/<serie>` eligible in the previous run (`state.eligible[product]`)
 * @property {number|null} r monthly rate used in the previous run (`state.prevBest[product].r`)
 * @property {0|1} s first-installment month used in the previous run
 * @property {string} configHash hash of the product's configuration in the previous run
 * @property {{ tipo: 'contado'|'cuotas', tienda: string, serie: string }|null} best previous real best option (`state.prevBest[product]`)
 *
 * @typedef {Object} EvaluateInput
 * @property {string} productId
 * @property {AlertRules} [globalRules] `alertas.reglas`
 * @property {AlertRules} [productRules] `productos[].reglas`
 * @property {readonly HistoryPoint[]} prevPoints history before this run
 * @property {readonly HistoryPoint[]} added points appended by this run (`RecordResult.added`)
 * @property {readonly string[]} eligible `<store>/<serie>` eligible now
 * @property {PreviousProductState} [prev] undefined when the state was lost
 * @property {readonly import('./compare.js').StoreInput[]} stores eligible series of this run grouped by store (input of the comparison engine)
 * @property {number|null} r current monthly rate
 * @property {0|1} s current first-installment month
 * @property {string} configHash hash of the product's current configuration
 * @property {string} t run timestamp (UTC ISO 8601), stored as `detectedAt`
 * @property {number} [verificarBajaPct] `operacion.verificar_baja_pct`; default 90
 */

export const DEFAULT_VERIFY_DROP_PCT = 90;

const RULE_KEYS = /** @type {const} */ (['baja_minima_pct', 'baja_minima_monto', 'precio_objetivo', 'cambio_mejor_opcion']);

/**
 * Pesos to centavos.
 * @param {number} pesos
 * @returns {number}
 */
const toCents = (pesos) => Math.round(pesos * 100);

/**
 * @param {number|false|'no'|undefined} value
 * @returns {number|null} the positive threshold, or null when absent/disabled
 */
const threshold = (value) => (typeof value === 'number' && value > 0 ? value : null);

/**
 * Resolves the effective rules of a product (S-10, S-31): per rule, the
 * product value replaces the global one (even when it is `false`/`"no"`).
 * `aplica_a` resolves product, then global, then `contado`. When none of the
 * four rule keys exists at any level the implicit strict-drop rule applies;
 * when keys exist but all are disabled there are no alerts.
 * @param {AlertRules|undefined} globalRules
 * @param {AlertRules|undefined} productRules
 * @returns {ResolvedRules}
 */
export function resolveRules(globalRules, productRules) {
  const global = globalRules ?? {};
  const product = productRules ?? {};
  const implicit = RULE_KEYS.every((key) => global[key] === undefined && product[key] === undefined);
  const pct = threshold(product.baja_minima_pct !== undefined ? product.baja_minima_pct : global.baja_minima_pct);
  const monto = threshold(product.baja_minima_monto !== undefined ? product.baja_minima_monto : global.baja_minima_monto);
  const objetivo = threshold(product.precio_objetivo !== undefined ? product.precio_objetivo : global.precio_objetivo);
  const cambio = product.cambio_mejor_opcion !== undefined ? product.cambio_mejor_opcion : global.cambio_mejor_opcion;
  return {
    implicit,
    bajaPct: pct,
    bajaMontoCents: monto === null ? null : toCents(monto),
    objetivoCents: objetivo === null ? null : toCents(objetivo),
    aplicaA: product.aplica_a ?? global.aplica_a ?? 'contado',
    cambioMejorOpcion: cambio === true,
  };
}

/**
 * The value a series is compared on: the cash price, or the card total.
 * @param {HistoryPoint} point
 * @returns {number|undefined}
 */
const valueOf = (point) => (point.serie === CONTADO ? point.valor : point.total);

/**
 * Rules satisfied by one series going from `prev` to `current` (centavos).
 * @param {{ rules: ResolvedRules, serie: string, prev: number, current: number }} input
 * @returns {RuleName[]}
 */
function seriesRules({ rules, serie, prev, current }) {
  /** @type {RuleName[]} */
  const satisfied = [];
  const drop = prev - current;
  if (drop > 0) {
    if (rules.implicit) satisfied.push('baja_estricta');
    if (rules.bajaPct !== null && (drop * 100) / prev >= rules.bajaPct) satisfied.push('baja_minima_pct');
    if (rules.bajaMontoCents !== null && drop >= rules.bajaMontoCents) satisfied.push('baja_minima_monto');
  }
  const aimed = (rules.aplicaA === 'contado' && serie === CONTADO) || (rules.aplicaA === 'total_cuotas' && serie !== CONTADO);
  if (aimed && rules.objetivoCents !== null && prev > rules.objetivoCents && rules.objetivoCents >= current) satisfied.push('precio_objetivo');
  return satisfied;
}

/**
 * Series alerts: one per (product, series) with a point appended in this run
 * that is `ok`, listing every satisfied rule. RN-12: without a previous `ok`
 * point of the same series there is nothing to compare and no alert.
 * @param {EvaluateInput} input
 * @param {ResolvedRules} rules
 * @returns {Alert[]}
 */
function seriesAlerts({ productId, prevPoints, added, t, verificarBajaPct = DEFAULT_VERIFY_DROP_PCT }, rules) {
  /** @type {Alert[]} */
  const alerts = [];
  for (const point of added) {
    if (point.estado !== 'ok') continue;
    const current = valueOf(point);
    const previous = lastOkPoint(prevPoints, point.tienda, point.serie);
    const prev = previous === undefined ? undefined : valueOf(previous);
    if (current === undefined || previous === undefined || prev === undefined) continue;
    const satisfied = seriesRules({ rules, serie: point.serie, prev, current });
    if (satisfied.length === 0) continue;
    alerts.push(
      buildSeriesAlert({
        productId,
        tienda: point.tienda,
        serie: point.serie,
        rules: satisfied,
        prevT: previous.t,
        prevCents: prev,
        currentCents: current,
        verifyPct: verificarBajaPct,
        ...(satisfied.includes('precio_objetivo') && rules.objetivoCents !== null ? { objetivoCents: rules.objetivoCents } : {}),
        ...(point.serie === CONTADO && point.medio !== undefined ? { medio: point.medio } : {}),
        ...(point.serie === CONTADO && point.desc !== undefined ? { desc: point.desc } : {}),
        detectedAt: t,
      }),
    );
  }
  return alerts;
}

/**
 * A set of valid points keyed by `<store>/<serie>`.
 * @typedef {Map<string, HistoryPoint>} Snapshot
 */

/**
 * Points of the series in E, from the last `ok` point of each in `points`.
 * @param {readonly HistoryPoint[]} points
 * @param {readonly string[]} keys
 * @returns {Snapshot}
 */
function snapshotOf(points, keys) {
  /** @type {Snapshot} */
  const snapshot = new Map();
  for (const key of keys) {
    const cut = key.indexOf('/');
    const point = lastOkPoint(points, key.slice(0, cut), key.slice(cut + 1));
    if (point !== undefined) snapshot.set(key, point);
  }
  return snapshot;
}


/**
 * @param {Snapshot} snapshot
 * @returns {import('./compare.js').StoreInput[]}
 */
function storeInputsOf(snapshot) {
  /** @type {Map<string, import('./compare.js').StoreInput>} */
  const stores = new Map();
  for (const point of snapshot.values()) {
    let input = stores.get(point.tienda);
    if (input === undefined) {
      input = { store: point.tienda, contadoCents: null, cards: [] };
      stores.set(point.tienda, input);
    }
    if (point.serie === CONTADO) {
      input.contadoCents = point.valor ?? null;
      continue;
    }
    const brand = cardOfSerie(point.serie);
    if (brand !== null && point.n !== undefined && point.cuota !== undefined && point.total !== undefined) {
      input.cards.push({ card: brand, offer: { n: point.n, cuotaCents: point.cuota, totalCents: point.total } });
    }
  }
  return [...stores.values()];
}

/**
 * @typedef {Object} Option one cash price or one card plan, valued in centavos
 * @property {'contado'|'cuotas'} tipo
 * @property {string} tienda
 * @property {string} serie
 * @property {number} valueCents cash price, or present value rounded to the centavo (DRT 12)
 */

/**
 * @param {readonly import('./compare.js').StoreInput[]} stores
 * @param {number} r
 * @param {0|1} s
 * @returns {Option[]}
 */
function optionsOf(stores, r, s) {
  /** @type {Option[]} */
  const options = [];
  for (const { store, contadoCents, cards } of stores) {
    if (contadoCents !== null) options.push({ tipo: 'contado', tienda: store, serie: CONTADO, valueCents: contadoCents });
    for (const { card, offer } of cards) options.push({ tipo: 'cuotas', tienda: store, serie: cardSerie(card, offer.n), valueCents: Math.round(presentValueCents(offer, r, s)) });
  }
  return options;
}

/**
 * @param {{ tipo: string, tienda: string, serie: string }} ref
 * @returns {string}
 */
const refKey = (ref) => `${ref.tipo}:${ref.tienda}/${ref.serie}`;

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
const text = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Lowest-value option of a class. Ties keep `hold` (S-10), then go by store
 * and series so the result is deterministic.
 * @param {readonly Option[]} options
 * @param {{ tipo: string, tienda: string, serie: string }|null} hold
 * @returns {Option|undefined}
 */
function cheapest(options, hold) {
  const holdKey = hold === null ? '' : refKey(hold);
  return [...options].sort((a, b) => a.valueCents - b.valueCents || Number(refKey(b) === holdKey) - Number(refKey(a) === holdKey) || text(a.tienda, b.tienda) || text(a.serie, b.serie))[0];
}

/**
 * Best option (DRT 13.1): the cheapest present value wins only if it is
 * strictly below the cheapest cash price; with only one class, that class
 * wins (a cash-only product still has a best option for RF-22).
 * @param {readonly import('./compare.js').StoreInput[]} stores
 * @param {number} r
 * @param {0|1} s
 * @param {{ tipo: string, tienda: string, serie: string }|null} hold
 * @returns {Option|null}
 */
function bestOf(stores, r, s, hold) {
  const options = optionsOf(stores, r, s);
  const cash = cheapest(
    options.filter((option) => option.tipo === 'contado'),
    hold,
  );
  const plan = cheapest(
    options.filter((option) => option.tipo === 'cuotas'),
    hold,
  );
  if (cash === undefined) return plan ?? null;
  return plan !== undefined && plan.valueCents < cash.valueCents ? plan : cash;
}

/**
 * Comparable set E and its before/after snapshots, or null when the rules
 * that need the previous state must stay silent.
 * @param {EvaluateInput} input
 * @returns {{ before: Snapshot, after: Snapshot, rPrev: number, prevT: string, prev: PreviousProductState }|null}
 */
function comparableSet({ prev, prevPoints, added, eligible }) {
  if (prev === undefined || prev.r === null) return null;
  const now = new Set(eligible);
  const before = snapshotOf(
    prevPoints,
    prev.eligible.filter((key) => now.has(key)),
  );
  if (before.size === 0) return null;
  const after = snapshotOf([...prevPoints, ...added], [...before.keys()]);
  const prevT = [...before.values()].map((point) => point.t).sort()[before.size - 1] ?? '';
  return { before, after, rPrev: prev.r, prevT, prev };
}

/**
 * `precio_objetivo` with `aplica_a = mejor_vp`: one alert per product.
 * @param {EvaluateInput} input
 * @param {ResolvedRules} rules
 * @returns {Alert[]}
 */
function mejorVpAlerts(input, rules) {
  if (rules.aplicaA !== 'mejor_vp' || rules.objetivoCents === null || input.r === null) return [];
  const set = comparableSet(input);
  if (set === null) return [];

  /**
   * @param {readonly import('./compare.js').StoreInput[]} stores
   * @param {number} r
   * @returns {number|null}
   */
  const bestVp = (stores, r) => {
    const values = optionsOf(stores, r, input.s)
      .filter((option) => option.tipo === 'cuotas')
      .map((option) => option.valueCents);
    return values.length === 0 ? null : Math.min(...values);
  };
  const before = bestVp(storeInputsOf(set.before), set.rPrev);
  const after = bestVp(storeInputsOf(set.after), set.rPrev);
  const realCents = bestVp(input.stores, input.r);
  if (before === null || after === null || realCents === null) return [];
  if (!(before > rules.objetivoCents && rules.objetivoCents >= after && realCents <= rules.objetivoCents)) return [];
  return [buildMejorVpAlert({ productId: input.productId, prevT: set.prevT, prevCents: before, currentCents: after, realCents, objetivoCents: rules.objetivoCents, detectedAt: input.t })];
}

/**
 * `cambio_mejor_opcion`: one alert per product. Silent when the state was
 * lost, the product configuration hash or `s` changed, or the difference
 * comes only from series entering or leaving E (or from the rate: E is
 * always evaluated with the previous rate).
 * @param {EvaluateInput} input
 * @param {ResolvedRules} rules
 * @returns {Alert[]}
 */
function bestChangeAlerts(input, rules) {
  if (!rules.cambioMejorOpcion || input.r === null) return [];
  const set = comparableSet(input);
  if (set === null || set.prev.configHash !== input.configHash || set.prev.s !== input.s) return [];
  const previous = bestOf(storeInputsOf(set.before), set.rPrev, input.s, set.prev.best);
  const current = previous === null ? null : bestOf(storeInputsOf(set.after), set.rPrev, input.s, previous);
  if (previous === null || current === null || refKey(previous) === refKey(current)) return [];
  const actual = bestOf(input.stores, input.r, input.s, current);
  if (actual === null || refKey(actual) !== refKey(current)) return [];
  return [buildBestChangeAlert({ productId: input.productId, prevT: set.prevT, previous, current, detectedAt: input.t })];
}

/**
 * Evaluates the alert rules of one product for one run (DRT 13.2).
 * Returns the alerts in a deterministic order: series alerts (store, series),
 * then `mejor_vp`, then `cambio_mejor_opcion`. All rules disabled, or none
 * satisfied, gives an empty list.
 * @param {EvaluateInput} input
 * @returns {Alert[]}
 */
export function evaluateProduct(input) {
  const rules = resolveRules(input.globalRules, input.productRules);
  const series = seriesAlerts(input, rules).sort((a, b) => (a.kind === 'serie' && b.kind === 'serie' ? text(a.tienda, b.tienda) || text(a.serie, b.serie) : 0));
  return [...series, ...mejorVpAlerts(input, rules), ...bestChangeAlerts(input, rules)];
}

/**
 * The real best option of a product in the definition the rules use
 * (`cambio_mejor_opcion`, DRT 13.2): the run state keeps it as `prevBest`, so
 * both sides agree. A cash-only product, or one without card plans, still has
 * a best option; without a rate only cash can be valued, so the result is
 * null when there is no rate (the rules stay silent then).
 * @param {{ stores: readonly import('./compare.js').StoreInput[], r: number|null, s: 0|1, hold?: { tipo: string, tienda: string, serie: string }|null }} input
 * @returns {{ tipo: 'contado'|'cuotas', tienda: string, serie: string, valueCents: number }|null}
 */
export function bestOption({ stores, r, s, hold = null }) {
  return r === null ? null : bestOf(stores, r, s, hold);
}
