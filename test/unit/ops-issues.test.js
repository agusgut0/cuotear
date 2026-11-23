import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildBody, dedupeCauses, isValidCause, MAX_PAGES, parseCause, reconcileOpsIssues } from '../../src/notify/ops-issues.js';
import { fakeGithub } from '../helpers/fake-github.js';

const NOW = new Date('2026-11-23T12:00:00Z');
const REPO = 'agusgut0/cuotear';
const TOKEN = 'ghs_SECRET_TOKEN_VALUE';
const RUN_URL = `https://github.com/${REPO}/actions/runs/12345`;

/** @param {number} number @param {string} cause @param {number} runs */
const issue = (number, cause, runs = 1) => ({ number, body: buildBody({ cause, runs, now: NOW }) });

/**
 * @param {string[]} causes
 * @param {ReturnType<typeof fakeGithub>} gh
 * @param {Record<string, unknown>} [extra]
 */
function run(causes, gh, extra = {}) {
  /** @type {string[]} */
  const lines = [];
  const promise = reconcileOpsIssues({ causes, repo: REPO, token: TOKEN, fetch: gh.fetch, now: NOW, runUrl: RUN_URL, log: (line) => lines.push(line), ...extra });
  return { promise, lines };
}

describe('cause keys and markers', () => {
  test('only known causes and robots:<store> with a strict pattern are valid', () => {
    for (const cause of ['todas-tiendas-fallan', 'secretos-canal', 'config-invalida', 'config-ausente', 'historial-45mb', 'historial-100mb', 'commit-conflicto', 'inactividad', 'disponibilidad', 'robots:naldo']) {
      assert.equal(isValidCause(cause), true, cause);
    }
    for (const cause of ['robots:', 'robots:Naldo', 'robots:a b', 'robots:x\n--> <script>', 'desconocida', '', 'robots:' + 'a'.repeat(31), '__proto__', 'constructor', 42, null]) {
      assert.equal(isValidCause(cause), false, String(cause));
    }
  });

  test('parseCause survives edited, malformed or hostile bodies', () => {
    assert.equal(parseCause(issue(1, 'inactividad').body), 'inactividad');
    assert.equal(parseCause(`texto agregado por una persona\n${issue(1, 'robots:naldo').body}\nmás texto`), 'robots:naldo');
    assert.equal(parseCause(null), undefined);
    assert.equal(parseCause(undefined), undefined);
    assert.equal(parseCause('<!-- cuotear-ops:cause=hacked -->'), undefined);
    assert.equal(parseCause('<!-- cuotear-ops:cause=inactividad'), undefined);
    assert.equal(parseCause('sin marcador'), undefined);
    assert.equal(parseCause('<!-- cuotear-ops:cause=robots:<img onerror=x> -->'), undefined);
  });

  test('the body holds fixed text, the key, the timestamp and a validated run link only', () => {
    const body = buildBody({ cause: 'robots:naldo', runs: 3, now: NOW, runUrl: RUN_URL });
    assert.match(body, /<!-- cuotear-ops:cause=robots:naldo -->/);
    assert.match(body, /Ejecuciones consecutivas con este aviso: 3/);
    assert.match(body, /2026-11-23T12:00:00\.000Z/);
    assert.ok(body.includes(RUN_URL));
    assert.ok(!buildBody({ cause: 'inactividad', runs: 1, now: NOW }).includes('Ejecución:'));
  });
});

describe('dedupeCauses', () => {
  test('drops todas-tiendas-fallan when robots covers every measured store', () => {
    assert.deepEqual(dedupeCauses(['robots:a1', 'robots:b2', 'todas-tiendas-fallan'], ['a1', 'b2']), ['robots:a1', 'robots:b2']);
  });
  test('keeps it when some measured store is not explained by robots', () => {
    assert.deepEqual(dedupeCauses(['robots:a1', 'todas-tiendas-fallan'], ['a1', 'b2']), ['robots:a1', 'todas-tiendas-fallan']);
  });
  test('keeps it without store information', () => {
    assert.deepEqual(dedupeCauses(['robots:a1', 'todas-tiendas-fallan'], undefined), ['robots:a1', 'todas-tiendas-fallan']);
    assert.deepEqual(dedupeCauses(['todas-tiendas-fallan'], []), ['todas-tiendas-fallan']);
  });
});

describe('reconcileOpsIssues', () => {
  test('creates the label and the issue for a new cause', async () => {
    const gh = fakeGithub({
      [`GET /repos/${REPO}/issues`]: { json: [] },
      [`POST /repos/${REPO}/labels`]: { status: 201, json: {} },
      [`POST /repos/${REPO}/issues`]: { status: 201, json: { number: 7 } },
    });
    const { promise } = run(['inactividad'], gh);
    const result = await promise;
    assert.deepEqual(result, { status: 'ok', created: ['inactividad'], updated: [], closed: [], errors: 0 });
    const verbs = gh.calls.map((call) => `${call.method} ${call.path.split('?')[0]}`);
    assert.deepEqual(verbs, [`GET /repos/${REPO}/issues`, `POST /repos/${REPO}/labels`, `POST /repos/${REPO}/issues`]);
    const created = gh.calls[2]?.body;
    assert.match(created.title, /^\[cuotear-ops\] /);
    assert.deepEqual(created.labels, ['cuotear-ops']);
    assert.match(created.body, /<!-- cuotear-ops:cause=inactividad -->/);
  });

  test('an existing label (422) does not stop creation', async () => {
    const gh = fakeGithub({
      [`GET /repos/${REPO}/issues`]: { json: [] },
      [`POST /repos/${REPO}/labels`]: { status: 422, json: {} },
      [`POST /repos/${REPO}/issues`]: { status: 201, json: {} },
    });
    const { promise, lines } = run(['inactividad'], gh);
    assert.equal((await promise).created.length, 1);
    assert.ok(!lines.some((line) => line.includes('label failed')));
  });

  test('the label is created once for several new causes and not at all when none is created', async () => {
    const gh = fakeGithub({ [`GET /repos/${REPO}/issues`]: { json: [] }, 'POST ': { status: 201 } });
    await run(['inactividad', 'disponibilidad'], gh).promise;
    assert.equal(gh.calls.filter((call) => call.path.endsWith('/labels')).length, 1);
    const none = fakeGithub({ [`GET /repos/${REPO}/issues`]: { json: [] } });
    await run([], none).promise;
    assert.equal(none.calls.length, 1);
  });

  test('updates the body of an existing issue, increments runs, never comments', async () => {
    const gh = fakeGithub({
      [`GET /repos/${REPO}/issues`]: { json: [issue(5, 'inactividad', 4)] },
      [`PATCH /repos/${REPO}/issues/5`]: { json: {} },
    });
    const result = await run(['inactividad'], gh).promise;
    assert.deepEqual(result.updated, ['inactividad']);
    assert.equal(gh.calls.length, 2);
    assert.match(gh.calls[1]?.body.body, /Ejecuciones consecutivas con este aviso: 5/);
    assert.ok(gh.calls[1]?.body.body.includes(RUN_URL));
    assert.equal(gh.calls[1]?.body.state, undefined);
  });

  test('a tampered runs counter restarts from 1 instead of breaking', async () => {
    const body = `${issue(5, 'inactividad').body}`.replace(/runs=\d+/, 'runs=abc');
    const gh = fakeGithub({ [`GET /repos/${REPO}/issues`]: { json: [{ number: 5, body }] }, 'PATCH ': { json: {} } });
    await run(['inactividad'], gh).promise;
    assert.match(gh.calls[1]?.body.body, /consecutivas con este aviso: 1/);
  });

  test('an absent cause gets a resolved comment and is closed', async () => {
    const gh = fakeGithub({
      [`GET /repos/${REPO}/issues`]: { json: [issue(9, 'disponibilidad')] },
      [`POST /repos/${REPO}/issues/9/comments`]: { status: 201 },
      [`PATCH /repos/${REPO}/issues/9`]: { json: {} },
    });
    const result = await run([], gh).promise;
    assert.deepEqual(result.closed, ['disponibilidad']);
    assert.match(gh.calls[1]?.body.body, /^Resuelto/);
    assert.deepEqual(gh.calls[2]?.body, { state: 'closed', state_reason: 'completed' });
  });

  test('a failing comment leaves the issue open for the next run', async () => {
    const gh = fakeGithub({
      [`GET /repos/${REPO}/issues`]: { json: [issue(9, 'disponibilidad')] },
      'POST ': { status: 500 },
    });
    const result = await run([], gh).promise;
    assert.deepEqual(result.closed, []);
    assert.equal(result.errors, 1);
    assert.ok(!gh.calls.some((call) => call.method === 'PATCH'));
  });

  test('issues without a valid marker, pull requests and edited markers are left alone', async () => {
    const gh = fakeGithub({
      [`GET /repos/${REPO}/issues`]: {
        json: [
          { number: 1, body: 'creado a mano con la etiqueta' },
          { number: 2, body: null },
          { number: 3, body: '<!-- cuotear-ops:cause=hacked -->' },
          { number: 4, body: issue(4, 'inactividad').body, pull_request: {} },
          null,
          'texto',
        ],
      },
    });
    const result = await run([], gh).promise;
    assert.deepEqual(result, { status: 'ok', created: [], updated: [], closed: [], errors: 0 });
    assert.equal(gh.calls.length, 1);
  });

  test('duplicates of the same cause: first one updated; all closed when it disappears', async () => {
    const list = { json: [issue(3, 'inactividad'), issue(8, 'inactividad')] };
    const keep = fakeGithub({ [`GET /repos/${REPO}/issues`]: list, 'PATCH ': { json: {} } });
    await run(['inactividad'], keep).promise;
    assert.deepEqual(keep.calls.filter((call) => call.method === 'PATCH').map((call) => call.path), [`/repos/${REPO}/issues/3`]);
    const gone = fakeGithub({ [`GET /repos/${REPO}/issues`]: list, 'POST ': { status: 201 }, 'PATCH ': { json: {} } });
    await run([], gone).promise;
    assert.equal(gone.calls.filter((call) => call.method === 'PATCH').length, 2);
  });

  test('dedupe: robots covering every measured store does not open todas-tiendas-fallan', async () => {
    const gh = fakeGithub({ [`GET /repos/${REPO}/issues`]: { json: [] }, 'POST ': { status: 201 } });
    const result = await run(['robots:naldo', 'todas-tiendas-fallan'], gh, { measuredStores: ['naldo'] }).promise;
    assert.deepEqual(result.created, ['robots:naldo']);
  });

  test('an open todas-tiendas-fallan issue is closed once deduplicated away', async () => {
    const gh = fakeGithub({
      [`GET /repos/${REPO}/issues`]: { json: [issue(2, 'todas-tiendas-fallan'), issue(3, 'robots:naldo')] },
      'POST ': { status: 201 },
      'PATCH ': { json: {} },
    });
    const result = await run(['robots:naldo', 'todas-tiendas-fallan'], gh, { measuredStores: ['naldo'] }).promise;
    assert.deepEqual(result.closed, ['todas-tiendas-fallan']);
    assert.deepEqual(result.updated, ['robots:naldo']);
  });

  test('invalid cause keys are ignored with a log and never reach the API', async () => {
    const gh = fakeGithub({ [`GET /repos/${REPO}/issues`]: { json: [] } });
    const { promise, lines } = run(['robots:<script>'], gh);
    await promise;
    assert.equal(gh.calls.length, 1);
    assert.ok(lines.some((line) => line.includes('invalid key')));
    assert.ok(!lines.some((line) => line.includes('<script>')));
  });

  test('a foreign run URL is dropped from the body', async () => {
    const gh = fakeGithub({ [`GET /repos/${REPO}/issues`]: { json: [] }, 'POST ': { status: 201 } });
    await run(['inactividad'], gh, { runUrl: 'https://evil.example/actions/runs/1' }).promise;
    assert.ok(!gh.calls.at(-1)?.body.body.includes('evil.example'));
  });

  test('pagination: follows full pages and stops at the bound', async () => {
    const full = Array.from({ length: 100 }, (_, index) => ({ number: index + 1, body: 'sin marcador' }));
    const gh = fakeGithub({ [`GET /repos/${REPO}/issues`]: { json: full } });
    const result = await run([], gh).promise;
    assert.equal(result.status, 'ok');
    assert.equal(gh.calls.length, MAX_PAGES);
    assert.match(gh.calls[1]?.path ?? '', /page=2/);
    const short = fakeGithub({ [`GET /repos/${REPO}/issues`]: (call) => ({ json: call.path.includes('&page=1') ? full : [] }) });
    await run([], short).promise;
    assert.equal(short.calls.length, 2);
  });

  test('dry run touches nothing, not even a GET', async () => {
    const gh = fakeGithub({});
    const { promise, lines } = run(['inactividad'], gh, { dryRun: true });
    assert.equal((await promise).status, 'skipped');
    assert.equal(gh.calls.length, 0);
    assert.ok(lines.some((line) => line.includes('dry run')));
  });

  test('no token or an invalid repo skips quietly', async () => {
    const gh = fakeGithub({});
    assert.equal((await reconcileOpsIssues({ causes: ['inactividad'], repo: REPO, token: undefined, fetch: gh.fetch, log: () => {} })).status, 'skipped');
    assert.equal((await reconcileOpsIssues({ causes: ['inactividad'], repo: '../x', token: TOKEN, fetch: gh.fetch, log: () => {} })).status, 'skipped');
    assert.equal(gh.calls.length, 0);
  });

  for (const status of [401, 403, 404, 429, 500, 503]) {
    test(`listing failure with ${status} is logged, never thrown, and nothing else is called`, async () => {
      const gh = fakeGithub({ [`GET /repos/${REPO}/issues`]: { status } });
      const { promise, lines } = run(['inactividad'], gh);
      const result = await promise;
      assert.equal(result.status, 'failed');
      assert.equal(gh.calls.length, 1);
      assert.ok(lines.some((line) => line.includes(`status ${status}`)));
    });
  }

  test('network error and timeout never throw', async () => {
    const reset = fakeGithub({ [`GET /repos/${REPO}/issues`]: { throws: new TypeError('fetch failed') } });
    assert.equal((await run(['inactividad'], reset).promise).status, 'failed');
    const timeout = await reconcileOpsIssues({
      causes: ['inactividad'],
      repo: REPO,
      token: TOKEN,
      timeoutMs: 20,
      log: () => {},
      fetch: (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
    });
    assert.equal(timeout.status, 'failed');
  });

  test('a failing create or update counts an error but the run continues', async () => {
    const gh = fakeGithub({
      [`GET /repos/${REPO}/issues`]: { json: [issue(5, 'inactividad')] },
      'PATCH ': { status: 500 },
      'POST ': { status: 201 },
    });
    const result = await run(['inactividad', 'disponibilidad'], gh).promise;
    assert.equal(result.errors, 1);
    assert.deepEqual(result.created, ['disponibilidad']);
  });

  test('the token only travels in the Authorization header and never in logs, URLs or bodies', async () => {
    const gh = fakeGithub({
      [`GET /repos/${REPO}/issues`]: { json: [issue(9, 'disponibilidad')] },
      'POST ': { status: 500 },
    });
    const { promise, lines } = run(['inactividad'], gh);
    await promise;
    for (const call of gh.calls) {
      assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`);
      assert.ok(!call.url.includes(TOKEN));
      assert.ok(!JSON.stringify(call.body ?? '').includes(TOKEN));
    }
    assert.ok(lines.length > 0);
    assert.ok(!lines.join('\n').includes(TOKEN));
    const failing = fakeGithub({ [`GET /repos/${REPO}/issues`]: { throws: new Error(`boom ${TOKEN}`) } });
    const second = run(['inactividad'], failing);
    await second.promise;
    assert.ok(!second.lines.join('\n').includes(TOKEN));
  });
});
