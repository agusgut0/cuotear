/**
 * Comparison and verdict engine (DRT 12 and 13.1, RF-21, RN-11).
 *
 * Pure functions. Money is handled as integer centavos; present values use
 * double precision over centavos and are compared after rounding to the
 * nearest centavo. Percentages are computed as `dif * 100 / Pc` so exact
 * cases (such as -1.00 %) are exact.
 *
 * @typedef {'visa'|'mastercard'|'naranja'} Card
 * @typedef {'contado'|'cuotas'|'sin_veredicto'} Verdict
 *
 * @typedef {Object} CardOffer
 * @property {number} n number of interest-free installments (2..72)
 * @property {number} cuotaCents installment value, centavos
 * @property {number} totalCents published total, centavos
 *
 * @typedef {Object} OptionComparison
 * @property {number} difCents nominal difference T - Pc
 * @property {number} difPct nominal difference in percent of Pc
 * @property {number|null} vpCents present value of the installments (null without a rate)
 * @property {number|null} difVpCents VP - Pc
 * @property {number|null} difVpPct (VP - Pc) in percent of Pc
 * @property {Verdict} verdict
 * @property {boolean} marginal true when |difVpPct| is below the marginal threshold
 *
 * @typedef {{ tipo: 'contado', store: string } | { tipo: 'cuotas', store: string, card: Card, n: number }} BestOption
 *
 * @typedef {Object} StoreInput
 * @property {string} store
 * @property {number|null} contadoCents eligible cash price; null when the series is not eligible
 * @property {{ card: Card, offer: CardOffer }[]} cards eligible card series
 *
 * @typedef {Object} ProductComparison
 * @property {{ store: string, contadoCents: number|null, cards: { card: Card, offer: CardOffer, comparison: OptionComparison|null }[] }[]} stores
 *   per-store detail; a card is compared against the cash price of its own store
 * @property {Verdict} verdict
 * @property {boolean} marginal
 * @property {BestOption|null} best
 * @property {number|null} pcStarCents lowest eligible cash price
 * @property {number|null} vpStarCents lowest present value across all store x card options
 * @property {number|null} difVpCents
 * @property {number|null} difVpPct
 *
 * @typedef {Object} MonthlyRate
 * @property {number|null} r monthly rate as a fraction (0.03 = 3 %); null when no source is available
 * @property {'rem'|'rem-stale'|'backup'|'manual'|'none'} origin source: REM current, REM stale (older than 70 days or last stored value), manual fallback under `fuente: rem`, manual by choice, or none
 * @property {number} [annualPct] annual REM value in percent (REM origins only)
 * @property {string} [fecha] ISO date of the REM datum (REM origins only)
 */

export const MAX_INSTALLMENTS = 72;
export const DEFAULT_MARGINAL_PCT = 1;

/**
 * @param {number} r
 */
function assertRate(r) {
  if (!Number.isFinite(r) || r < 0) throw new RangeError(`monthly rate must be a finite number >= 0 (got ${r})`);
}

/**
 * @param {number} s
 */
function assertFirstInstallmentMonth(s) {
  if (s !== 0 && s !== 1) throw new RangeError(`first installment month s must be 0 or 1 (got ${s})`);
}

/**
 * @param {number} value
 * @param {string} name
 */
function assertPositiveCents(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer of centavos (got ${value})`);
}

/**
 * @param {CardOffer} offer
 */
function assertOffer({ n, cuotaCents, totalCents }) {
  if (!Number.isInteger(n) || n < 2 || n > MAX_INSTALLMENTS) {
    throw new RangeError(`n must be an integer between 2 and ${MAX_INSTALLMENTS} (got ${n})`);
  }
  assertPositiveCents(cuotaCents, 'cuotaCents');
  assertPositiveCents(totalCents, 'totalCents');
}

/**
 * Converts an annual inflation rate to the equivalent monthly rate:
 * r = (1 + A)^(1/12) - 1.
 * @param {number} annualPct annual rate in percent (40 = 40 %)
 * @returns {number} monthly rate as a fraction
 */
export function annualToMonthlyRate(annualPct) {
  if (!Number.isFinite(annualPct) || annualPct < 0) throw new RangeError(`annual rate must be a finite number >= 0 (got ${annualPct})`);
  return (1 + annualPct / 100) ** (1 / 12) - 1;
}

/**
 * Resolves the monthly rate from the manual part of the configuration (the
 * REM part lives in `src/inflation/resolve.js`, which calls this as its
 * fallback): with `fuente: manual` the manual value is used; with
 * `fuente: rem` (REM unavailable here) the manual value acts as backup; without a manual value there is no rate
 * and the verdict is "sin veredicto" (DRT 13.4, RF-21).
 * @param {{ fuente: 'rem'|'manual', manual?: import('../config/types.js').ManualInflation }} inflation
 * @returns {MonthlyRate}
 */
export function resolveMonthlyRate({ fuente, manual }) {
  if (manual === undefined) return { r: null, origin: 'none' };
  const r = manual.periodo === 'anual' ? annualToMonthlyRate(manual.pct) : manual.pct / 100;
  assertRate(r);
  return { r, origin: fuente === 'manual' ? 'manual' : 'backup' };
}

/**
 * Present value of the installments: VP = sum_{k=1..n} C / (1 + r)^(s + k - 1).
 * With r = 0 it is n x C for any s.
 * @param {CardOffer} offer
 * @param {number} r monthly rate as a fraction, >= 0
 * @param {0|1} s month of the first installment
 * @returns {number} present value in centavos (full precision, not rounded)
 */
export function presentValueCents(offer, r, s) {
  assertOffer(offer);
  assertRate(r);
  assertFirstInstallmentMonth(s);
  if (r === 0) return offer.n * offer.cuotaCents;
  let total = 0;
  for (let k = 1; k <= offer.n; k += 1) total += offer.cuotaCents / (1 + r) ** (s + k - 1);
  return total;
}

/**
 * Compares one card option against a cash price (RF-21 points 1 to 4).
 * Without a rate only the nominal difference is computed and the verdict is
 * "sin_veredicto".
 * @param {{ pcCents: number, offer: CardOffer, r: number|null, s: 0|1, marginalPct?: number }} input
 * @returns {OptionComparison}
 */
export function compareOption({ pcCents, offer, r, s, marginalPct = DEFAULT_MARGINAL_PCT }) {
  assertPositiveCents(pcCents, 'pcCents');
  assertOffer(offer);
  assertFirstInstallmentMonth(s);

  const difCents = offer.totalCents - pcCents;
  const nominal = { difCents, difPct: (difCents * 100) / pcCents };
  if (r === null) {
    return { ...nominal, vpCents: null, difVpCents: null, difVpPct: null, verdict: 'sin_veredicto', marginal: false };
  }

  const vpCents = presentValueCents(offer, r, s);
  const difVpCents = vpCents - pcCents;
  const difVpPct = (difVpCents * 100) / pcCents;
  return {
    ...nominal,
    vpCents,
    difVpCents,
    difVpPct,
    verdict: Math.round(vpCents) < pcCents ? 'cuotas' : 'contado',
    marginal: Math.abs(difVpPct) < marginalPct,
  };
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Product-level verdict (RF-21 point 5, DRT 13.1): the lowest cash price among
 * eligible stores against the lowest present value among all eligible
 * store x card options. Ties go to cash; remaining ties are broken by store
 * id, card and n so the result is deterministic.
 * @param {{ stores: StoreInput[], r: number|null, s: 0|1, marginalPct?: number }} input
 * @returns {ProductComparison}
 */
export function compareProduct({ stores, r, s, marginalPct = DEFAULT_MARGINAL_PCT }) {
  const detail = stores.map(({ store, contadoCents, cards }) => ({
    store,
    contadoCents,
    cards: cards.map(({ card, offer }) => ({
      card,
      offer,
      comparison: contadoCents === null ? null : compareOption({ pcCents: contadoCents, offer, r, s, marginalPct }),
    })),
  }));

  const cash = stores
    .filter((entry) => entry.contadoCents !== null)
    .map((entry) => ({ store: entry.store, cents: /** @type {number} */ (entry.contadoCents) }))
    .sort((a, b) => a.cents - b.cents || byText(a.store, b.store))[0];

  const installments =
    r === null
      ? []
      : stores
          .flatMap((entry) => entry.cards.map(({ card, offer }) => ({ store: entry.store, card, n: offer.n, vpCents: presentValueCents(offer, r, s) })))
          .sort((a, b) => a.vpCents - b.vpCents || byText(a.store, b.store) || byText(a.card, b.card) || a.n - b.n);
  const cheapest = installments[0];

  const base = { stores: detail, pcStarCents: cash?.cents ?? null, vpStarCents: cheapest?.vpCents ?? null };
  if (cash === undefined || cheapest === undefined) {
    return { ...base, verdict: 'sin_veredicto', marginal: false, best: null, difVpCents: null, difVpPct: null };
  }

  const difVpCents = cheapest.vpCents - cash.cents;
  const difVpPct = (difVpCents * 100) / cash.cents;
  const cuotas = Math.round(cheapest.vpCents) < cash.cents;
  return {
    ...base,
    verdict: cuotas ? 'cuotas' : 'contado',
    marginal: Math.abs(difVpPct) < marginalPct,
    best: cuotas
      ? { tipo: 'cuotas', store: cheapest.store, card: cheapest.card, n: cheapest.n }
      : { tipo: 'contado', store: cash.store },
    difVpCents,
    difVpPct,
  };
}
