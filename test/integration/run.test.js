import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { runPipeline } from '../../src/pipeline/run-pipeline.js';
import { stores } from '../../src/stores/index.js';
import { CATALOG_URL, oncityFetch, oncityFixtureWithCashPrice, runOptions, workspace } from '../helpers/pipeline.js';

const HISTORY_FILE = 'tcl-75t6c.jsonl';
const later = (/** @type {number} */ hours) => new Date(Date.parse('2026-11-22T12:17:41Z') + hours * 3_600_000);

/** @param {ReturnType<typeof workspace>} space */
const historyLines = (space) => readFileSync(join(space.dataDir, HISTORY_FILE), 'utf8').trim().split('\n');
/** @param {ReturnType<typeof workspace>} space */
const homePage = (space) => readFileSync(join(space.outDir, 'index.html'), 'utf8');
/** @param {ReturnType<typeof workspace>} space */
const state = (space) => JSON.parse(readFileSync(space.statePath, 'utf8'));

describe('run pipeline with the On City fixture', () => {
  test('happy path: writes the history, the state and the site', async () => {
    const space = workspace();
    const fetcher = oncityFetch();
    const lines = /** @type {string[]} */ ([]);
    const { exitCode, summary } = await runPipeline(runOptions(space, fetcher, { lines }));

    assert.equal(exitCode, 0);
    assert.equal(summary?.pointsAdded, 4);
    assert.equal(summary?.seriesOpened, 4);
    assert.equal(historyLines(space).length, 4);
    assert.deepEqual(
      fetcher.calls.map((call) => call.url),
      ['https://www.oncity.com/robots.txt', CATALOG_URL],
    );

    const saved = state(space);
    assert.equal(saved.lastRunAt, '2026-11-22T12:17:41Z');
    assert.ok(saved.lastValidConfig.hash.startsWith('sha256:'));
    assert.deepEqual(saved.series['tcl-75t6c|oncity/visa:15'], { failures: 0, lastValidAt: '2026-11-22T12:17:41Z' });
    assert.equal(saved.prevBest['tcl-75t6c'].tipo, 'cuotas');

    const page = homePage(space);
    assert.match(page, /Conviene cuotas/);
    assert.match(page, /15 cuotas sin interés/);
    assert.ok(existsSync(join(space.outDir, 'p', 'tcl-75t6c', 'index.html')));
    assert.ok(lines.some((line) => line.includes('run summary')));
  });

  test('a run without changes writes no history and no file changes (zero commits)', async () => {
    const space = workspace();
    await runPipeline(runOptions(space, oncityFetch()));
    const before = readFileSync(join(space.dataDir, HISTORY_FILE), 'utf8');

    const { summary } = await runPipeline(runOptions(space, oncityFetch(), { now: later(6) }));
    assert.equal(summary?.pointsAdded, 0);
    assert.equal(summary?.filesWritten, 0);
    assert.equal(readFileSync(join(space.dataDir, HISTORY_FILE), 'utf8'), before);
    assert.match(homePage(space), /Actualizado a las 15:17/);
  });

  test('a price change appends exactly one point', async () => {
    const space = workspace();
    await runPipeline(runOptions(space, oncityFetch()));

    const { summary } = await runPipeline(runOptions(space, oncityFetch({ catalog: oncityFixtureWithCashPrice(2_199_999) }), { now: later(6) }));
    assert.equal(summary?.pointsAdded, 1);
    assert.equal(summary?.filesWritten, 1);
    const lines = historyLines(space);
    assert.equal(lines.length, 5);
    assert.match(lines[4] ?? '', /"serie":"contado".*"valor":219999900/);
  });

  test('a 403 keeps the last price, marks the measurement failed and sends no alert', async () => {
    const space = workspace();
    await runPipeline(runOptions(space, oncityFetch()));
    const before = readFileSync(join(space.dataDir, HISTORY_FILE), 'utf8');

    const lines = /** @type {string[]} */ ([]);
    const { exitCode, summary } = await runPipeline(runOptions(space, oncityFetch({ status: 403 }), { now: later(6), lines }));
    assert.equal(exitCode, 0);
    assert.equal(summary?.pointsAdded, 0);
    assert.equal(readFileSync(join(space.dataDir, HISTORY_FILE), 'utf8'), before);
    assert.equal(state(space).series['tcl-75t6c|oncity/contado'].failures, 1);
    assert.ok(lines.some((line) => line.startsWith('::warning::') && line.includes('oncity')));

    const page = homePage(space);
    assert.match(page, /Medición fallida/);
    assert.match(page, /2\.299\.999/);
    assert.doesNotMatch(page, /Sin datos<\/span>/);
    assert.match(page, /Tiendas con falla en la última ejecución: On City/);
  });

  test('four failures turn the series into "sin datos" without a number', async () => {
    const space = workspace();
    await runPipeline(runOptions(space, oncityFetch()));
    for (let run = 1; run <= 4; run += 1) await runPipeline(runOptions(space, oncityFetch({ status: 403 }), { now: later(6 * run) }));

    const page = homePage(space);
    assert.match(page, /Sin datos<\/span>/);
    assert.doesNotMatch(page, /2\.299\.999/);
    assert.match(page, /Sin veredicto/);
  });

  test('an invalid configuration falls back to the last valid one', async () => {
    const space = workspace();
    await runPipeline(runOptions(space, oncityFetch()));
    writeFileSync(space.configPath, 'version: 1\nproductos: [\n');

    const lines = /** @type {string[]} */ ([]);
    const { exitCode, summary } = await runPipeline(runOptions(space, oncityFetch(), { now: later(6), lines }));
    assert.equal(exitCode, 0);
    assert.equal(summary?.configKind, 'fallback');
    assert.ok(lines.some((line) => line.startsWith('::warning::') && line.includes('cuotear.yaml')));
    assert.match(homePage(space), /no es la del repositorio/);
    assert.ok(state(space).lastValidConfig.hash.startsWith('sha256:'));
  });

  test('an invalid configuration with no previous valid one exits non-zero and publishes nothing', async () => {
    const space = workspace('version: 1\nproductos: [\n');
    const lines = /** @type {string[]} */ ([]);
    const { exitCode, summary } = await runPipeline(runOptions(space, oncityFetch(), { lines }));
    assert.equal(exitCode, 1);
    assert.equal(summary, null);
    assert.ok(lines.some((line) => line.startsWith('::error::')));
    assert.equal(existsSync(space.outDir), false);
    assert.equal(existsSync(space.statePath), false);
  });

  test('dry run builds the site but writes no history and saves no state', async () => {
    const space = workspace();
    const { exitCode, summary } = await runPipeline({ ...runOptions(space, oncityFetch()), dryRun: true });
    assert.equal(exitCode, 0);
    assert.equal(summary?.pointsAdded, 4);
    assert.equal(existsSync(space.dataDir), false);
    assert.equal(existsSync(space.statePath), false);
    assert.match(homePage(space), /Conviene cuotas/);
  });

  test('a store that never answers is cut by its time budget and does not fail the run', async () => {
    const space = workspace();
    const oncity = /** @type {import('../../src/stores/index.js').StoreRegistration} */ (stores[0]);
    const hanging = { ...oncity, measure: () => new Promise(() => {}) };
    const { exitCode, summary } = await runPipeline({ ...runOptions(space, oncityFetch()), registry: [hanging], budgets: { storeMs: 25, totalMs: 1000 } });
    assert.equal(exitCode, 0);
    assert.equal(summary?.stores[0]?.failures.timeout, 1);
    assert.equal(state(space).series['tcl-75t6c|oncity/contado'].failures, 1);
  });

  test('history of a product removed from the configuration is deleted', async () => {
    const space = workspace();
    await runPipeline(runOptions(space, oncityFetch()));
    writeFileSync(join(space.dataDir, 'old-product.jsonl'), '');
    const { summary } = await runPipeline(runOptions(space, oncityFetch(), { now: later(6) }));
    assert.equal(summary?.filesRemoved, 1);
    assert.equal(existsSync(join(space.dataDir, 'old-product.jsonl')), false);
  });
});
