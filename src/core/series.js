/**
 * Series model, failure counters and eligibility (DRT 7, RF-15, RN-06, RN-08,
 * S-01, S-26, S-32). Pure functions: no I/O, no clock.
 *
 * A series is one comparable price stream of one store and product:
 * `contado`, or `<card>:<n>` (so a change of n opens a different series,
 * RN-08). Its key in the run state is `<productId>|<store>/<serie>`.
 *
 * @typedef {import('../stores/types.js').Card} Card
 * @typedef {import('../stores/types.js').StoreResult} StoreResult
 *
 * @typedef {{ valor: number, lista: number, medio: import('../stores/types.js').Medio, desc: number|null }} ContadoData
 * @typedef {{ total: number, cuota: number, n: number }} CardData
 *
 * What the current run says about one series.
 * @typedef {{ serie: string, kind: 'ok', data: ContadoData | CardData }
 *   | { serie: string, kind: 'estado', estado: 'sin_stock'|'sin_oferta'|'cerrada' }
 *   | { serie: string, kind: 'falla' }} Observation
 *
 * @typedef {{ failures: number, lastValidAt?: string }} SeriesCounter
 * @typedef {Record<string, SeriesCounter>} Counters
 * @typedef {'valida'|'fallida'|'sin_datos'|'sin_stock'|'cerrada'} SeriesStatus
 */

/** Consecutive failures before a series shows "sin datos" (S-01). */
export const DEFAULT_FAILURES_FOR_NO_DATA = 4;

export const CONTADO = 'contado';

const CARD_ORDER = /** @type {const} */ (['visa', 'mastercard', 'naranja']);

/**
 * @param {Card} card
 * @param {number} n
 * @returns {string}
 */
export const cardSerie = (card, n) => `${card}:${n}`;

/**
 * Key of a series in the run state.
 * @param {string} productId
 * @param {string} store
 * @param {string} serie
 * @returns {string}
 */
export const counterKey = (productId, store, serie) => `${productId}|${store}/${serie}`;

/**
 * @param {string} serie
 * @returns {Card | null}
 */
export function cardOfSerie(serie) {
  const card = serie.split(':')[0];
  return CARD_ORDER.find((candidate) => candidate === card) ?? null;
}

/**
 * Translates the result of measuring one URL into one observation per series
 * (DRT 7, RF-14, RF-15, RN-06, RN-08).
 *
 * - `falla`: a failure for every open series of the URL (S-32).
 * - `sin_stock` / `sin_oferta`: that state for every open series.
 * - `ok`: cash and each offered card; a card with another n closes the old
 *   series (RN-08); a card without an offer moves its open series to
 *   `sin_oferta`; an invalid card is a failure of its open series only.
 *
 * `contado` is always considered open, so a URL that has never been measured
 * successfully can still accumulate failures.
 * @param {StoreResult} result
 * @param {readonly string[]} openSeries series of this store whose last history point is not `cerrada`
 * @returns {Observation[]}
 */
export function observeStore(result, openSeries) {
  const open = [...new Set([CONTADO, ...openSeries])].sort(bySerieOrder);

  if (result.outcome === 'falla') return open.map((serie) => ({ serie, kind: 'falla' }));
  if (result.outcome === 'sin_stock' || result.outcome === 'sin_oferta') {
    const estado = result.outcome;
    return open.map((serie) => ({ serie, kind: 'estado', estado }));
  }

  /** @type {Observation[]} */
  const observations = [];
  const contado = result.contado;
  if (contado === undefined || 'fallido' in contado || result.listaCents === undefined) {
    observations.push({ serie: CONTADO, kind: 'falla' });
  } else {
    observations.push({ serie: CONTADO, kind: 'ok', data: { valor: contado.valorCents, lista: result.listaCents, medio: contado.medio, desc: contado.descuentoPct } });
  }

  for (const card of CARD_ORDER) {
    const existing = open.filter((serie) => cardOfSerie(serie) === card);
    const offer = result.tarjetas?.[card] ?? null;
    if (offer === null) {
      for (const serie of existing) observations.push({ serie, kind: 'estado', estado: 'sin_oferta' });
    } else if ('invalida' in offer) {
      for (const serie of existing) observations.push({ serie, kind: 'falla' });
    } else {
      const serie = cardSerie(card, offer.n);
      for (const old of existing) if (old !== serie) observations.push({ serie: old, kind: 'estado', estado: 'cerrada' });
      observations.push({ serie, kind: 'ok', data: { total: offer.totalCents, cuota: offer.cuotaCents, n: offer.n } });
    }
  }
  return observations;
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function bySerieOrder(a, b) {
  const rank = (/** @type {string} */ serie) => (serie === CONTADO ? -1 : CARD_ORDER.indexOf(/** @type {Card} */ (cardOfSerie(serie))));
  return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * Updates the failure counters with one URL's observations (RF-15, S-32).
 * A success resets the counter; a failure adds one; `sin_stock` and
 * `sin_oferta` leave it untouched; a closed series is dropped (the series
 * that replaces it starts at 0).
 * @param {Counters} counters
 * @param {{ productId: string, store: string, observations: readonly Observation[], at: string, lastValid?: (serie: string) => string | undefined }} input
 * @returns {Counters} a new object; the input is not modified
 */
export function updateCounters(counters, { productId, store, observations, at, lastValid }) {
  const next = { ...counters };
  for (const observation of observations) {
    const key = counterKey(productId, store, observation.serie);
    if (observation.kind === 'ok') {
      next[key] = { failures: 0, lastValidAt: at };
    } else if (observation.kind === 'falla') {
      const previous = next[key];
      const lastValidAt = previous?.lastValidAt ?? lastValid?.(observation.serie);
      next[key] = { failures: (previous?.failures ?? 0) + 1, ...(lastValidAt === undefined ? {} : { lastValidAt }) };
    } else if (observation.estado === 'cerrada') {
      delete next[key];
    }
  }
  return next;
}

/**
 * Status shown for a series (DRT 7). A closed series stays closed; otherwise
 * failures decide (N or more: "sin datos"; 1 to N-1: "fallida"), and with no
 * failures the last history point decides.
 * @param {{ lastEstado?: 'ok'|'sin_stock'|'sin_oferta'|'cerrada', failures?: number, failuresForNoData?: number }} input
 * @returns {SeriesStatus}
 */
export function seriesStatus({ lastEstado, failures = 0, failuresForNoData = DEFAULT_FAILURES_FOR_NO_DATA }) {
  if (lastEstado === 'cerrada') return 'cerrada';
  if (failures >= failuresForNoData) return 'sin_datos';
  if (failures > 0) return 'fallida';
  if (lastEstado === 'ok') return 'valida';
  if (lastEstado === 'sin_stock') return 'sin_stock';
  return 'sin_datos';
}

/**
 * Only a valid series may take part in the best option and the verdict (S-26, RN-06).
 * @param {SeriesStatus} status
 * @returns {boolean}
 */
export const isEligible = (status) => status === 'valida';
