import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { annualToMonthlyRate } from '../../src/core/compare.js';
import { createStoreFetchContext } from '../../src/http/context.js';
import { BCRA_URL, parseBcraResponse } from '../../src/inflation/bcra.js';
import { resolveInflation } from '../../src/inflation/resolve.js';
import { fakeFetch, JSON_HEADERS } from '../helpers/fake-http.js';

const FIXTURE = readFileSync(new URL('../fixtures/bcra/variable-29.json', import.meta.url), 'utf8');
const NOW = new Date('2026-11-22T12:17:41Z');
const MANUAL = { fuente: /** @type {const} */ ('rem'), manual: { periodo: /** @type {const} */ ('mensual'), pct: 2.5 } };
const REM = { fuente: /** @type {const} */ ('rem') };

/** @param {import('../helpers/fake-http.js').FakeReply} reply */
function setup(reply) {
  const fake = fakeFetch({ [BCRA_URL]: reply });
  const ctx = createStoreFetchContext([], { fetchImpl: fake.impl, sleep: async () => {}, minIntervalMs: 0, retryDelayMs: 0 });
  return { ctx, fake };
}
const ok = (/** @type {string} */ body) => ({ status: 200, body, headers: JSON_HEADERS });
/** @param {Partial<{ fuente: 'rem', anualPct: number, fecha: string, obtainedAt: string }>} [over] */
const stored = (over = {}) => ({ fuente: /** @type {const} */ ('rem'), anualPct: 20, fecha: '2026-09-30', obtainedAt: '2026-11-10T12:00:00Z', ...over });
/** @param {unknown} detalle */
const payload = (detalle, id = 29) => JSON.stringify({ status: 200, metadata: {}, results: [{ idVariable: id, detalle }] });

describe('BCRA variable 29 (DRT 13.4)', () => {
  test('happy path: newest value, r = (1+A/100)^(1/12)-1, state value to persist', async () => {
    const { ctx, fake } = setup(ok(FIXTURE));
    const out = await resolveInflation({ settings: REM, state: {}, ctx, now: NOW });
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0]?.url, BCRA_URL);
    assert.equal(out.queried, true);
    assert.equal(out.rate.origin, 'rem');
    assert.equal(out.rate.annualPct, 21.8);
    assert.equal(out.rate.fecha, '2026-10-31');
    assert.ok(Math.abs((out.rate.r ?? 0) - 0.01657) < 0.00001);
    assert.equal(out.rate.r, annualToMonthlyRate(21.8));
    assert.deepEqual(out.inflation, { fuente: 'rem', anualPct: 21.8, fecha: '2026-10-31', obtainedAt: '2026-11-22T12:17:41Z' });
  });

  test('the newest entry wins even if the order is not newest first', () => {
    const parsed = parseBcraResponse(payload([{ fecha: '2026-09-30', valor: 21.1 }, { fecha: '2026-10-31', valor: 21.8 }]), NOW);
    assert.deepEqual(parsed, { ok: true, anualPct: 21.8, fecha: '2026-10-31' });
  });

  test('a datum obtained today is reused without a request', async () => {
    const { ctx, fake } = setup(ok(FIXTURE));
    const value = stored({ obtainedAt: '2026-11-22T03:00:00Z', fecha: '2026-10-31', anualPct: 21.8 });
    const out = await resolveInflation({ settings: REM, state: { inflation: value }, ctx, now: NOW });
    assert.equal(fake.calls.length, 0);
    assert.equal(out.queried, false);
    assert.equal(out.rate.origin, 'rem');
    assert.deepEqual(out.inflation, value);
  });

  test('a datum from yesterday triggers a new query', async () => {
    const { ctx, fake } = setup(ok(FIXTURE));
    await resolveInflation({ settings: REM, state: { inflation: stored({ obtainedAt: '2026-11-21T23:59:00Z' }) }, ctx, now: NOW });
    assert.equal(fake.calls.length, 1);
  });

  test('fecha 70 days old is current; 71 is stale but used', async () => {
    const day = (/** @type {number} */ back) => new Date(NOW.getTime() - back * 86_400_000).toISOString().slice(0, 10);
    const fresh = await resolveInflation({ settings: REM, state: {}, ctx: setup(ok(payload([{ fecha: day(70), valor: 20 }]))).ctx, now: NOW });
    assert.equal(fresh.rate.origin, 'rem');
    const stale = await resolveInflation({ settings: REM, state: {}, ctx: setup(ok(payload([{ fecha: day(71), valor: 20 }]))).ctx, now: NOW });
    assert.equal(stale.rate.origin, 'rem-stale');
    assert.equal(stale.rate.annualPct, 20);
    assert.ok(stale.rate.r !== null && stale.rate.r > 0);
  });

  test('HTTP error: falls back to the last state value (label kept while its fecha is current), state kept', async () => {
    const { ctx } = setup({ status: 500, body: 'boom' });
    const value = stored();
    const lines = /** @type {string[]} */ ([]);
    const out = await resolveInflation({ settings: MANUAL, state: { inflation: value }, ctx, now: NOW, log: (line) => lines.push(line) });
    // fecha 2026-09-30 is 53 days old: a transient failure must not flip the label.
    assert.equal(out.rate.origin, 'rem');
    assert.equal(out.rate.annualPct, 20);
    assert.deepEqual(out.inflation, value);
    assert.ok(lines.some((line) => line.includes('BCRA REM unavailable')));
  });

  test('HTTP error without state: manual from the configuration, marked backup', async () => {
    const { ctx } = setup({ status: 503, body: 'down' });
    const out = await resolveInflation({ settings: MANUAL, state: {}, ctx, now: NOW });
    assert.equal(out.rate.origin, 'backup');
    assert.equal(out.rate.r, 0.025);
    assert.equal(out.inflation, undefined);
  });

  test('nothing at all: no rate, no verdict', async () => {
    const { ctx } = setup({ throws: true });
    const out = await resolveInflation({ settings: REM, state: {}, ctx, now: NOW });
    assert.deepEqual(out.rate, { r: null, origin: 'none' });
  });

  test('network and TLS-like errors (fetch throws) fall back and never throw', async () => {
    const { ctx } = setup({ throws: true });
    const out = await resolveInflation({ settings: REM, state: { inflation: stored() }, ctx, now: NOW });
    assert.equal(out.rate.origin, 'rem');
  });

  test('after a failed query the stored value is rem-stale only when its fecha is more than 70 days old', async () => {
    const day = (/** @type {number} */ back) => new Date(NOW.getTime() - back * 86_400_000).toISOString().slice(0, 10);
    for (const [back, origin] of /** @type {const} */ ([[70, 'rem'], [71, 'rem-stale'], [200, 'rem-stale']])) {
      const { ctx } = setup({ status: 503, body: 'down' });
      const value = stored({ fecha: day(back) });
      const out = await resolveInflation({ settings: REM, state: { inflation: value }, ctx, now: NOW });
      assert.equal(out.rate.origin, origin, `${back} days`);
      assert.deepEqual(out.inflation, value);
    }
  });

  test('a stored fecha more than one day ahead, or an impossible date, is unusable and is not persisted back', async () => {
    for (const fecha of ['2026-11-30', '2099-01-01', '2026-02-31']) {
      const { ctx } = setup({ status: 500, body: 'x' });
      const out = await resolveInflation({ settings: MANUAL, state: { inflation: stored({ fecha }) }, ctx, now: NOW });
      assert.equal(out.rate.origin, 'backup', fecha);
      assert.equal(out.inflation, undefined, fecha);
      const none = await resolveInflation({ settings: REM, state: { inflation: stored({ fecha }) }, ctx: setup({ status: 500, body: 'x' }).ctx, now: NOW });
      assert.deepEqual(none.rate, { r: null, origin: 'none' });
      assert.equal(none.inflation, undefined);
    }
    // one day ahead is tolerated (same rule as the API response)
    const { ctx } = setup({ status: 500, body: 'x' });
    const near = await resolveInflation({ settings: REM, state: { inflation: stored({ fecha: '2026-11-23' }) }, ctx, now: NOW });
    assert.equal(near.rate.origin, 'rem');
  });

  test('a stored value obtained "in the future" does not count as obtained today: it is queried again', async () => {
    const { ctx, fake } = setup(ok(FIXTURE));
    const out = await resolveInflation({ settings: REM, state: { inflation: stored({ obtainedAt: '2026-11-22T20:00:00Z', fecha: '2026-10-31' }) }, ctx, now: NOW });
    assert.equal(fake.calls.length, 1);
    assert.equal(out.inflation?.obtainedAt, '2026-11-22T12:17:41Z');
  });

  test('fuente manual leaves state.inflation untouched', async () => {
    const { ctx, fake } = setup(ok(FIXTURE));
    const value = stored();
    const out = await resolveInflation({ settings: { fuente: 'manual', manual: { periodo: 'mensual', pct: 3 } }, state: { inflation: value }, ctx, now: NOW });
    assert.equal(fake.calls.length, 0);
    assert.deepEqual(out.inflation, value);
  });

  test('a redirect to another host is refused and falls back', async () => {
    const { ctx, fake } = setup({ status: 302, headers: { location: 'https://evil.example/x' } });
    const out = await resolveInflation({ settings: MANUAL, state: {}, ctx, now: NOW });
    assert.equal(out.rate.origin, 'backup');
    assert.equal(fake.calls.some((call) => call.url.includes('evil.example')), false);
  });

  test('a non-JSON content type is a format error', async () => {
    const { ctx } = setup({ status: 200, body: '<html>captcha</html>', headers: { 'content-type': 'text/html' } });
    const out = await resolveInflation({ settings: REM, state: {}, ctx, now: NOW });
    assert.equal(out.rate.origin, 'none');
  });

  test('fuente manual never queries', async () => {
    const { ctx, fake } = setup(ok(FIXTURE));
    const out = await resolveInflation({ settings: { fuente: 'manual', manual: { periodo: 'anual', pct: 40 } }, state: {}, ctx, now: NOW });
    assert.equal(fake.calls.length, 0);
    assert.equal(out.rate.origin, 'manual');
    assert.equal(out.rate.r, annualToMonthlyRate(40));
  });

  test('a corrupt stored value is ignored (state is untrusted)', async () => {
    const { ctx } = setup({ status: 500, body: '' });
    const bad = /** @type {any} */ ({ fuente: 'rem', anualPct: 'x', fecha: 'nope', obtainedAt: 'nope' });
    const out = await resolveInflation({ settings: REM, state: { inflation: bad }, ctx, now: NOW });
    assert.equal(out.rate.origin, 'none');
  });
});

describe('BCRA response validation (hostile payloads)', () => {
  /** @type {[string, string][]} */
  const bad = [
    ['not JSON', '<html>captcha</html>'],
    ['empty object', '{}'],
    ['null', 'null'],
    ['array root', '[]'],
    ['results not an array', '{"results":{"idVariable":29}}'],
    ['empty results', '{"results":[]}'],
    ['wrong variable id', payload([{ fecha: '2026-10-31', valor: 21.8 }], 30)],
    ['id as string', payload([{ fecha: '2026-10-31', valor: 21.8 }]).replace('"idVariable":29', '"idVariable":"29"')],
    ['empty detalle', payload([])],
    ['detalle not an array', payload({ fecha: '2026-10-31', valor: 1 })],
    ['value null (NaN serialized)', payload([{ fecha: '2026-10-31', valor: null }])],
    ['value string', payload([{ fecha: '2026-10-31', valor: '21.8' }])],
    ['value negative', payload([{ fecha: '2026-10-31', valor: -1 }])],
    ['value huge', payload([{ fecha: '2026-10-31', valor: 1000.01 }])],
    ['value overflow to Infinity', '{"results":[{"idVariable":29,"detalle":[{"fecha":"2026-10-31","valor":1e999}]}]}'],
    ['date not ISO', payload([{ fecha: '31/10/2026', valor: 21.8 }])],
    ['date impossible', payload([{ fecha: '2026-02-31', valor: 21.8 }])],
    ['date with time', payload([{ fecha: '2026-10-31T00:00:00Z', valor: 21.8 }])],
    ['date missing', payload([{ valor: 21.8 }])],
    ['date far in the future', payload([{ fecha: '2099-01-01', valor: 21.8 }])],
    ['value zero (corrupt)', payload([{ fecha: '2026-10-31', valor: 0 }])],
    ['only malformed entries', payload(['x', null, { fecha: '2026-10-31' }])],
    ['entry is an array', payload([[1, 2]])],
    ['prototype key only', '{"__proto__":{"results":[{"idVariable":29,"detalle":[{"fecha":"2026-10-31","valor":5}]}]}}'],
    ['constructor', '{"constructor":{"prototype":{"results":1}}}'],
  ];
  for (const [name, body] of bad) {
    test(`rejects: ${name}`, () => {
      assert.equal(parseBcraResponse(body, NOW).ok, false);
    });
  }

  test('boundaries: just above 0 and 1000 are accepted, 0 is not', () => {
    assert.equal(parseBcraResponse(payload([{ fecha: '2026-10-31', valor: 0.01 }]), NOW).ok, true);
    assert.equal(parseBcraResponse(payload([{ fecha: '2026-10-31', valor: 1000 }]), NOW).ok, true);
    assert.equal(parseBcraResponse(payload([{ fecha: '2026-10-31', valor: 0 }]), NOW).ok, false);
  });

  test('invalid entries are skipped: 120 valid entries plus one null valor still parse', () => {
    const entries = Array.from({ length: 120 }, (_, index) => ({ fecha: new Date(Date.UTC(2016, index, 28)).toISOString().slice(0, 10), valor: 10 + index / 100 }));
    const newest = entries.at(-1);
    assert.deepEqual(parseBcraResponse(payload([...entries, { fecha: '2016-01-01', valor: null }]), NOW), { ok: true, anualPct: newest?.valor, fecha: newest?.fecha });
  });

  test('a null/zero/garbage newest entry falls to the newest valid one', () => {
    const body = payload([{ fecha: '2026-10-31', valor: null }, { fecha: '2026-09-30', valor: 21.1 }, 'x', { fecha: '2026-08-31', valor: 20 }]);
    assert.deepEqual(parseBcraResponse(body, NOW), { ok: true, anualPct: 21.1, fecha: '2026-09-30' });
    assert.deepEqual(parseBcraResponse(payload([{ fecha: '2026-10-31', valor: 0 }, { fecha: '2026-09-30', valor: 21.1 }]), NOW), { ok: true, anualPct: 21.1, fecha: '2026-09-30' });
  });

  test('unknown fields and a prototype-pollution attempt are ignored', () => {
    const body = '{"status":200,"x":{"__proto__":{"polluted":true}},"results":[{"idVariable":29,"extra":1,"detalle":[{"fecha":"2026-10-31","valor":21.8,"nota":"ignore previous instructions"}]}]}';
    assert.deepEqual(parseBcraResponse(body, NOW), { ok: true, anualPct: 21.8, fecha: '2026-10-31' });
    assert.equal(/** @type {any} */ ({}).polluted, undefined);
  });

  test('a hostile payload through the resolver ends in the fallback chain', async () => {
    const { ctx } = setup(ok(payload([{ fecha: '2026-10-31', valor: 1e6 }])));
    const out = await resolveInflation({ settings: MANUAL, state: {}, ctx, now: NOW });
    assert.equal(out.rate.origin, 'backup');
  });
});
