import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readdirSync } from 'node:fs';
import { resolveMonthlyRate } from '../core/compare.js';
import { formatTimestamp, lastPoints, pointSeriesKey } from '../core/history.js';
import { HISTORY_DIR, readHistory, removeHistory, writeHistory } from '../core/history-files.js';
import { recordProduct } from '../core/record.js';
import { evaluateProduct } from '../core/rules.js';
import { createStoreFetchContext } from '../http/context.js';
import { NOTIFY_CAUSES, notifySummaryMarkdown, runNotify } from '../notify/notify.js';
import { buildSite } from '../site/build.js';
import { loadState, saveState, STATE_PATH } from '../state/store.js';
import { stores as defaultRegistry } from '../stores/index.js';
import { selectConfig } from './config-source.js';
import { measureProducts } from './measure.js';
import { causeText, computeCauses } from './ops-causes.js';
import { settingsOf } from './settings.js';
import { summaryLines, summaryMarkdown } from './summary.js';
import { bestForState, buildView, storeInputs } from './view.js';

/**
 * One run of the monitor (DRT 11 steps 1 to 10, and 12 when `notify` is
 * given): state, configuration, inflation, measurement, series and counters,
 * history, comparison, alert rules, state and static site.
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
 * @property {boolean} [debug] also log adapter debug messages (unrecognized payment names)
 * @property {string} [summaryFile] file that receives the markdown summary (`$GITHUB_STEP_SUMMARY`)
 * @property {import('../notify/notify.js').NotifyDeps} [notify] when given, the notification step (DRT 11 step 12) runs in-process right after the state is saved. The CLI leaves it out: `cli/notify.js` is its own step, after the history commit.
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
    debug = false,
    summaryFile,
    notify,
  } = options;
  const started = clock();

  const loaded = loadState(statePath);
  if (loaded.notice !== null) log(loaded.notice);
  const { state } = loaded;

  const choice = selectConfig({ configPath, state, registry });
  for (const error of choice.errors) log(`::${choice.kind === 'none' ? 'error' : 'warning'}::${error.file}:${error.line}:${error.column} ${error.path === '' ? '' : `${error.path}: `}${error.message}`);
  if (choice.kind === 'none') {
    log('::error::cuotear: the configuration is invalid and there is no previous valid one: nothing is measured or published');
    // No state is written, but the notice still has to reach the owner (RF-19, RNF-15).
    if (notify !== undefined) await runNotify({ state, config: null, extraCauses: ['config-ausente'], storeNames: {}, now: clock(), dryRun, log, deps: notify });
    return { exitCode: 1, summary: null };
  }
  if (choice.kind === 'fallback') log('::warning::cuotear: the repository configuration is invalid; the last valid configuration is being used');

  const { config } = choice;
  const settings = settingsOf(config);
  const rate = resolveMonthlyRate(settings.inflation);

  const ctx = createStoreFetchContext(registry, { ...http, robots: state.robots, log: (message) => log(`[cuotear] http: ${message}`) });
  const { measurements, reports } = await measureProducts({ config, registry, ctx, codigoPostal: settings.codigoPostal, budgets, log, debug, ...(http.now === undefined ? {} : { now: http.now }) });
  for (const report of reports) {
    const failed = Object.values(report.failures).reduce((sum, count) => sum + count, 0);
    if (failed > 0) log(`::warning::cuotear: ${report.store}: ${failed} of ${report.urls} URL(s) failed (${Object.keys(report.failures).join(', ')}); the last valid price is kept`);
  }

  const avisos = computeCauses(reports);
  for (const cause of avisos) log(`::error::cuotear: aviso ${cause}: ${causeText(cause)}`);

  const now = clock();
  const runTimestamp = formatTimestamp(now);
  let counters = state.series;
  /** @type {import('./view.js').ProductView[]} */
  const views = [];
  /** @type {import('../core/alerts.js').Alert[]} */
  const alerts = [];
  /** @type {NonNullable<import('../state/schema.js').RunState['products']>} */
  const productStates = {};
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

    const hash = productConfigHash(product);
    alerts.push(
      ...evaluateProduct({
        productId: product.id,
        ...(config.alertas?.reglas === undefined ? {} : { globalRules: config.alertas.reglas }),
        ...(product.reglas === undefined ? {} : { productRules: product.reglas }),
        prevPoints: points, // the history BEFORE this run's points
        added: recorded.added,
        eligible: eligibleKeys(recorded.series),
        prev: previousOf({ state, rebuilt: loaded.rebuilt, productId: product.id }),
        stores: storeInputs(Object.keys(product.urls), recorded.series, recorded.points),
        r: rate.r,
        s: settings.s,
        configHash: hash,
        t: runTimestamp,
        verificarBajaPct: settings.verifyDropPct,
      }),
    );
    productStates[product.id] = { configHash: hash, s: settings.s, r: rate.r };

    views.push(buildView({ product, records: recorded.series, points: recorded.points, r: rate.r, s: settings.s, marginalPct: settings.marginalPct }));
  }
  if (alerts.length > 0) log(`[cuotear] alerts: ${alerts.length} detected`);

  if (!dryRun) totals.filesRemoved = removeDroppedProducts(dataDir, new Set(config.productos.map((product) => product.id)));

  const next = nextState({ state, choice, counters, views, rate, ctx, now, avisos, alerts, productStates, reports, s: settings.s });
  if (!dryRun) saveState(next, statePath);

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
      availability: state.ops.availability?.value ?? null,
      openNotices: openNoticesOf({ avisos, fallback: choice.kind === 'fallback', previous: state.ops.lastCauses }),
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
    avisos,
    ...totals,
    requests: ctx.requestCount(),
    durationMs: clock().getTime() - started.getTime(),
    stateRebuilt: loaded.rebuilt,
  };
  for (const line of summaryLines(summary)) log(line);
  let markdown = summaryMarkdown(summary);

  if (notify !== undefined) {
    const notified = await runNotify({
      state: next,
      config,
      extraCauses: choice.kind === 'fallback' ? ['config-invalida'] : [],
      storeNames: Object.fromEntries(registry.map((store) => [store.id, store.displayName])),
      now,
      dryRun,
      log,
      deps: notify,
    });
    if (!dryRun) saveState(notified.state, statePath);
    markdown += notifySummaryMarkdown(notified.summary);
  }
  if (summaryFile !== undefined) appendFileSync(summaryFile, markdown);
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
 * @param {readonly import('../core/record.js').SeriesRecord[]} records
 * @returns {string[]} `<store>/<serie>` of the eligible series
 */
const eligibleKeys = (records) => records.filter((record) => record.eligible).map((record) => `${record.store}/${record.serie}`);

/**
 * Hash of what defines a product (DRT 13.2): a change in it silences
 * `cambio_mejor_opcion` for one run.
 * @param {import('../config/types.js').Product} product
 * @returns {string} `sha256:<hex>`
 */
const productConfigHash = (product) => `sha256:${createHash('sha256').update(JSON.stringify(product)).digest('hex')}`;

/**
 * What the rules need about a product from the previous run, or undefined when
 * the state was lost or does not know the product (S-25, states older than F4):
 * then `mejor_vp` and `cambio_mejor_opcion` stay silent and the series alerts
 * keep working (they only need the history).
 * @param {{ state: import('../state/schema.js').RunState, rebuilt: boolean, productId: string }} input
 * @returns {import('../core/rules.js').PreviousProductState | undefined}
 */
function previousOf({ state, rebuilt, productId }) {
  const stored = state.products?.[productId];
  const eligible = state.eligible[productId];
  if (rebuilt || stored === undefined || eligible === undefined) return undefined;
  const best = state.prevBest[productId];
  return { eligible, r: stored.r, s: stored.s, configHash: stored.configHash, best: best === undefined ? null : { tipo: best.tipo, tienda: best.tienda, serie: best.serie } };
}

/**
 * Open notices shown in the site footer (DRT 18.4): the causes of this run plus
 * the ones only the notify step knows, as of the previous run.
 * @param {{ avisos: readonly string[], fallback: boolean, previous: readonly string[] }} input
 * @returns {number}
 */
function openNoticesOf({ avisos, fallback, previous }) {
  const carried = previous.filter((cause) => cause !== 'commit-conflicto' && NOTIFY_CAUSES.includes(/** @type {never} */ (cause)));
  return new Set([...avisos, ...(fallback ? ['config-invalida'] : []), ...carried]).size;
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
 *   avisos: readonly string[],
 *   alerts: readonly import('../core/alerts.js').Alert[],
 *   productStates: NonNullable<import('../state/schema.js').RunState['products']>,
 *   reports: readonly import('./measure.js').StoreReport[],
 *   s: 0|1,
 * }} input
 * @returns {import('../state/schema.js').RunState}
 */
function nextState({ state, choice, counters, views, rate, ctx, now, avisos, alerts, productStates, reports, s }) {
  const ids = new Set(views.map((view) => view.id));
  /** @type {import('../state/schema.js').RunState['eligible']} */
  const eligible = {};
  /** @type {import('../state/schema.js').RunState['prevBest']} */
  const prevBest = {};
  for (const view of views) {
    eligible[view.id] = eligibleKeys(view.records);
    const stores = storeInputs(Object.keys(view.urls), view.records, view.points);
    const best = bestForState({ stores, r: rate.r, s, hold: state.prevBest[view.id] ?? null });
    if (best !== null) prevBest[view.id] = best;
  }
  const sent = new Set(state.sentAlertIds.map((entry) => entry.id));
  const waiting = new Set(state.pendingAlerts.map((alert) => /** @type {{ id?: unknown }} */ (alert).id));
  // New alerts join the pending ones unless already sent or waiting (DRT 13.3); `notify` delivers them.
  const fresh = alerts.filter((alert) => !sent.has(alert.id) && !waiting.has(alert.id));
  return {
    ...state,
    lastRunAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    ...(choice.kind === 'repo' ? { lastValidConfig: { hash: choice.hash, config: /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (choice.config)) } } : {}),
    series: Object.fromEntries(Object.entries(counters).filter(([key]) => ids.has(key.slice(0, key.indexOf('|'))))),
    eligible,
    prevBest,
    products: productStates,
    robots: ctx.robotsSnapshot(),
    pendingAlerts: [...state.pendingAlerts, ...fresh],
    ops: { ...state.ops, lastCauses: [...avisos], measuredStores: reports.filter((report) => report.urls > 0).map((report) => report.store), commitConflict: false },
  };
}
