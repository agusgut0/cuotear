/**
 * BCRA Estadisticas Monetarias v4.0, variable 29 (DRT 13.4, ADR-0010): median
 * of the 12-month-ahead CPI expectation of the REM, annual percent.
 *
 * The response is untrusted data: it is parsed as JSON and every field that is
 * used is validated; nothing else is read.
 *
 * @typedef {{ ok: true, anualPct: number, fecha: string } | { ok: false, reason: string }} BcraParse
 */

/** Single place for the base URL and the variable id (the API already changed version once). */
export const BCRA_VARIABLE_ID = 29;
export const BCRA_URL = `https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/${BCRA_VARIABLE_ID}`;

export const MAX_ANNUAL_PCT = 1000;
const MAX_ENTRIES = 5000;
const DAY_MS = 24 * 3600 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * @param {unknown} value
 * @returns {number|null} UTC midnight in ms of a real calendar date `YYYY-MM-DD`, else null
 */
export function parseIsoDate(value) {
  if (typeof value !== 'string') return null;
  const match = ISO_DATE.exec(value);
  if (match === null) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(time).toISOString().slice(0, 10) === value ? time : null;
}

/**
 * @param {string} body response text
 * @param {Date} now used to reject dates in the future (more than one day ahead)
 * @returns {BcraParse}
 */
export function parseBcraResponse(body, now) {
  /** @type {unknown} */
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, reason: 'invalid JSON' };
  }
  if (!isRecord(json) || !Object.hasOwn(json, 'results') || !Array.isArray(json.results) || json.results.length === 0) return { ok: false, reason: 'unexpected shape' };
  const first = /** @type {unknown} */ (json.results[0]);
  if (!isRecord(first) || !Object.hasOwn(first, 'idVariable') || first.idVariable !== BCRA_VARIABLE_ID) return { ok: false, reason: 'unexpected variable' };
  const detail = Object.hasOwn(first, 'detalle') ? /** @type {unknown} */ (first.detalle) : undefined;
  if (!Array.isArray(detail) || detail.length === 0 || detail.length > MAX_ENTRIES) return { ok: false, reason: 'unexpected detail' };

  // One bad entry does not spoil the response: invalid entries are skipped and the newest valid one is used.
  /** @type {{ time: number, fecha: string, valor: number } | null} */
  let newest = null;
  for (const entry of /** @type {unknown[]} */ (detail)) {
    if (!isRecord(entry) || !Object.hasOwn(entry, 'fecha') || !Object.hasOwn(entry, 'valor')) continue;
    const time = parseIsoDate(entry.fecha);
    const valor = entry.valor;
    // 0 % is treated as corrupt (a real expectation is never exactly 0).
    if (time === null || typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0 || valor > MAX_ANNUAL_PCT) continue;
    if (newest === null || time > newest.time) newest = { time, fecha: /** @type {string} */ (entry.fecha), valor };
  }
  if (newest === null) return { ok: false, reason: 'no valid entry' };
  if (newest.time > now.getTime() + DAY_MS) return { ok: false, reason: 'date in the future' };
  return { ok: true, anualPct: newest.valor, fecha: newest.fecha };
}

/**
 * One GET through the project's fetch context (host allowlist, TLS verified,
 * size cap, same-host redirects only). Never throws.
 * @param {import('../http/client.js').FetchContext} ctx
 * @param {Date} now
 * @returns {Promise<BcraParse>}
 */
export async function fetchBcraRem(ctx, now) {
  try {
    const result = await ctx.get(BCRA_URL, { accept: 'application/json' });
    if (!result.ok) return { ok: false, reason: `${result.kind}${result.status === undefined ? '' : ` ${result.status}`}` };
    if (result.kind !== 'json') return { ok: false, reason: 'not JSON' };
    return parseBcraResponse(result.body, now);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.name : 'error' };
  }
}
