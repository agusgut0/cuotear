import assert from 'node:assert/strict';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { runPipeline } from '../../src/pipeline/run-pipeline.js';
import { fakeClock, fakeFetch } from '../helpers/fake-http.js';
import { fakeGithub } from '../helpers/fake-github.js';
import { fakeTelegram, OK, TELEGRAM_ENV } from '../helpers/fake-telegram.js';
import { oncityFetch, oncityFixtureWithCashPrice, PRODUCT_URL, ROBOTS_URL, runOptions, workspace } from '../helpers/pipeline.js';

const HISTORY_FILE = 'tcl-75t6c.jsonl';
const REPO = 'owner/cuotear';
const BASE = Date.parse('2026-11-22T12:17:41Z');
const at = (/** @type {number} */ hours) => new Date(BASE + hours * 3_600_000);

/**
 * @param {string} [reglas] lines under `alertas:`, already indented
 * @param {string} [canal]
 */
const configText = (reglas = '', canal = 'telegram') => `version: 1
alertas:
  canal: ${canal}
${reglas}comparacion:
  s: 1
  inflacion:
    fuente: manual
    manual:
      periodo: mensual
      pct: 2.5
productos:
  - id: tcl-75t6c
    nombre: 'Smart TV <b>TCL</b> 75" & Co'
    urls:
      oncity: ${PRODUCT_URL}
`;

/** @param {{ issues?: unknown[], failing?: boolean }} [options] */
function github({ issues = [], failing = false } = {}) {
  if (failing) return fakeGithub({ 'GET ': { throws: new Error('network down') }, 'POST ': { throws: new Error('network down') }, 'PATCH ': { throws: new Error('network down') } });
  return fakeGithub({
    // 120 successful scheduled runs over two pages (100 per page): 100 % availability.
    'GET /repos/owner/cuotear/actions/workflows/monitor.yml/runs': (call) => ({ json: { workflow_runs: Array.from({ length: call.path.endsWith('&page=1') ? 100 : 20 }, (_, id) => ({ id: id + (call.path.endsWith('&page=1') ? 0 : 1000), conclusion: 'success', created_at: '2026-11-20T00:00:00Z' })) } }),
    'GET /repos/owner/cuotear/issues': { json: issues },
    'POST /repos/owner/cuotear/labels': { json: {} },
    'POST /repos/owner/cuotear/issues': { json: { number: 9 } },
  });
}

/**
 * @param {ReturnType<typeof workspace>} space
 * @param {{ telegram: ReturnType<typeof fakeTelegram>, gh: ReturnType<typeof github>, hours: number, price?: number, env?: Record<string, string | undefined>, dryRun?: boolean, commitConflict?: boolean, lines?: string[] }} input
 */
function options(space, { telegram, gh, hours, price, env = TELEGRAM_ENV, dryRun = false, commitConflict = false, lines = [] }) {
  const fetcher = oncityFetch(price === undefined ? {} : { catalog: oncityFixtureWithCashPrice(price) });
  const clock = fakeClock(at(hours).getTime());
  return {
    ...runOptions(space, fetcher, { now: at(hours), lines }),
    dryRun,
    notify: { env, telegramFetch: telegram.fetch, githubFetch: gh.fetch, githubToken: 'ghs_faketoken', repo: REPO, sleep: clock.sleep, clock: clock.now, commitConflict, lastCommitDate: async () => at(hours - 24).toISOString(), siteUrl: 'https://owner.github.io/cuotear/' },
  };
}

/** @param {ReturnType<typeof workspace>} space */
const state = (space) => JSON.parse(readFileSync(space.statePath, 'utf8'));

describe('alerts end to end: run pipeline + rules + Telegram + issues (fakes only)', () => {
  test('the first measurement sends no alert (RN-12) and records what the rules need next time', async () => {
    const space = workspace(configText());
    const telegram = fakeTelegram([OK]);
    const { exitCode } = await runPipeline(options(space, { telegram, gh: github(), hours: 0 }));
    assert.equal(exitCode, 0);
    assert.equal(telegram.calls.length, 0);
    const saved = state(space);
    assert.deepEqual(saved.pendingAlerts, []);
    assert.match(saved.products['tcl-75t6c'].configHash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(saved.products['tcl-75t6c'].s, 1);
    assert.equal(saved.products['tcl-75t6c'].r, 0.025);
    assert.equal(saved.prevBest['tcl-75t6c'].r, 0.025);
    assert.ok(saved.eligible['tcl-75t6c'].includes('oncity/contado'));
    assert.ok(saved.ops.availability.value > 0);
  });

  test('a price drop alerts once, with escaped text; reruns and an unpushed history commit do not duplicate it', async () => {
    const space = workspace(configText());
    const telegram = fakeTelegram([OK]);
    const gh = github();
    await runPipeline(options(space, { telegram, gh, hours: 0 }));
    const firstHistory = join(space.dir, 'first-history.jsonl');
    copyFileSync(join(space.dataDir, HISTORY_FILE), firstHistory);

    const lines = /** @type {string[]} */ ([]);
    const dropped = await runPipeline(options(space, { telegram, gh, hours: 6, price: 2_199_999, lines }));
    assert.equal(dropped.exitCode, 0);
    assert.equal(telegram.calls.length, 1);
    const text = /** @type {string} */ (telegram.calls[0]?.body.text);
    assert.match(text, /<b>Smart TV &lt;b&gt;TCL&lt;\/b&gt; 75&quot; &amp; Co · On City<\/b>/);
    assert.match(text, /Antes \$\s?2\.299\.999 → ahora \$\s?2\.199\.999/);
    assert.match(text, /<a href="https:\/\/owner\.github\.io\/cuotear\/p\/tcl-75t6c\/">Ver detalle<\/a>/);
    assert.equal(state(space).sentAlertIds.length, 1);
    assert.deepEqual(state(space).pendingAlerts, []);
    assert.ok(!lines.join('\n').includes('AAFake'));

    // Same price again: no new change, no new message.
    await runPipeline(options(space, { telegram, gh, hours: 12, price: 2_199_999 }));
    assert.equal(telegram.calls.length, 1);

    // The history commit failed (the repository still has the first file): the same change is detected again, same id, no duplicate.
    copyFileSync(firstHistory, join(space.dataDir, HISTORY_FILE));
    await runPipeline(options(space, { telegram, gh, hours: 18, price: 2_199_999 }));
    assert.equal(telegram.calls.length, 1);
  });

  test('a failed send is retried on the next run and then sent exactly once', async () => {
    const space = workspace(configText());
    const gh = github();
    await runPipeline(options(space, { telegram: fakeTelegram([OK]), gh, hours: 0 }));

    const failing = fakeTelegram([{ status: 500, json: { ok: false } }]);
    await runPipeline(options(space, { telegram: failing, gh, hours: 6, price: 2_199_999 }));
    assert.equal(failing.calls.length, 1);
    assert.equal(state(space).pendingAlerts.length, 1);
    assert.deepEqual(state(space).sentAlertIds, []);

    const working = fakeTelegram([OK]);
    await runPipeline(options(space, { telegram: working, gh, hours: 12, price: 2_199_999 }));
    assert.equal(working.calls.length, 1);
    assert.equal(state(space).pendingAlerts.length, 0);
    assert.equal(state(space).sentAlertIds.length, 1);

    await runPipeline(options(space, { telegram: working, gh, hours: 18, price: 2_199_999 }));
    assert.equal(working.calls.length, 1);
  });

  test('a pending alert that could not be delivered for 48 h is discarded with a log line', async () => {
    const space = workspace(configText());
    const gh = github();
    await runPipeline(options(space, { telegram: fakeTelegram([OK]), gh, hours: 0 }));
    const failing = fakeTelegram([{ status: 500, json: {} }]);
    await runPipeline(options(space, { telegram: failing, gh, hours: 6, price: 2_199_999 }));

    const lines = /** @type {string[]} */ ([]);
    const later = fakeTelegram([{ status: 500, json: {} }]);
    await runPipeline(options(space, { telegram: later, gh, hours: 6 + 49, price: 2_199_999, lines }));
    assert.equal(state(space).pendingAlerts.length, 0);
    assert.ok(lines.some((line) => line.includes('older than 48 h')));
    assert.equal(later.calls.length, 0, 'the stale alert is not sent');
  });

  test('canal: ninguno sends nothing and keeps nothing', async () => {
    const space = workspace(configText('', 'ninguno'));
    const telegram = fakeTelegram([OK]);
    const gh = github();
    await runPipeline(options(space, { telegram, gh, hours: 0, env: {} }));
    await runPipeline(options(space, { telegram, gh, hours: 6, price: 2_199_999, env: {} }));
    assert.equal(telegram.calls.length, 0);
    assert.deepEqual(state(space).pendingAlerts, []);
    assert.ok(!state(space).ops.lastCauses.includes('secretos-canal'));
    assert.equal(gh.calls.some((call) => call.method === 'POST' && call.path.endsWith('/issues')), false);
  });

  test('dry run: no message, no issue, no state', async () => {
    const space = workspace(configText());
    const telegram = fakeTelegram([OK]);
    const gh = github();
    await runPipeline(options(space, { telegram, gh, hours: 0 }));
    const before = readFileSync(space.statePath, 'utf8');
    const callsBefore = gh.calls.length;

    await runPipeline(options(space, { telegram, gh, hours: 6, price: 2_199_999, dryRun: true }));
    assert.equal(telegram.calls.length, 0);
    assert.equal(gh.calls.length, callsBefore);
    assert.equal(readFileSync(space.statePath, 'utf8'), before);
  });

  test('missing secrets: no send, the alert waits, secretos-canal is opened and the run exits 0', async () => {
    const space = workspace(configText());
    const telegram = fakeTelegram([OK]);
    const gh = github();
    await runPipeline(options(space, { telegram, gh, hours: 0, env: {} }));
    const { exitCode } = await runPipeline(options(space, { telegram, gh, hours: 6, price: 2_199_999, env: {} }));
    assert.equal(exitCode, 0);
    assert.equal(telegram.calls.length, 0);
    assert.equal(state(space).pendingAlerts.length, 1);
    assert.ok(gh.calls.some((call) => call.method === 'POST' && call.path === '/repos/owner/cuotear/issues' && String(call.body.body).includes('cause=secretos-canal')));

    // The secrets are configured: the waiting alert goes out.
    await runPipeline(options(space, { telegram, gh, hours: 12, price: 2_199_999 }));
    assert.equal(telegram.calls.length, 1);
    assert.equal(state(space).ops.lastCauses.includes('secretos-canal'), false);
  });

  test('GitHub and Telegram both failing never fails the run', async () => {
    const space = workspace(configText());
    await runPipeline(options(space, { telegram: fakeTelegram([OK]), gh: github(), hours: 0 }));
    const { exitCode } = await runPipeline(options(space, { telegram: fakeTelegram([{ throws: new TypeError('fetch failed') }]), gh: github({ failing: true }), hours: 6, price: 2_199_999 }));
    assert.equal(exitCode, 0);
    assert.equal(state(space).pendingAlerts.length, 1);
  });

  test('a lost state does not block series alerts (they depend on the history, not on the state)', async () => {
    const space = workspace(configText());
    const telegram = fakeTelegram([OK]);
    await runPipeline(options(space, { telegram, gh: github(), hours: 0 }));
    writeFileSync(space.statePath, '{"schemaVersion": 99}');
    await runPipeline(options(space, { telegram, gh: github(), hours: 6, price: 2_199_999 }));
    assert.equal(telegram.calls.length, 1);
    assert.equal(state(space).sentAlertIds.length, 1);
  });

  test('cambio_mejor_opcion: the cash price falling below every installment plan changes the best option (wiring of prevBest, eligible, s, r and the config hash)', async () => {
    const space = workspace(configText('  reglas:\n    cambio_mejor_opcion: true\n'));
    const telegram = fakeTelegram([OK]);
    const gh = github();
    await runPipeline(options(space, { telegram, gh, hours: 0 }));
    assert.equal(state(space).prevBest['tcl-75t6c'].tipo, 'cuotas');

    await runPipeline(options(space, { telegram, gh, hours: 6, price: 1_000_000 }));
    assert.equal(telegram.calls.length, 1);
    const text = /** @type {string} */ (telegram.calls[0]?.body.text);
    assert.match(text, /cambió la mejor opción/);
    assert.match(text, /Ahora: contado en On City/);
    assert.equal(state(space).prevBest['tcl-75t6c'].tipo, 'contado');
  });

  test('a state saved before F4 (without products) keeps series alerts but stays silent on best-option changes', async () => {
    const space = workspace(configText('  reglas:\n    baja_minima_pct: 5\n    cambio_mejor_opcion: true\n'));
    const telegram = fakeTelegram([OK]);
    const gh = github();
    await runPipeline(options(space, { telegram, gh, hours: 0 }));
    const old = state(space);
    delete old.products;
    writeFileSync(space.statePath, JSON.stringify(old));

    await runPipeline(options(space, { telegram, gh, hours: 6, price: 1_000_000 }));
    assert.equal(telegram.calls.length, 1);
    const text = /** @type {string} */ (telegram.calls[0]?.body.text);
    assert.doesNotMatch(text, /cambió la mejor opción/);
    assert.match(text, /Reglas: baja mínima en porcentaje/);
  });

  test('a changed product configuration silences cambio_mejor_opcion for that run', async () => {
    const reglas = '  reglas:\n    cambio_mejor_opcion: true\n';
    const space = workspace(configText(reglas));
    const telegram = fakeTelegram([OK]);
    const gh = github();
    await runPipeline(options(space, { telegram, gh, hours: 0 }));
    writeFileSync(space.configPath, configText(reglas).replace('Smart TV', 'Televisor'));
    await runPipeline(options(space, { telegram, gh, hours: 6, price: 1_000_000 }));
    assert.doesNotMatch(telegram.calls.map((call) => call.body.text).join('\n'), /cambió la mejor opción/);
  });

  test('the site footer shows the availability, the open notices count and the last run, without technical detail', async () => {
    const space = workspace(configText());
    const gh = github();
    await runPipeline(options(space, { telegram: fakeTelegram([OK]), gh, hours: 0, env: {} }));
    await runPipeline(options(space, { telegram: fakeTelegram([OK]), gh, hours: 6, env: {} }));
    const page = readFileSync(join(space.outDir, 'index.html'), 'utf8');
    assert.match(page, /Disponibilidad de las ejecuciones programadas \(últimos 30 días\): \d+,\d\d\s?%/);
    assert.match(page, /Avisos operativos abiertos: 1\./);
    assert.match(page, /Última ejecución: 22\/11\/2026/);
    assert.doesNotMatch(page, /secretos-canal/);
  });
});

/**
 * The same options without the in-process notification step (the CLI keeps it as its own step).
 * @param {import('../../src/pipeline/run-pipeline.js').RunOptions} runOptionsWithNotify
 * @returns {import('../../src/pipeline/run-pipeline.js').RunOptions}
 */
const withoutNotify = (runOptionsWithNotify) => Object.fromEntries(Object.entries(runOptionsWithNotify).filter(([key]) => key !== 'notify'));

describe('review fixes end to end (Q3, Q4, Q5, Q1 and the commit conflict)', () => {
  test('a re-detected change after an unpushed history commit is not sent twice, with commitConflict set', async () => {
    const space = workspace(configText());
    const telegram = fakeTelegram([OK]);
    const gh = github();
    await runPipeline(options(space, { telegram, gh, hours: 0 }));
    const firstHistory = join(space.dir, 'first-history.jsonl');
    copyFileSync(join(space.dataDir, HISTORY_FILE), firstHistory);

    await runPipeline(options(space, { telegram, gh, hours: 6, price: 2_199_999, commitConflict: true }));
    assert.equal(telegram.calls.length, 1);
    assert.ok(state(space).ops.lastCauses.includes('commit-conflicto'));

    // The push failed: the next checkout has the old file and the same drop is detected again (same id).
    copyFileSync(firstHistory, join(space.dataDir, HISTORY_FILE));
    await runPipeline(options(space, { telegram, gh, hours: 12, price: 2_199_999, commitConflict: true }));
    assert.equal(telegram.calls.length, 1, 'no duplicate message');
    assert.equal(state(space).sentAlertIds.length, 1);
    assert.deepEqual(state(space).pendingAlerts, []);
  });

  test('Q5: reordering the keys of the product in the YAML keeps cambio_mejor_opcion working', async () => {
    const reglas = '  reglas:\n    cambio_mejor_opcion: true\n';
    const space = workspace(configText(reglas));
    const telegram = fakeTelegram([OK]);
    const gh = github();
    await runPipeline(options(space, { telegram, gh, hours: 0 }));
    const hashBefore = state(space).products['tcl-75t6c'].configHash;

    // Same product, different order of keys.
    writeFileSync(space.configPath, configText(reglas).replace(/ {2}- id: tcl-75t6c\n {4}nombre: (.*)\n {4}urls:\n {6}oncity: (.*)\n/, '  - urls:\n      oncity: $2\n    nombre: $1\n    id: tcl-75t6c\n'));
    assert.match(readFileSync(space.configPath, 'utf8'), /- urls:/, 'the YAML was really reordered');
    await runPipeline(options(space, { telegram, gh, hours: 6, price: 1_000_000 }));
    assert.equal(state(space).products['tcl-75t6c'].configHash, hashBefore);
    assert.equal(telegram.calls.length, 1);
    assert.match(String(telegram.calls[0]?.body.text), /cambió la mejor opción/);
  });

  test('Q3: todas-tiendas-fallan together with robots:<store> of every measured store counts as one open notice in the footer', async () => {
    const space = workspace(configText('', 'ninguno'));
    const gh = github();
    const fetcher = fakeFetch({ [ROBOTS_URL]: { status: 200, body: 'User-agent: *\nDisallow: /api/\n' } });
    const lines = /** @type {string[]} */ ([]);
    const base = options(space, { telegram: fakeTelegram([OK]), gh, hours: 0, env: {}, lines });
    await runPipeline({ ...base, http: { ...base.http, fetchImpl: fetcher.impl } });
    assert.deepEqual(state(space).ops.lastCauses, ['robots:oncity', 'todas-tiendas-fallan']);
    const page = readFileSync(join(space.outDir, 'index.html'), 'utf8');
    assert.match(page, /Avisos operativos abiertos: 1\./);
  });

  test('Q4: the causes of the notify step survive a run in which notify did not run; the pipeline ones are replaced', async () => {
    const space = workspace(configText());
    const gh = github();
    // First run with notify and no secrets: secretos-canal is recorded.
    await runPipeline(options(space, { telegram: fakeTelegram([OK]), gh, hours: 0, env: {} }));
    assert.ok(state(space).ops.lastCauses.includes('secretos-canal'));

    // A run without the notification step (the CLI keeps it as a separate step that may fail or be skipped).
    await runPipeline(withoutNotify(options(space, { telegram: fakeTelegram([OK]), gh, hours: 6, env: {} })));
    assert.deepEqual(state(space).ops.lastCauses, ['secretos-canal']);
    const page = readFileSync(join(space.outDir, 'index.html'), 'utf8');
    assert.match(page, /Avisos operativos abiertos: 1\./);
  });

  test('Q4: a pipeline cause that disappears is dropped while a carried one stays', async () => {
    const space = workspace(configText());
    const gh = github();
    const fetcher = fakeFetch({ [ROBOTS_URL]: { status: 200, body: 'User-agent: *\nDisallow: /api/\n' } });
    const blocked = options(space, { telegram: fakeTelegram([OK]), gh, hours: 0, env: {} });
    await runPipeline({ ...blocked, http: { ...blocked.http, fetchImpl: fetcher.impl } });
    assert.deepEqual(state(space).ops.lastCauses, ['robots:oncity', 'secretos-canal', 'todas-tiendas-fallan']);

    const healthy = withoutNotify(options(space, { telegram: fakeTelegram([OK]), gh, hours: 30, env: {} }));
    // The HTTP clock follows, so the 24 h copy of robots.txt expires and the store is read again.
    await runPipeline({ ...healthy, http: { ...healthy.http, now: () => at(30).getTime() } });
    assert.deepEqual(state(space).ops.lastCauses, ['secretos-canal']);
  });
});
