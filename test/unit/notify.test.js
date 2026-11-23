import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildSeriesAlert } from '../../src/core/alerts.js';
import { runNotify } from '../../src/notify/notify.js';
import { emptyState } from '../../src/state/schema.js';
import { fakeClock } from '../helpers/fake-http.js';
import { fakeGithub } from '../helpers/fake-github.js';
import { fakeTelegram, OK, TELEGRAM_ENV } from '../helpers/fake-telegram.js';

const NOW = new Date('2026-11-23T12:00:00Z');
const HOUR = 3_600_000;
const REPO = 'owner/cuotear';

/** @param {'telegram' | 'ninguno'} [canal] @returns {import('../../src/config/types.js').Config} */
const config = (canal = 'telegram') => ({ version: 1, alertas: { canal }, productos: [{ id: 'tv', nombre: 'Smart TV', urls: { oncity: 'https://www.oncity.com/producto/p' } }] });

/**
 * @param {number} hoursAgo age of the detection
 * @param {string} [prevT]
 */
const alert = (hoursAgo, prevT = '2026-11-22T12:17:41Z') =>
  buildSeriesAlert({ productId: 'tv', tienda: 'oncity', serie: 'contado', rules: ['baja_estricta'], prevT, prevCents: 229_999_900, currentCents: 219_999_900, verifyPct: 90, medio: 'transferencia', desc: 0, detectedAt: new Date(NOW.getTime() - hoursAgo * HOUR).toISOString().replace(/\.\d{3}Z$/, 'Z') });

/** @param {import('../../src/core/alerts.js').Alert[]} [pending] @param {Partial<import('../../src/state/schema.js').RunState>} [extra] */
const stateWith = (pending = [], extra = {}) => ({ ...emptyState(), pendingAlerts: pending, ...extra });

/** @returns {{ workflow_runs: { id: number, conclusion: string, created_at: string }[] }} 120 successful scheduled runs in the window */
const healthyRuns = () => ({ workflow_runs: Array.from({ length: 100 }, (_, id) => ({ id, conclusion: 'success', created_at: '2026-11-20T00:00:00Z' })) });

/** @param {{ issues?: unknown[] }} [options] */
function github({ issues = [] } = {}) {
  let page = 0;
  return fakeGithub({
    'GET /repos/owner/cuotear/actions/workflows/monitor.yml/runs': () => {
      page += 1;
      return { json: page === 1 ? healthyRuns() : { workflow_runs: Array.from({ length: 20 }, (_, id) => ({ id: 1000 + id, conclusion: 'success', created_at: '2026-11-21T00:00:00Z' })) } };
    },
    'GET /repos/owner/cuotear/issues': { json: issues },
    'POST /repos/owner/cuotear/labels': { json: {} },
    'POST /repos/owner/cuotear/issues': { json: { number: 7 } },
  });
}

/**
 * @param {{
 *   state: import('../../src/state/schema.js').RunState,
 *   cfg?: import('../../src/config/types.js').Config | null,
 *   telegram?: ReturnType<typeof fakeTelegram>,
 *   gh?: ReturnType<typeof github>,
 *   env?: Record<string, string | undefined>,
 *   dryRun?: boolean,
 *   now?: Date,
 *   commitConflict?: boolean,
 *   extraCauses?: string[],
 *   lastCommit?: string,
 * }} input
 */
async function notify({ state, cfg = config(), telegram = fakeTelegram([OK]), gh = github(), env = TELEGRAM_ENV, dryRun = false, now = NOW, commitConflict = false, extraCauses = [], lastCommit = '2026-11-22T00:00:00Z' }) {
  const clock = fakeClock(now.getTime());
  /** @type {string[]} */
  const lines = [];
  const outcome = await runNotify({
    state,
    config: cfg,
    extraCauses,
    storeNames: { oncity: 'On City' },
    now,
    dryRun,
    log: (line) => lines.push(line),
    deps: { env, telegramFetch: telegram.fetch, githubFetch: gh.fetch, githubToken: 'ghs_faketoken', repo: REPO, sleep: clock.sleep, clock: clock.now, commitConflict, lastCommitDate: async () => lastCommit, siteUrl: 'https://owner.github.io/cuotear/' },
  });
  return { ...outcome, lines, telegram, gh };
}

describe('notify: alerts (DRT 13.3, 13.5)', () => {
  test('sends the pending alerts and marks them sent only after Telegram accepted', async () => {
    const pending = alert(1);
    const { state, telegram, summary } = await notify({ state: stateWith([pending]) });
    assert.equal(telegram.calls.length, 1);
    assert.deepEqual(state.pendingAlerts, []);
    assert.deepEqual(state.sentAlertIds, [{ id: pending.id, at: '2026-11-23T12:00:00Z' }]);
    assert.equal(summary.sent, 1);
  });

  test('a failed send keeps the alert pending and does not mark it sent', async () => {
    const pending = alert(1);
    const { state, summary } = await notify({ state: stateWith([pending]), telegram: fakeTelegram([{ status: 500, json: {} }]) });
    assert.deepEqual(state.pendingAlerts, [pending]);
    assert.deepEqual(state.sentAlertIds, []);
    assert.equal(summary.pending, 1);
  });

  test('the next run retries it and, once accepted, sends it exactly once', async () => {
    const pending = alert(1);
    const failed = await notify({ state: stateWith([pending]), telegram: fakeTelegram([{ status: 500, json: {} }]) });
    const retried = await notify({ state: failed.state, now: new Date(NOW.getTime() + 6 * HOUR) });
    assert.equal(retried.telegram.calls.length, 1);
    assert.deepEqual(retried.state.pendingAlerts, []);
    const again = await notify({ state: retried.state, now: new Date(NOW.getTime() + 12 * HOUR) });
    assert.equal(again.telegram.calls.length, 0);
  });

  test('dedupe: an id already in sentAlertIds is not sent again, even when it is pending', async () => {
    const pending = alert(1);
    const state = stateWith([pending], { sentAlertIds: [{ id: pending.id, at: '2026-11-23T06:00:00Z' }] });
    const { telegram, state: next } = await notify({ state });
    assert.equal(telegram.calls.length, 0);
    assert.deepEqual(next.pendingAlerts, []);
  });

  test('two pending alerts with the same id are sent once', async () => {
    const pending = alert(1);
    const { telegram, state } = await notify({ state: stateWith([pending, pending]) });
    assert.equal(telegram.calls.length, 1);
    assert.equal(state.sentAlertIds.length, 1);
  });

  test('a pending alert older than 48 h is discarded with a log line and not sent', async () => {
    const stale = alert(49, '2026-11-20T00:00:00Z');
    const fresh = alert(47, '2026-11-21T00:00:00Z');
    const { telegram, state, lines, summary } = await notify({ state: stateWith([stale, fresh]) });
    assert.equal(telegram.calls.length, 1);
    assert.deepEqual(state.sentAlertIds.map((entry) => entry.id), [fresh.id]);
    assert.deepEqual(state.pendingAlerts, []);
    assert.equal(summary.discarded, 1);
    assert.ok(lines.some((line) => line.includes('older than 48 h') && line.includes('discarded')));
  });

  test('sent ids are kept for 14 days and then forgotten', async () => {
    const state = stateWith([], {
      sentAlertIds: [
        { id: 'old', at: new Date(NOW.getTime() - 15 * 24 * HOUR).toISOString().replace(/\.\d{3}Z$/, 'Z') },
        { id: 'recent', at: new Date(NOW.getTime() - 13 * 24 * HOUR).toISOString().replace(/\.\d{3}Z$/, 'Z') },
      ],
    });
    const { state: next } = await notify({ state });
    assert.deepEqual(next.sentAlertIds.map((entry) => entry.id), ['recent']);
  });

  test('a lost state has no pending alerts: nothing is sent', async () => {
    const { telegram } = await notify({ state: emptyState() });
    assert.equal(telegram.calls.length, 0);
  });

  test('malformed pending alerts in the state are dropped, not rendered', async () => {
    const state = stateWith([/** @type {any} */ ({ kind: 'serie', id: 'x' })]);
    const { telegram, state: next, summary } = await notify({ state });
    assert.equal(telegram.calls.length, 0);
    assert.deepEqual(next.pendingAlerts, []);
    assert.equal(summary.discarded, 1);
  });

  test('canal: ninguno sends nothing, keeps nothing and raises no notice', async () => {
    const { telegram, state, gh, summary } = await notify({ state: stateWith([alert(1)]), cfg: config('ninguno'), env: {} });
    assert.equal(telegram.calls.length, 0);
    assert.deepEqual(state.pendingAlerts, []);
    assert.deepEqual(state.sentAlertIds, []);
    assert.deepEqual(summary.causes, []);
    assert.equal(gh.calls.some((call) => call.method === 'POST' && call.path.endsWith('/issues')), false);
  });

  test('dry run: no message, no GitHub call, the state is returned untouched', async () => {
    const state = stateWith([alert(1)]);
    const { telegram, gh, state: next } = await notify({ state, dryRun: true });
    assert.equal(telegram.calls.length, 0);
    assert.equal(gh.calls.length, 0);
    assert.equal(next, state);
  });
});

describe('notify: operational notices (DRT 13.6, 18.3, 10.3)', () => {
  /** @param {ReturnType<typeof github>} gh */
  const created = (gh) => gh.calls.filter((call) => call.method === 'POST' && call.path === '/repos/owner/cuotear/issues').map((call) => String(call.body.body).match(/cause=([a-z0-9:-]+)/)?.[1]);

  test('missing secrets: nothing is sent, the alert stays pending and secretos-canal is opened', async () => {
    const pending = alert(1);
    const { state, telegram, gh, summary } = await notify({ state: stateWith([pending]), env: {} });
    assert.equal(telegram.calls.length, 0);
    assert.deepEqual(state.pendingAlerts, [pending]);
    assert.ok(summary.causes.includes('secretos-canal'));
    assert.deepEqual(created(gh), ['secretos-canal']);
  });

  test('401: secretos-canal stays open on the next run even with nothing to send, and clears after a delivery', async () => {
    const pending = alert(1);
    const first = await notify({ state: stateWith([pending]), telegram: fakeTelegram([{ status: 401, json: { ok: false } }]) });
    assert.equal(first.state.ops.channelBroken, true);
    assert.ok(first.summary.causes.includes('secretos-canal'));
    assert.deepEqual(first.state.pendingAlerts, [pending]);

    // The token was replaced: the retry is accepted and the cause goes away.
    const second = await notify({ state: first.state, now: new Date(NOW.getTime() + 6 * HOUR) });
    assert.equal(second.state.ops.channelBroken, undefined);
    assert.ok(!second.summary.causes.includes('secretos-canal'));
  });

  test('causes of the run, the configuration, the commit and inactivity are reconciled together', async () => {
    const state = stateWith([], { ops: { lastCauses: ['robots:oncity'], measuredStores: ['oncity', 'megatone'] } });
    const { gh, summary, state: next } = await notify({ state, commitConflict: true, extraCauses: ['config-invalida'], lastCommit: '2026-09-01T00:00:00Z' });
    assert.deepEqual(summary.causes, ['commit-conflicto', 'config-invalida', 'inactividad', 'robots:oncity']);
    assert.deepEqual(created(gh).sort(), ['commit-conflicto', 'config-invalida', 'inactividad', 'robots:oncity']);
    assert.deepEqual(next.ops.lastCauses, summary.causes);
  });

  test('availability is stored for the site footer and below 95 % opens disponibilidad', async () => {
    const healthy = await notify({ state: stateWith() });
    assert.equal(healthy.state.ops.availability?.value, 100);
    assert.ok(!healthy.summary.causes.includes('disponibilidad'));

    const gh = fakeGithub({
      'GET /repos/owner/cuotear/actions/workflows/monitor.yml/runs': { json: { workflow_runs: [{ id: 1, conclusion: 'success', created_at: '2026-11-21T00:00:00Z' }] } },
      'GET /repos/owner/cuotear/issues': { json: [] },
      'POST /repos/owner/cuotear/labels': { json: {} },
      'POST /repos/owner/cuotear/issues': { json: { number: 1 } },
    });
    const poor = await notify({ state: stateWith(), gh });
    assert.ok(poor.summary.causes.includes('disponibilidad'));
  });

  test('a resolved cause closes its issue; GitHub failing never throws or loses the alerts', async () => {
    const body = '<!-- cuotear-ops:cause=inactividad -->\n<!-- cuotear-ops:runs=2 -->';
    const gh = github({ issues: [{ number: 5, body }] });
    const closed = await notify({ state: stateWith(), gh });
    assert.ok(gh.calls.some((call) => call.method === 'PATCH' && call.path === '/repos/owner/cuotear/issues/5' && call.body.state === 'closed'));
    assert.deepEqual(closed.summary.causes, []);

    const broken = fakeGithub({ 'GET ': { throws: new Error('network down') } });
    const pending = alert(1);
    const result = await notify({ state: stateWith([pending]), gh: /** @type {any} */ (broken) });
    assert.deepEqual(result.state.sentAlertIds.map((entry) => entry.id), [pending.id], 'the alert still went out');
  });

  test('no configuration at all: only the notice, nothing is sent', async () => {
    const { telegram, summary } = await notify({ state: emptyState(), cfg: null, extraCauses: ['config-ausente'] });
    assert.equal(telegram.calls.length, 0);
    assert.deepEqual(summary.causes, ['config-ausente']);
  });
});
