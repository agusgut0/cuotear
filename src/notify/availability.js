import { createApi, isValidRepo } from './github-api.js';

/**
 * Availability of the scheduled runs over 30 days (RNF-10, DRT 18.3):
 * successful / expected (120). Runs GitHub dropped count as not successful
 * because the denominator is the expected count, not the recorded one. Below
 * 95 % => cause `disponibilidad`. An API failure is "unknown": no value, no
 * cause, never an error.
 *
 * @typedef {typeof fetch} FetchFn
 * @typedef {{ value: number | null, successful: number, expected: number, cause: 'disponibilidad' | null }} Availability
 */

export const WINDOW_DAYS = 30;
export const EXPECTED_RUNS = 120;
export const THRESHOLD_PCT = 95;
export const WORKFLOW_FILE = 'monitor.yml';
export const MAX_PAGES = 3;
const PER_PAGE = 100;
const DAY_MS = 86_400_000;
const RUN_INTERVAL_MS = 6 * 3_600_000;

/**
 * @param {{
 *   repo: string,
 *   token: string | undefined,
 *   fetch?: FetchFn,
 *   now?: Date,
 *   since?: Date,
 *   log?: (line: string) => void,
 *   timeoutMs?: number,
 * }} input `since`: when scheduling started; shortens the expected count for young repos.
 * @returns {Promise<Availability>}
 */
export async function computeAvailability({ repo, token, fetch: fetchFn = fetch, now = new Date(), since, log = console.log, timeoutMs }) {
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
  const young = since !== undefined && since > windowStart;
  const effectiveStart = young ? since : windowStart;
  const expected = young
    ? Math.max(1, Math.min(EXPECTED_RUNS, Math.ceil((now.getTime() - effectiveStart.getTime()) / RUN_INTERVAL_MS)))
    : EXPECTED_RUNS;
  /** @type {Availability} */
  const unknown = { value: null, successful: 0, expected, cause: null };
  try {
    if (token === undefined || token === '' || !isValidRepo(repo)) {
      log('[cuotear] availability: no token or repository available; unknown');
      return unknown;
    }
    const api = createApi({ fetch: fetchFn, token, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
    const day = windowStart.toISOString().slice(0, 10);
    /** @type {Set<unknown>} */
    const ids = new Set();
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const response = await api('GET', `/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?event=schedule&created=%3E%3D${day}&per_page=${PER_PAGE}&page=${page}`);
      const runs = /** @type {{ workflow_runs?: unknown } | null} */ (response.data)?.workflow_runs;
      if (!response.ok || !Array.isArray(runs)) {
        log(`[cuotear] availability: the runs API failed (status ${response.status}); unknown`);
        return unknown;
      }
      for (const run of runs) {
        if (typeof run !== 'object' || run === null) continue;
        const { id, conclusion, created_at: createdAt } = /** @type {Record<string, unknown>} */ (run);
        const created = typeof createdAt === 'string' ? new Date(createdAt) : new Date(Number.NaN);
        if (conclusion === 'success' && Number.isSafeInteger(id) && created >= effectiveStart && created <= now) ids.add(id);
      }
      if (runs.length < PER_PAGE) break;
    }
    const successful = Math.min(ids.size, expected);
    const cause = successful * 100 < THRESHOLD_PCT * expected ? 'disponibilidad' : null;
    const value = (successful * 100) / expected;
    log(`[cuotear] availability: ${successful}/${expected} scheduled runs succeeded (${value.toFixed(1)} %)`);
    return { value, successful, expected, cause };
  } catch {
    log('[cuotear] availability: unexpected error; unknown');
    return unknown;
  }
}
