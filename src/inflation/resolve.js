import { annualToMonthlyRate, resolveMonthlyRate } from '../core/compare.js';
import { fetchBcraRem, MAX_ANNUAL_PCT, parseIsoDate } from './bcra.js';

/**
 * Inflation source resolution (DRT 13.4, ADR-0010): REM from the BCRA API with
 * the chain last state value (stale) -> manual from the configuration (backup)
 * -> no rate.
 *
 * @typedef {NonNullable<import('../state/schema.js').RunState['inflation']>} StoredInflation
 *
 * @typedef {Object} ResolvedInflation
 * @property {import('../core/compare.js').MonthlyRate} rate
 * @property {StoredInflation|undefined} inflation what to persist in `state.inflation`
 * @property {boolean} queried whether the BCRA API was queried in this call
 */

/** A datum is current while its `fecha` is at most this old. */
export const FRESH_DAYS = 70;
const DAY_MS = 24 * 3600 * 1000;

/**
 * @param {string} fecha ISO date
 * @param {Date} now
 * @returns {boolean}
 */
const isFresh = (fecha, now) => {
  const time = parseIsoDate(fecha);
  // Whole UTC days: 70 days old is still current.
  return time !== null && Math.floor(now.getTime() / DAY_MS) * DAY_MS - time <= FRESH_DAYS * DAY_MS;
};

/**
 * @param {StoredInflation} value
 * @param {Date} now
 * @returns {import('../core/compare.js').MonthlyRate}
 */
const remRate = (value, now) => ({
  r: annualToMonthlyRate(value.anualPct),
  origin: isFresh(value.fecha, now) ? 'rem' : 'rem-stale',
  annualPct: value.anualPct,
  fecha: value.fecha,
});

/**
 * @param {unknown} stored
 * @param {Date} now
 * @returns {StoredInflation|undefined} the stored REM value if it is usable
 */
function usableStored(stored, now) {
  if (typeof stored !== 'object' || stored === null) return undefined;
  const value = /** @type {StoredInflation} */ (stored);
  if (value.fuente !== 'rem' || !Number.isFinite(value.anualPct) || value.anualPct <= 0 || value.anualPct > MAX_ANNUAL_PCT || !Number.isFinite(Date.parse(value.obtainedAt))) return undefined;
  // Same rules as the API response: a real calendar date, at most one day ahead.
  const fecha = parseIsoDate(value.fecha);
  return fecha !== null && fecha <= now.getTime() + DAY_MS ? value : undefined;
}

/**
 * @param {{
 *   settings: { fuente: 'rem'|'manual', manual?: import('../config/types.js').ManualInflation },
 *   state: Pick<import('../state/schema.js').RunState, 'inflation'>,
 *   ctx: import('../http/client.js').FetchContext,
 *   now: Date,
 *   log?: (line: string) => void,
 * }} input
 * @returns {Promise<ResolvedInflation>}
 */
export async function resolveInflation({ settings, state, ctx, now, log = () => {} }) {
  if (settings.fuente === 'manual') return { rate: resolveMonthlyRate(settings), inflation: state.inflation, queried: false };

  const stored = usableStored(state.inflation, now);
  // At most one query per UTC day: a datum obtained today is reused (one stamped in the future is not).
  if (stored !== undefined && stored.obtainedAt.slice(0, 10) === now.toISOString().slice(0, 10) && Date.parse(stored.obtainedAt) <= now.getTime()) {
    return { rate: remRate(stored, now), inflation: stored, queried: false };
  }

  const fetched = await fetchBcraRem(ctx, now);
  if (fetched.ok) {
    /** @type {StoredInflation} */
    const value = { fuente: 'rem', anualPct: fetched.anualPct, fecha: fetched.fecha, obtainedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z') };
    return { rate: remRate(value, now), inflation: value, queried: true };
  }

  log(`::warning::cuotear: BCRA REM unavailable (${fetched.reason}); falling back`);
  if (stored !== undefined) return { rate: remRate(stored, now), inflation: stored, queried: true };
  // resolveMonthlyRate marks a manual value used under `rem` as backup, or none.
  // An unusable stored value is not persisted back.
  return { rate: resolveMonthlyRate(settings), inflation: undefined, queried: true };
}
