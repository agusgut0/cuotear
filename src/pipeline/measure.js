/**
 * Measurement phase (DRT 11 step 5, RNF-12): one task per store run in
 * parallel; inside a store the URLs go one after another. Each store has its
 * own time budget and the whole phase has a global one. A store that fails,
 * times out or throws never fails the run: its URLs become `falla` results.
 *
 * @typedef {Object} Measurement
 * @property {string} productId
 * @property {string} store
 * @property {import('../stores/types.js').StoreResult} result
 *
 * @typedef {Object} StoreReport
 * @property {string} store
 * @property {number} urls
 * @property {Record<string, number>} outcomes count per outcome
 * @property {Record<string, number>} failures count per failure kind
 * @property {number} requests
 * @property {number} ms
 */

export const STORE_BUDGET_MS = 5 * 60_000;
export const TOTAL_BUDGET_MS = 6 * 60_000;

/**
 * @param {'timeout'|'parse'} kind
 * @param {string} detail
 * @returns {import('../stores/types.js').StoreResult}
 */
const failed = (kind, detail) => ({ outcome: 'falla', failure: { kind, detail }, meta: { requests: 0, ms: 0 } });

/**
 * Resolves with the promise's value, or with `undefined` after `ms`.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T | undefined>}
 */
async function withDeadline(promise, ms) {
  if (ms <= 0) {
    promise.catch(() => {});
    return undefined;
  }
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{
 *   config: import('../config/types.js').Config,
 *   registry: readonly import('../stores/index.js').StoreRegistration[],
 *   ctx: import('../http/client.js').FetchContext,
 *   codigoPostal: string,
 *   now?: () => number,
 *   budgets?: { storeMs?: number, totalMs?: number },
 *   log?: (message: string) => void,
 * }} input
 * @returns {Promise<{ measurements: Measurement[], reports: StoreReport[] }>}
 */
export async function measureProducts({ config, registry, ctx, codigoPostal, now = Date.now, budgets = {}, log = () => {} }) {
  const storeMs = budgets.storeMs ?? STORE_BUDGET_MS;
  const totalEnd = now() + (budgets.totalMs ?? TOTAL_BUDGET_MS);

  /** @type {Map<string, { productId: string, url: string }[]>} */
  const byStore = new Map();
  for (const product of config.productos) {
    for (const [store, url] of Object.entries(product.urls)) {
      byStore.set(store, [...(byStore.get(store) ?? []), { productId: product.id, url }]);
    }
  }

  const tasks = [...byStore].flatMap(([storeId, targets]) => {
    const adapter = registry.find((candidate) => candidate.id === storeId);
    return adapter === undefined ? [] : [measureStore({ adapter, targets, ctx, codigoPostal, now, storeEnd: now() + storeMs, totalEnd, log })];
  });
  const settled = await Promise.allSettled(tasks);

  /** @type {Measurement[]} */
  const measurements = [];
  /** @type {StoreReport[]} */
  const reports = [];
  for (const entry of settled) {
    if (entry.status === 'rejected') throw entry.reason;
    measurements.push(...entry.value.measurements);
    reports.push(entry.value.report);
  }
  return { measurements, reports };
}

/**
 * @param {{
 *   adapter: import('../stores/index.js').StoreRegistration,
 *   targets: { productId: string, url: string }[],
 *   ctx: import('../http/client.js').FetchContext,
 *   codigoPostal: string,
 *   now: () => number,
 *   storeEnd: number,
 *   totalEnd: number,
 *   log: (message: string) => void,
 * }} input
 * @returns {Promise<{ measurements: Measurement[], report: StoreReport }>}
 */
async function measureStore({ adapter, targets, ctx, codigoPostal, now, storeEnd, totalEnd, log }) {
  /** @type {Measurement[]} */
  const measurements = [];
  /** @type {StoreReport} */
  const report = { store: adapter.id, urls: targets.length, outcomes: {}, failures: {}, requests: 0, ms: 0 };
  const deadline = Math.min(storeEnd, totalEnd);

  for (const { productId, url } of targets) {
    const started = now();
    const pending = Promise.resolve().then(() => adapter.measure(ctx, url, { codigoPostal, log: (message) => log(`[cuotear] ${adapter.id}: ${message}`) }));
    /** @type {import('../stores/types.js').StoreResult} */
    let result;
    try {
      result = (await withDeadline(pending, deadline - now())) ?? failed('timeout', 'time budget exhausted');
    } catch (error) {
      log(`[cuotear] ${adapter.id}: unexpected adapter error: ${error instanceof Error ? error.message : String(error)}`);
      result = failed('parse', 'unexpected error in the adapter');
    }
    measurements.push({ productId, store: adapter.id, result });
    report.outcomes[result.outcome] = (report.outcomes[result.outcome] ?? 0) + 1;
    if (result.failure !== undefined) report.failures[result.failure.kind] = (report.failures[result.failure.kind] ?? 0) + 1;
    report.requests += result.meta.requests;
    report.ms += now() - started;
  }
  return { measurements, report };
}
