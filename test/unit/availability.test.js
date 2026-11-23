import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { computeAvailability, EXPECTED_RUNS, MAX_PAGES } from '../../src/notify/availability.js';
import { fakeGithub } from '../helpers/fake-github.js';

const NOW = new Date('2026-11-23T12:00:00Z');
const REPO = 'agusgut0/cuotear';
const TOKEN = 'ghs_SECRET_TOKEN_VALUE';
const PATH = `GET /repos/${REPO}/actions/workflows/monitor.yml/runs`;

/**
 * @param {number} count
 * @param {{ conclusion?: string | null, startId?: number, hoursAgo?: number }} [options]
 */
const runs = (count, { conclusion = 'success', startId = 1, hoursAgo = 1 } = {}) =>
  Array.from({ length: count }, (_, index) => ({ id: startId + index, conclusion, created_at: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString() }));

/** @param {ReturnType<typeof fakeGithub>} gh @param {Record<string, unknown>} [extra] */
const compute = (gh, extra = {}) => {
  /** @type {string[]} */
  const lines = [];
  return { promise: computeAvailability({ repo: REPO, token: TOKEN, fetch: gh.fetch, now: NOW, log: (line) => lines.push(line), ...extra }), lines };
};

/** @param {unknown[]} all pages of 100 */
const paged = (all) => (/** @type {{ path: string }} */ call) => {
  const page = Number(/[?&]page=(\d+)/.exec(call.path)?.[1] ?? 1);
  return { json: { total_count: all.length, workflow_runs: all.slice((page - 1) * 100, page * 100) } };
};

describe('computeAvailability', () => {
  test('exactly 95 % (114 of 120) is not a cause', async () => {
    const gh = fakeGithub({ [PATH]: paged(runs(114)) });
    const result = await compute(gh).promise;
    assert.equal(result.successful, 114);
    assert.equal(result.value, 95);
    assert.equal(result.cause, null);
  });

  test('113 of 120 (< 95 %) raises disponibilidad', async () => {
    const gh = fakeGithub({ [PATH]: paged(runs(113)) });
    const result = await compute(gh).promise;
    assert.equal(result.cause, 'disponibilidad');
    assert.ok((result.value ?? 100) < 95);
  });

  test('dropped runs count as not successful: the denominator is the expected 120', async () => {
    const gh = fakeGithub({ [PATH]: paged(runs(60)) });
    const result = await compute(gh).promise;
    assert.equal(result.expected, EXPECTED_RUNS);
    assert.equal(result.value, 50);
    assert.equal(result.cause, 'disponibilidad');
  });

  test('failed, cancelled and in-progress runs are not successful', async () => {
    const all = [...runs(100), ...runs(10, { conclusion: 'failure', startId: 200 }), ...runs(5, { conclusion: 'cancelled', startId: 300 }), ...runs(5, { conclusion: null, startId: 400 })];
    const result = await compute(fakeGithub({ [PATH]: paged(all) })).promise;
    assert.equal(result.successful, 100);
  });

  test('120 of 120 is 100 %; more than expected is capped; duplicate ids count once', async () => {
    const full = await compute(fakeGithub({ [PATH]: paged(runs(120)) })).promise;
    assert.equal(full.value, 100);
    const over = await compute(fakeGithub({ [PATH]: paged([...runs(130), ...runs(10)]) })).promise;
    assert.equal(over.value, 100);
  });

  test('runs older than 30 days are ignored', async () => {
    const all = [...runs(100), ...runs(50, { startId: 500, hoursAgo: 31 * 24 })];
    assert.equal((await compute(fakeGithub({ [PATH]: paged(all) })).promise).successful, 100);
  });

  test('queries only scheduled runs from the window start, paginating within a bound', async () => {
    const gh = fakeGithub({ [PATH]: paged(runs(250)) });
    await compute(gh).promise;
    assert.equal(gh.calls.length, MAX_PAGES);
    assert.match(gh.calls[0]?.path ?? '', /event=schedule&created=%3E%3D2026-10-24&per_page=100&page=1/);
    const unbounded = fakeGithub({ [PATH]: () => ({ json: { workflow_runs: runs(100) } }) });
    await compute(unbounded).promise;
    assert.equal(unbounded.calls.length, MAX_PAGES);
  });

  test('a young repo uses a shorter expected count so it does not alert in its first month', async () => {
    const since = new Date(NOW.getTime() - 5 * 24 * 3_600_000);
    const result = await compute(fakeGithub({ [PATH]: paged(runs(20)) }), { since }).promise;
    assert.equal(result.expected, 20);
    assert.equal(result.cause, null);
  });

  for (const status of [401, 403, 404, 500]) {
    test(`API status ${status} is unknown: no value, no cause`, async () => {
      const result = await compute(fakeGithub({ [PATH]: { status } })).promise;
      assert.equal(result.value, null);
      assert.equal(result.cause, null);
    });
  }

  test('network error, timeout and malformed JSON are unknown and never throw', async () => {
    assert.equal((await compute(fakeGithub({ [PATH]: { throws: new TypeError('fetch failed') } })).promise).value, null);
    assert.equal((await compute(fakeGithub({ [PATH]: { json: { workflow_runs: 'x' } } })).promise).value, null);
    const result = await computeAvailability({ repo: REPO, token: TOKEN, timeoutMs: 20, log: () => {}, fetch: (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))) });
    assert.equal(result.cause, null);
    assert.equal(result.value, null);
  });

  test('no token: unknown without any request; the token is never logged', async () => {
    const gh = fakeGithub({});
    assert.equal((await computeAvailability({ repo: REPO, token: undefined, fetch: gh.fetch, log: () => {} })).value, null);
    assert.equal(gh.calls.length, 0);
    const failing = fakeGithub({ [PATH]: { throws: new Error(`boom ${TOKEN}`) } });
    const { promise, lines } = compute(failing);
    await promise;
    assert.ok(!lines.join('\n').includes(TOKEN));
    assert.equal(failing.calls[0]?.headers.Authorization, `Bearer ${TOKEN}`);
  });
});
