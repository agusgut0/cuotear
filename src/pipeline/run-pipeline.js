import { appendFileSync, existsSync, readdirSync } from 'node:fs';
import { resolveMonthlyRate } from '../core/compare.js';
import { lastPoints, pointSeriesKey } from '../core/history.js';
import { HISTORY_DIR, readHistory, removeHistory, writeHistory } from '../core/history-files.js';
import { recordProduct } from '../core/record.js';
import { createStoreFetchContext } from '../http/context.js';
import { buildSite } from '../site/build.js';
import { loadState, saveState, STATE_PATH } from '../state/store.js';
import { stores as defaultRegistry } from '../stores/index.js';
import { selectConfig } from './config-source.js';
import { measureProducts } from './measure.js';
import { settingsOf } from './settings.js';
import { summaryLines, summaryMarkdown } from './summary.js';
import { bestForState, buildView } from './view.js';

/**
 * One run of the monitor (DRT 11 steps 1 to 10 for what exists today):
 * state, configuration, inflation, measurement, series and counters, history,
 * comparison, state and static site.
 *
 * @typedef {Object} RunOptions
 * @property {string} [configPath]
 * @property {string} [statePath]
 * @property {string} [dataDir] history directory
 * @property {string} [outDir] where the static site is written
 * @property {boolean} [dryRun] no history written and no state saved
 * @property {readonly import('../stores/index.js').StoreRegistration[]} [registry]
 * @property {Omit<import('../http/client.js').ClientOptions, 'allowedHosts' | 'robotsHosts' | 'robots' | 'log'>} [http] fetch layer options (injectable fetch for tests)
 * @property {() => Date} [clock]
 * @property {{ storeMs?: number, totalMs?: number }} [budgets]
 * @property {(line: string) => void} [log]
 * @property {string} [summaryFile] file that receives the markdown summary (`$GITHUB_STEP_SUMMARY`)
 *
 * @typedef {Object} RunOutcome
 * @property {number} exitCode 0 unless there is no usable configuration
 * @property {import('./summary.js').RunSummary | null} summary
 */

/**
 * @param {RunOptions} [options]
 * @returns {Promise<RunOutcome>}
 */
export async function runPipeline(options = {}) {
  const {
    configPath = 'config/cuotear.yaml',
    statePath = STATE_PATH,
    dataDir = HISTORY_DIR,
    outDir = 'dist/site',
    dryRun = false,
    registry = defaultRegistry,
    http = {},
    clock = () => new Date(),
    budgets = {},
    log = console.log,
    summaryFile,
  } = options;
  const started = clock();

  const loaded = loadState(statePath);
  if (loaded.notice !== null) log(loaded.notice);
  const { state } = loaded;

  const choice = selectConfig({ configPath, state, registry });
  for (const error of choice.errors) log(`::${choice.kind === 'none' ? 'error' : 'warning'}::${error.file}:${error.line}:${error.column} ${error.path === '' ? '' : `${error.path}: `}${error.message}`);
  if (choice.kind === 'none') {
    log('::error::cuotear: the configuration is invalid and there is no previous valid one: nothing is measured or published');
    return { exitCode: 1, summary: null };
  }
  if (choice.kind === 'fallback') log('::warning::cuotear: the repository configuration is invalid; the last valid configuration is being used');

  const { config } = choice;
  const settings = settingsOf(config);
  const rate = resolveMonthlyRate(settings.inflation);

  const ctx = createStoreFetchContext(registry, { ...http, robots: state.robots, log: (message) => log(`[cuotear] http: ${message}`) });
  const { measurements, reports } = await measureProducts({ config, registry, ctx, codigoPostal: settings.codigoPostal, budgets, log, ...(http.now === undefined ? {} : { now: http.now }) });
  for (const report of reports) {
    const failed = Object.values(report.failures).reduce((sum, count) => sum + count, 0);
    if (failed > 0) log(`::warning::cuotear: ${report.store}: ${failed} of ${report.urls} URL(s) failed (${Object.keys(report.failures).join(', ')}); the last valid price is kept`);
  }

  const now = clock();
  let counters = state.series;
  /** @type {import('./view.js').ProductView[]} */
  const views = [];
  const totals = { pointsAdded: 0, pointsPurged: 0, seriesOpened: 0, seriesClosed: 0, filesWritten: 0, filesRemoved: 0 };

  for (const product of config.productos) {
    const { points, ignored } = readHistory(dataDir, product.id);
    if (ignored > 0) log(`::warning::cuotear: ${product.id}: ${ignored} invalid history line(s) ignored`);
    const recorded = recordProduct({
      productId: product.id,
      points,
      measurements: measurements.filter((entry) => entry.productId === product.id),
      counters,
      now,
      failuresForNoData: settings.failuresForNoData,
      retentionMonths: settings.retentionMonths,
    });
    counters = recorded.counters;

    const known = new Set(lastPoints(points).keys());
    totals.pointsAdded += recorded.added.length;
    totals.pointsPurged += recorded.removed;
    totals.seriesOpened += recorded.added.filter((point) => point.estado === 'ok' && !known.has(pointSeriesKey(point))).length;
    totals.seriesClosed += recorded.added.filter((point) => point.estado === 'cerrada').length;
    if (!dryRun && writeHistory(dataDir, product.id, recorded.points)) totals.filesWritten += 1;

    views.push(buildView({ product, records: recorded.series, points: recorded.points, r: rate.r, s: settings.s, marginalPct: settings.marginalPct }));
  }

  if (!dryRun) totals.filesRemoved = removeDroppedProducts(dataDir, new Set(config.productos.map((product) => product.id)));

  if (!dryRun) {
    saveState(nextState({ state, choice, counters, views, rate, ctx, now }), statePath);
  }

  buildSite(
    {
      builtAt: now,
      products: views,
      rate,
      s: settings.s,
      staleHours: settings.staleHours,
      marginalPct: settings.marginalPct,
      usingFallbackConfig: choice.kind === 'fallback',
      storeNames: Object.fromEntries(registry.map((store) => [store.id, store.displayName])),
      failingStores: reports.filter((report) => (report.outcomes.falla ?? 0) > 0).map((report) => report.store),
    },
    outDir,
  );

  /** @type {import('./summary.js').RunSummary} */
  const summary = {
    dryRun,
    configKind: choice.kind,
    products: config.productos.length,
    rate,
    s: settings.s,
    stores: reports,
    ...totals,
    requests: ctx.requestCount(),
    durationMs: clock().getTime() - started.getTime(),
    stateRebuilt: loaded.rebuilt,
  };
  for (const line of summaryLines(summary)) log(line);
  if (summaryFile !== undefined) appendFileSync(summaryFile, summaryMarkdown(summary));
  return { exitCode: 0, summary };
}

/**
 * Deletes the history of products no longer in the configuration (S-33).
 * @param {string} dataDir
 * @param {ReadonlySet<string>} productIds
 * @returns {number} files deleted
 */
function removeDroppedProducts(dataDir, productIds) {
  if (!existsSync(dataDir)) return 0;
  let removed = 0;
  for (const file of readdirSync(dataDir)) {
    const id = file.endsWith('.jsonl') ? file.slice(0, -'.jsonl'.length) : null;
    if (id !== null && !productIds.has(id) && removeHistory(dataDir, id)) removed += 1;
  }
  return removed;
}

/**
 * @param {{
 *   state: import('../state/schema.js').RunState,
 *   choice: Extract<import('./config-source.js').ConfigChoice, { kind: 'repo' | 'fallback' }>,
 *   counters: import('../core/series.js').Counters,
 *   views: readonly import('./view.js').ProductView[],
 *   rate: import('../core/compare.js').MonthlyRate,
 *   ctx: import('../http/client.js').FetchContext,
 *   now: Date,
 * }} input
 * @returns {import('../state/schema.js').RunState}
 */
function nextState({ state, choice, counters, views, rate, ctx, now }) {
  const ids = new Set(views.map((view) => view.id));
  /** @type {import('../state/schema.js').RunState['eligible']} */
  const eligible = {};
  /** @type {import('../state/schema.js').RunState['prevBest']} */
  const prevBest = {};
  for (const view of views) {
    eligible[view.id] = view.records.filter((record) => record.eligible).map((record) => `${record.store}/${record.serie}`);
    const best = bestForState(view.comparison, rate.r);
    if (best !== null) prevBest[view.id] = best;
  }
  return {
    ...state,
    lastRunAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    ...(choice.kind === 'repo' ? { lastValidConfig: { hash: choice.hash, config: /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (choice.config)) } } : {}),
    series: Object.fromEntries(Object.entries(counters).filter(([key]) => ids.has(key.slice(0, key.indexOf('|'))))),
    eligible,
    prevBest,
    robots: ctx.robotsSnapshot(),
  };
}
