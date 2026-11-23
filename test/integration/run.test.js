import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { runPipeline } from '../../src/pipeline/run-pipeline.js';
import { stores } from '../../src/stores/index.js';
import { fakeFetch, HTML_HEADERS, JSON_HEADERS } from '../helpers/fake-http.js';
import { CATALOG_URL, oncityFetch, oncityFixtureWithCashPrice, ROBOTS_URL, runOptions, workspace } from '../helpers/pipeline.js';

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

  test('robots.txt forbidding the product path opens robots:<store>: no product request, exit 0, cause in the state', async () => {
    const space = workspace();
    const fetcher = fakeFetch({ [ROBOTS_URL]: { status: 200, body: 'User-agent: *\nDisallow: /api/\n' } });
    const lines = /** @type {string[]} */ ([]);
    const { exitCode, summary } = await runPipeline(runOptions(space, fetcher, { lines }));

    assert.equal(exitCode, 0);
    assert.deepEqual(fetcher.calls.map((call) => call.url), [ROBOTS_URL]);
    assert.equal(summary?.stores[0]?.failures.robots, 1);
    assert.ok(summary?.avisos.includes('robots:oncity'));
    assert.ok(lines.some((line) => line.startsWith('::error::cuotear: aviso robots:oncity:')));
    assert.deepEqual(state(space).ops.lastCauses, ['robots:oncity', 'todas-tiendas-fallan']);
  });

  test('every store failing opens todas-tiendas-fallan, the run still exits 0 and the cause clears when the store recovers', async () => {
    const space = workspace();
    const lines = /** @type {string[]} */ ([]);
    const { exitCode, summary } = await runPipeline(runOptions(space, oncityFetch({ status: 403 }), { lines }));
    assert.equal(exitCode, 0);
    assert.deepEqual(summary?.avisos, ['todas-tiendas-fallan']);
    assert.ok(lines.some((line) => line.startsWith('::error::cuotear: aviso todas-tiendas-fallan:')));
    assert.deepEqual(state(space).ops.lastCauses, ['todas-tiendas-fallan']);

    const recovered = await runPipeline(runOptions(space, oncityFetch(), { now: later(6) }));
    assert.deepEqual(recovered.summary?.avisos, []);
    assert.deepEqual(state(space).ops.lastCauses, []);
  });

  test('dry run computes the notices but does not save them', async () => {
    const space = workspace();
    const { summary } = await runPipeline({ ...runOptions(space, oncityFetch({ status: 403 })), dryRun: true });
    assert.deepEqual(summary?.avisos, ['todas-tiendas-fallan']);
    assert.equal(existsSync(space.statePath), false);
  });
});

describe('two stores: one blocked by robots.txt, one healthy', () => {
  const MEGATONE_URL = 'https://www.megatone.net/producto/televisor-tcl-75t6c-qled-75-4k-uhd-google-tv-dlg-120hz_MKT028PMTP/';
  const MEGATONE_ROBOTS = 'https://www.megatone.net/robots.txt';
  const registry = ['oncity', 'megatone'].map((id) => /** @type {import('../../src/stores/index.js').StoreRegistration} */ (stores.find((store) => store.id === id)));
  const config = readFileSync(new URL('../../config/cuotear.yaml', import.meta.url), 'utf8') + `      megatone: ${MEGATONE_URL}\n`;
  const ROBOTS_ALLOW = 'User-agent: *\nAllow: /\n';
  const oncityBody = () => readFileSync(new URL('../fixtures/oncity/tcl-75t6c.json', import.meta.url), 'utf8');
  const megatoneBody = () => readFileSync(new URL('../fixtures/megatone/tcl-75t6c.html', import.meta.url), 'utf8');

  /** @param {boolean} oncityAllowed */
  const twoStoreFetch = (oncityAllowed) =>
    fakeFetch({
      [ROBOTS_URL]: { status: 200, body: oncityAllowed ? ROBOTS_ALLOW : 'User-agent: *\nDisallow: /api/\n' },
      [CATALOG_URL]: { status: 200, body: oncityBody(), headers: JSON_HEADERS },
      [MEGATONE_ROBOTS]: { status: 200, body: ROBOTS_ALLOW },
      [MEGATONE_URL]: { status: 200, body: megatoneBody(), headers: HTML_HEADERS },
    });

  /**
   * Options for a run `hours` after the base time; the HTTP clock follows so the 24 h robots.txt cache really expires.
   * @param {ReturnType<typeof workspace>} space
   * @param {ReturnType<typeof twoStoreFetch>} fetcher
   * @param {number} hours
   */
  const at = (space, fetcher, hours) => {
    const options = runOptions(space, fetcher, { now: later(hours) });
    return { ...options, registry, http: { ...options.http, now: () => later(hours).getTime() } };
  };

  test('only robots:oncity is opened (no todas-tiendas-fallan), exit 0; the cause clears once robots.txt allows the store again', async () => {
    const space = workspace(config);
    const blocked = twoStoreFetch(false);
    const first = await runPipeline(at(space, blocked, 0));
    assert.equal(first.exitCode, 0);
    assert.deepEqual(first.summary?.avisos, ['robots:oncity']);
    assert.deepEqual(state(space).ops.lastCauses, ['robots:oncity']);
    assert.ok(!blocked.calls.some((call) => call.url === CATALOG_URL), 'no product request to the blocked store');
    assert.equal(first.summary?.stores.find((store) => store.store === 'megatone')?.outcomes.ok, 1);

    // robots.txt copies are reused for 24 h (DRT 5.1): the second run happens after that.
    const second = await runPipeline(at(space, twoStoreFetch(true), 25));
    assert.equal(second.exitCode, 0);
    assert.deepEqual(second.summary?.avisos, []);
    assert.deepEqual(state(space).ops.lastCauses, []);
  });
});
