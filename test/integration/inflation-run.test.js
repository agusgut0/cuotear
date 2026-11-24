import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { BCRA_URL } from '../../src/inflation/bcra.js';
import { runPipeline } from '../../src/pipeline/run-pipeline.js';
import { fakeFetch, JSON_HEADERS } from '../helpers/fake-http.js';
import { CATALOG_URL, oncityFixture, oncityFixtureWithCashPrice, PRODUCT_URL, ROBOTS_URL, runOptions, workspace } from '../helpers/pipeline.js';

const BCRA_BODY = readFileSync(new URL('../fixtures/bcra/variable-29.json', import.meta.url), 'utf8');
const REPO_CONFIG = readFileSync(new URL('../../config/cuotear.yaml', import.meta.url), 'utf8');
const REM_CONFIG = REPO_CONFIG.replace('fuente: manual', 'fuente: rem');
const REM_NO_MANUAL = REM_CONFIG.replace(/ {4}manual:\r?\n(?: {6}.*\r?\n)+/, '');
const day = (/** @type {string} */ iso) => new Date(`${iso}T12:17:41Z`);

/** @param {import('../helpers/fake-http.js').FakeReply} bcra */
const fetcher = (bcra) =>
  fakeFetch({
    [ROBOTS_URL]: { status: 200, body: 'User-agent: *\nAllow: /\n' },
    [CATALOG_URL]: { status: 200, body: oncityFixture(), headers: JSON_HEADERS },
    [BCRA_URL]: bcra,
  });
const bcraCalls = (/** @type {ReturnType<typeof fetcher>} */ fake) => fake.calls.filter((call) => call.url === BCRA_URL).length;
const savedState = (/** @type {ReturnType<typeof workspace>} */ space) => JSON.parse(readFileSync(space.statePath, 'utf8'));

describe('pipeline with fuente rem', () => {
  test('queries BCRA once, persists state.inflation and shows source, annual value and date', async () => {
    const space = workspace(REM_CONFIG);
    const fake = fetcher({ status: 200, body: BCRA_BODY, headers: JSON_HEADERS });
    const lines = /** @type {string[]} */ ([]);
    const { summary } = await runPipeline(runOptions(space, fake, { now: day('2026-11-22'), lines }));

    assert.equal(bcraCalls(fake), 1);
    assert.equal(summary?.rate.origin, 'rem');
    assert.equal(summary?.rate.annualPct, 21.8);
    assert.deepEqual(savedState(space).inflation, { fuente: 'rem', anualPct: 21.8, fecha: '2026-10-31', obtainedAt: '2026-11-22T12:17:41Z' });
    assert.ok(lines.some((line) => line.includes('inflation:') && line.includes('(rem, REM 21.8 % annual as of 2026-10-31)')));
    // A verdict exists with the REM rate.
    assert.ok(summary?.stores.length);
    const state = savedState(space);
    assert.ok(Math.abs(state.products['tcl-75t6c'].r - 0.01657) < 0.00001);
  });

  test('a second run the same day does not query again', async () => {
    const space = workspace(REM_CONFIG);
    await runPipeline(runOptions(space, fetcher({ status: 200, body: BCRA_BODY, headers: JSON_HEADERS }), { now: day('2026-11-22') }));
    const second = fetcher({ status: 500, body: 'x' });
    const { summary } = await runPipeline(runOptions(space, second, { now: new Date('2026-11-22T18:17:41Z') }));
    assert.equal(bcraCalls(second), 0);
    assert.equal(summary?.rate.origin, 'rem');
  });

  test('BCRA down: uses the stored value (stale only past 70 days), then manual backup, then none', async () => {
    const space = workspace(REM_CONFIG);
    await runPipeline(runOptions(space, fetcher({ status: 200, body: BCRA_BODY, headers: JSON_HEADERS }), { now: day('2026-11-22') }));
    const down = fetcher({ status: 500, body: 'x' });
    const stale = await runPipeline(runOptions(space, down, { now: day('2026-11-23') }));
    // fecha 2026-10-31 is 23 days old: a transient failure keeps the label.
    assert.equal(stale.summary?.rate.origin, 'rem');
    assert.equal(savedState(space).inflation.obtainedAt, '2026-11-22T12:17:41Z');
    // 76 days old: now it is stale.
    const old = await runPipeline(runOptions(space, fetcher({ status: 500, body: 'x' }), { now: day('2027-01-15') }));
    assert.equal(old.summary?.rate.origin, 'rem-stale');

    const backupSpace = workspace(REM_CONFIG);
    const backup = await runPipeline(runOptions(backupSpace, fetcher({ status: 500, body: 'x' }), { now: day('2026-11-22') }));
    assert.equal(backup.summary?.rate.origin, 'backup');
    assert.equal(backup.summary?.rate.r, 0.025);

    const noneSpace = workspace(REM_NO_MANUAL);
    const none = await runPipeline(runOptions(noneSpace, fetcher({ status: 500, body: 'x' }), { now: day('2026-11-22') }));
    assert.equal(none.exitCode, 0);
    assert.deepEqual(none.summary?.rate, { r: null, origin: 'none' });
    assert.equal(savedState(noneSpace).inflation, undefined);
  });

  test('the alert rules still run with the REM rate', async () => {
    const space = workspace(REM_CONFIG);
    await runPipeline(runOptions(space, fetcher({ status: 200, body: BCRA_BODY, headers: JSON_HEADERS }), { now: day('2026-11-22') }));
    const second = await runPipeline(runOptions(space, fetcher({ status: 200, body: BCRA_BODY, headers: JSON_HEADERS }), { now: day('2026-11-23') }));
    assert.equal(second.exitCode, 0);
    assert.equal(second.summary?.rate.origin, 'rem');
  });

  test('dry run queries but saves no state', async () => {
    const space = workspace(REM_CONFIG);
    const fake = fetcher({ status: 200, body: BCRA_BODY, headers: JSON_HEADERS });
    const { summary } = await runPipeline({ ...runOptions(space, fake, { now: day('2026-11-22') }), dryRun: true });
    assert.equal(bcraCalls(fake), 1);
    assert.equal(summary?.rate.origin, 'rem');
    assert.throws(() => readFileSync(space.statePath, 'utf8'));
  });
});

describe('F5 on top of existing state (rate source changes between runs)', () => {
  const PRODUCT = 'tcl-75t6c';
  const configText = (/** @type {'rem'|'manual'} */ fuente) => `version: 1
alertas:
  canal: telegram
  reglas:
    baja_minima_pct: 5
    cambio_mejor_opcion: true
comparacion:
  s: 1
  inflacion:
    fuente: ${fuente}
    manual:
      periodo: mensual
      pct: 2.5
productos:
  - id: ${PRODUCT}
    nombre: 'Smart TV TCL 75" 75T6C'
    urls:
      oncity: ${PRODUCT_URL}
`;
  const hours = (/** @type {number} */ h) => new Date(Date.parse('2026-11-22T12:17:41Z') + h * 3_600_000);
  const kinds = (/** @type {ReturnType<typeof savedState>} */ state) => state.pendingAlerts.map((/** @type {{ kind: string }} */ alert) => alert.kind).sort();
  const catalogFetch = (/** @type {string} */ catalog, /** @type {import('../helpers/fake-http.js').FakeReply} */ bcra) =>
    fakeFetch({
      [ROBOTS_URL]: { status: 200, body: 'User-agent: *\nAllow: /\n' },
      [CATALOG_URL]: { status: 200, body: catalog, headers: JSON_HEADERS },
      [BCRA_URL]: bcra,
    });
  const bcraOk = { status: 200, body: BCRA_BODY, headers: JSON_HEADERS };

  /** First run with a manual 2.5 % monthly rate: the state of an installation from before F5 (no `inflation`). */
  async function preF5Space() {
    const space = workspace(configText('manual'));
    await runPipeline(runOptions(space, catalogFetch(oncityFixture(), bcraOk), { now: hours(0) }));
    const before = savedState(space);
    assert.equal(before.inflation, undefined);
    assert.equal(before.products[PRODUCT].r, 0.025);
    assert.equal(before.prevBest[PRODUCT].r, 0.025);
    return space;
  }

  test('(a) pre-F5 state + BCRA OK + no price change: no best-option alerts, the new rate is stored', async () => {
    const space = await preF5Space();
    writeFileSync(space.configPath, configText('rem'));
    const fake = catalogFetch(oncityFixture(), bcraOk);
    const { summary } = await runPipeline(runOptions(space, fake, { now: hours(6) }));

    assert.equal(bcraCalls(fake), 1);
    assert.equal(summary?.rate.origin, 'rem');
    const after = savedState(space);
    assert.deepEqual(kinds(after), []);
    assert.equal(after.inflation.anualPct, 21.8);
    assert.ok(Math.abs(after.prevBest[PRODUCT].r - 0.01657) < 0.00001);
    assert.ok(Math.abs(after.products[PRODUCT].r - 0.01657) < 0.00001);
  });

  test('(b) the same plus a price drop: the series alert fires and the best option is judged with the previous rate', async () => {
    const space = await preF5Space();
    writeFileSync(space.configPath, configText('rem'));
    await runPipeline(runOptions(space, catalogFetch(oncityFixtureWithCashPrice(1_000_000), bcraOk), { now: hours(6) }));

    const after = savedState(space);
    const alerts = /** @type {any[]} */ (after.pendingAlerts);
    const series = alerts.find((alert) => alert.kind === 'serie');
    assert.equal(series?.serie, 'contado');
    assert.equal(series?.currentCents, 100_000_000);
    // E is evaluated with the previous rate (0.025), the current rate only feeds the stored state.
    const change = alerts.find((alert) => alert.kind === 'cambio_mejor_opcion');
    assert.equal(change?.previous.tipo, 'cuotas');
    assert.equal(change?.current.tipo, 'contado');
    assert.equal(alerts.some((alert) => alert.kind === 'mejor_vp'), false);
    assert.ok(Math.abs(after.prevBest[PRODUCT].r - 0.01657) < 0.00001);
  });

  test('(c) fuente manual with a previous state.inflation: no query and the value stays intact', async () => {
    const space = workspace(configText('rem'));
    await runPipeline(runOptions(space, catalogFetch(oncityFixture(), bcraOk), { now: hours(0) }));
    const kept = savedState(space).inflation;
    assert.ok(kept);
    writeFileSync(space.configPath, configText('manual'));
    const fake = catalogFetch(oncityFixture(), bcraOk);
    const { summary } = await runPipeline(runOptions(space, fake, { now: hours(48) }));
    assert.equal(bcraCalls(fake), 0);
    assert.equal(summary?.rate.origin, 'manual');
    assert.deepEqual(savedState(space).inflation, kept);
  });

  test('(d) state.inflation with anualPct 1001: only that field is ignored (state kept, not rebuilt) and BCRA is queried again', async () => {
    const space = workspace(configText('rem'));
    await runPipeline(runOptions(space, catalogFetch(oncityFixture(), bcraOk), { now: hours(0) }));
    const corrupt = savedState(space);
    corrupt.inflation = { ...corrupt.inflation, anualPct: 1001, obtainedAt: '2026-11-23T01:00:00Z' };
    writeFileSync(space.statePath, JSON.stringify(corrupt));

    const lines = /** @type {string[]} */ ([]);
    const fake = catalogFetch(oncityFixture(), bcraOk);
    await runPipeline(runOptions(space, fake, { now: hours(24), lines }));
    assert.equal(lines.some((line) => line.includes('state was rebuilt')), false);
    assert.equal(bcraCalls(fake), 1);
    const after = savedState(space);
    assert.equal(after.inflation.anualPct, 21.8);
    // the rest of the state survived: the previous run is known
    assert.ok(after.eligible[PRODUCT].length > 0);
    assert.equal(after.products[PRODUCT].s, 1);
  });

  test('(d) state.inflation with an impossible fecha (2026-02-31): ignored and not persisted back when BCRA is down', async () => {
    const space = workspace(configText('rem'));
    await runPipeline(runOptions(space, catalogFetch(oncityFixture(), bcraOk), { now: hours(0) }));
    const corrupt = savedState(space);
    corrupt.inflation = { ...corrupt.inflation, fecha: '2026-02-31' };
    writeFileSync(space.statePath, JSON.stringify(corrupt));

    const lines = /** @type {string[]} */ ([]);
    const { summary } = await runPipeline(runOptions(space, catalogFetch(oncityFixture(), { status: 500, body: 'x' }), { now: hours(24), lines }));
    assert.equal(lines.some((line) => line.includes('state was rebuilt')), false);
    assert.equal(summary?.rate.origin, 'backup');
    assert.equal(savedState(space).inflation, undefined);
  });

  test('(e) obtainedAt in the future forces a new query', async () => {
    const space = workspace(configText('rem'));
    await runPipeline(runOptions(space, catalogFetch(oncityFixture(), bcraOk), { now: hours(0) }));
    for (const obtainedAt of ['2026-11-22T20:00:00Z', '2026-12-30T00:00:00Z']) {
      const state = savedState(space);
      state.inflation = { ...state.inflation, obtainedAt };
      writeFileSync(space.statePath, JSON.stringify(state));
      const fake = catalogFetch(oncityFixture(), bcraOk);
      await runPipeline(runOptions(space, fake, { now: hours(1) }));
      assert.equal(bcraCalls(fake), 1, obtainedAt);
      assert.equal(savedState(space).inflation.obtainedAt, '2026-11-22T13:17:41Z');
    }
  });
});
