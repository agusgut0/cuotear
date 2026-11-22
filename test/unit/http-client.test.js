import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createFetchContext, HostNotAllowedError } from '../../src/http/client.js';
import { buildUserAgent } from '../../src/http/user-agent.js';
import { fakeClock, fakeFetch, HTML_HEADERS, JSON_HEADERS } from '../helpers/fake-http.js';

const HOST = 'www.oncity.com';
const ROBOTS_URL = `https://${HOST}/robots.txt`;
const API_URL = `https://${HOST}/api/catalog_system/pub/products/search/tv/p`;
const ROBOTS_OK = { body: 'User-agent: *\nDisallow: /*checkout*\n' };

/**
 * @param {Record<string, import('../helpers/fake-http.js').FakeReply | import('../helpers/fake-http.js').FakeReply[]>} routes
 * @param {Partial<import('../../src/http/client.js').ClientOptions>} [options]
 */
function setup(routes, options = {}) {
  const clock = fakeClock();
  const fake = fakeFetch({ [ROBOTS_URL]: ROBOTS_OK, ...routes }, clock.now);
  const ctx = createFetchContext({ allowedHosts: [HOST], fetchImpl: fake.impl, now: clock.now, sleep: clock.sleep, userAgent: 'cuotear/test', ...options });
  return { ctx, clock, fake };
}

/** @param {import('../../src/http/client.js').HttpResult} result */
function failureKind(result) {
  return result.ok ? 'ok' : result.kind;
}

describe('allowlist (SSRF)', () => {
  test('rejects hosts outside the allowlist, http, ports, credentials and IP literals without any request', async () => {
    const { ctx, fake } = setup({});
    for (const url of ['https://evil.example/x', `http://${HOST}/x`, `https://${HOST}:8443/x`, `https://user:pw@${HOST}/x`, 'https://127.0.0.1/x', 'https://[::1]/x', 'not a url']) {
      await assert.rejects(ctx.get(url), HostNotAllowedError, url);
    }
    assert.equal(fake.calls.length, 0);
  });

  test('a redirect to another host is refused and not followed', async () => {
    const { ctx, fake } = setup({ [API_URL]: { status: 302, headers: { location: 'https://evil.example/steal' } } });
    const result = await ctx.get(API_URL);
    assert.equal(failureKind(result), 'redirect');
    assert.equal(fake.calls.some((c) => c.url.includes('evil.example')), false);
  });

  test('a redirect inside the same host is followed and its path is checked against robots.txt', async () => {
    const { ctx, fake } = setup({
      [API_URL]: { status: 301, headers: { location: '/api/catalog_system/pub/products/search/tv2/p' } },
      [`https://${HOST}/api/catalog_system/pub/products/search/tv2/p`]: { body: '[]', headers: JSON_HEADERS },
      [`https://${HOST}/api/x`]: { status: 302, headers: { location: '/api/checkout/pub' } },
    });
    assert.equal(failureKind(await ctx.get(API_URL)), 'ok');
    assert.equal(failureKind(await ctx.get(`https://${HOST}/api/x`)), 'robots');
    assert.equal(fake.calls.some((c) => c.url.endsWith('/api/checkout/pub')), false);
  });
});

describe('robots.txt at run time (RNF-07, ADR-0007)', () => {
  test('a disallowed path is never requested and is reported as a robots failure', async () => {
    const { ctx, fake } = setup({});
    const result = await ctx.get(`https://${HOST}/api/checkout/pub/orderForms/simulation`);
    assert.equal(failureKind(result), 'robots');
    assert.deepEqual(fake.calls.map((c) => c.url), [ROBOTS_URL]);
  });

  test('an allowed path is requested, with the identifiable User-Agent and no cookies', async () => {
    const { ctx, fake } = setup({ [API_URL]: { body: '[]', headers: JSON_HEADERS } });
    const result = await ctx.get(API_URL);
    assert.equal(failureKind(result), 'ok');
    const call = fake.calls.find((c) => c.url === API_URL);
    assert.equal(call?.headers['user-agent'], 'cuotear/test');
    assert.equal(call?.headers['accept-language'], 'es-AR');
    assert.equal(Object.keys(call?.headers ?? {}).includes('cookie'), false);
  });

  test('robots.txt is downloaded once per host and run, and not again within 24 h across runs', async () => {
    const { ctx, fake, clock } = setup({ [API_URL]: { body: '[]', headers: JSON_HEADERS } });
    await ctx.get(API_URL);
    await ctx.get(API_URL);
    assert.equal(fake.calls.filter((c) => c.url === ROBOTS_URL).length, 1);

    const second = fakeFetch({ [API_URL]: { body: '[]', headers: JSON_HEADERS } }, clock.now);
    const next = createFetchContext({ allowedHosts: [HOST], fetchImpl: second.impl, now: clock.now, sleep: clock.sleep, userAgent: 'u', robots: ctx.robotsSnapshot() });
    await next.get(API_URL);
    assert.equal(second.calls.some((c) => c.url === ROBOTS_URL), false);

    clock.advance(25 * 3600 * 1000);
    const third = fakeFetch({ [ROBOTS_URL]: ROBOTS_OK, [API_URL]: { body: '[]', headers: JSON_HEADERS } }, clock.now);
    const later = createFetchContext({ allowedHosts: [HOST], fetchImpl: third.impl, now: clock.now, sleep: clock.sleep, userAgent: 'u', robots: ctx.robotsSnapshot() });
    await later.get(API_URL);
    assert.equal(third.calls.filter((c) => c.url === ROBOTS_URL).length, 1);
  });

  test('robots.txt answering 4xx means everything is allowed (RFC 9309)', async () => {
    const { ctx } = setup({ [ROBOTS_URL]: { status: 404 }, [`https://${HOST}/api/checkout/x`]: { body: '[]', headers: JSON_HEADERS } });
    assert.equal(failureKind(await ctx.get(`https://${HOST}/api/checkout/x`)), 'ok');
  });

  test('unreachable robots.txt without a copy forbids everything for that run', async () => {
    const { ctx, fake } = setup({ [ROBOTS_URL]: { status: 500 }, [API_URL]: { body: '[]', headers: JSON_HEADERS } });
    assert.equal(failureKind(await ctx.get(API_URL)), 'robots');
    assert.equal(fake.calls.some((c) => c.url === API_URL), false);
    assert.deepEqual(ctx.robotsSnapshot(), {}, 'the disallow-all fallback is not persisted');
  });

  test('unreachable robots.txt uses a cached copy of at most 7 days and refuses an older one', async () => {
    const clock = fakeClock();
    const entry = (/** @type {number} */ ageDays) => ({
      [HOST]: { fetchedAt: new Date(clock.now() - ageDays * 86_400_000).toISOString(), status: 200, rules: [{ allow: false, pattern: '/api/checkout' }] },
    });
    const routes = { [ROBOTS_URL]: { status: 503 }, [API_URL]: { body: '[]', headers: JSON_HEADERS } };

    const fresh = fakeFetch(routes, clock.now);
    const usesCopy = createFetchContext({ allowedHosts: [HOST], fetchImpl: fresh.impl, now: clock.now, sleep: clock.sleep, userAgent: 'u', robots: entry(3) });
    assert.equal(failureKind(await usesCopy.get(API_URL)), 'ok');

    const stale = fakeFetch(routes, clock.now);
    const tooOld = createFetchContext({ allowedHosts: [HOST], fetchImpl: stale.impl, now: clock.now, sleep: clock.sleep, userAgent: 'u', robots: entry(8) });
    assert.equal(failureKind(await tooOld.get(API_URL)), 'robots');
  });

  test('hosts outside robotsHosts are not subject to robots.txt', async () => {
    const clock = fakeClock();
    const fake = fakeFetch({ 'https://api.example.org/v1': { body: '{}', headers: JSON_HEADERS } }, clock.now);
    const ctx = createFetchContext({ allowedHosts: ['api.example.org'], robotsHosts: [], fetchImpl: fake.impl, now: clock.now, sleep: clock.sleep, userAgent: 'u' });
    assert.equal(failureKind(await ctx.get('https://api.example.org/v1')), 'ok');
    assert.equal(fake.calls.length, 1);
  });
});

describe('rate limit (1 request/s per host)', () => {
  test('requests to the same host, robots.txt included, start at least 1000 ms apart', async () => {
    const { ctx, fake } = setup({ [API_URL]: { body: '[]', headers: JSON_HEADERS } });
    await Promise.all([ctx.get(API_URL), ctx.get(API_URL), ctx.get(API_URL)]);
    const starts = fake.calls.map((c) => c.at);
    assert.equal(starts.length, 4);
    for (let i = 1; i < starts.length; i += 1) assert.ok((starts[i] ?? 0) - (starts[i - 1] ?? 0) >= 1000, `gap ${i}: ${starts}`);
  });

  test('different hosts do not wait for each other', async () => {
    const clock = fakeClock();
    const fake = fakeFetch({ 'https://a.example/x': { body: '{}', headers: JSON_HEADERS }, 'https://b.example/x': { body: '{}', headers: JSON_HEADERS } }, clock.now);
    const ctx = createFetchContext({ allowedHosts: ['a.example', 'b.example'], robotsHosts: [], fetchImpl: fake.impl, now: clock.now, sleep: clock.sleep, userAgent: 'u' });
    await Promise.all([ctx.get('https://a.example/x'), ctx.get('https://b.example/x')]);
    assert.deepEqual(fake.calls.map((c) => c.at), [clock.now(), clock.now()]);
  });
});

describe('timeout, size cap and retry policy', () => {
  test('a request that does not answer in time is a timeout failure (after its single retry)', async () => {
    const { ctx, fake } = setup({ [API_URL]: { delayUntilAbort: true } }, { timeoutMs: 15 });
    const result = await ctx.get(API_URL);
    assert.equal(failureKind(result), 'timeout');
    assert.equal(fake.calls.filter((c) => c.url === API_URL).length, 2);
  });

  test('a body over the cap is cut and reported as too_large, with no retry', async () => {
    const { ctx, fake } = setup({ [API_URL]: { body: 'x'.repeat(2000), headers: JSON_HEADERS } }, { maxBytes: 1000 });
    assert.equal(failureKind(await ctx.get(API_URL)), 'too_large');
    assert.equal(fake.calls.filter((c) => c.url === API_URL).length, 1);
  });

  test('a declared content-length over the cap is rejected before reading the body', async () => {
    const { ctx } = setup({ [API_URL]: { body: 'x', headers: { ...JSON_HEADERS, 'content-length': '999999999' } } });
    assert.equal(failureKind(await ctx.get(API_URL)), 'too_large');
  });

  test('a 5xx is retried once after the backoff and then succeeds or fails', async () => {
    const recovering = setup({ [API_URL]: [{ status: 502 }, { body: '[]', headers: JSON_HEADERS }] });
    assert.equal(failureKind(await recovering.ctx.get(API_URL)), 'ok');
    assert.equal(recovering.fake.calls.filter((c) => c.url === API_URL).length, 2);
    const gap = (recovering.fake.calls.at(-1)?.at ?? 0) - (recovering.fake.calls.at(-2)?.at ?? 0);
    assert.ok(gap >= 5000, `backoff of 5 s expected, got ${gap}`);

    const persistent = setup({ [API_URL]: { status: 500 } });
    const result = await persistent.ctx.get(API_URL);
    assert.equal(failureKind(result), 'http');
    assert.equal(persistent.fake.calls.filter((c) => c.url === API_URL).length, 2, 'one retry only');
  });

  test('a network error is retried once', async () => {
    const { ctx, fake } = setup({ [API_URL]: [{ throws: true }, { body: '[]', headers: JSON_HEADERS }] });
    assert.equal(failureKind(await ctx.get(API_URL)), 'ok');
    assert.equal(fake.calls.filter((c) => c.url === API_URL).length, 2);
  });

  test('429 honours Retry-After (capped at 30 s) and is then reported as blocked', async () => {
    const { ctx, fake } = setup({ [API_URL]: { status: 429, headers: { 'retry-after': '120' } } });
    assert.equal(failureKind(await ctx.get(API_URL)), 'blocked');
    const calls = fake.calls.filter((c) => c.url === API_URL);
    assert.equal(calls.length, 2);
    const wait = (calls[1]?.at ?? 0) - (calls[0]?.at ?? 0);
    assert.ok(wait >= 30_000 && wait < 31_000, `wait ${wait}`);
  });

  test('403, 401, 451, captcha and challenge pages are blocked and never retried', async () => {
    for (const reply of [
      { status: 403, body: 'denied', headers: HTML_HEADERS },
      { status: 401, body: '', headers: HTML_HEADERS },
      { status: 451, body: '', headers: HTML_HEADERS },
      { status: 403, body: '<title>Just a moment...</title>', headers: HTML_HEADERS },
      { status: 503, body: '<html>Attention Required! | Cloudflare</html>', headers: HTML_HEADERS },
    ]) {
      const { ctx, fake } = setup({ [API_URL]: reply });
      const result = await ctx.get(API_URL);
      assert.equal(failureKind(result), 'blocked', JSON.stringify(reply));
      assert.equal(fake.calls.filter((c) => c.url === API_URL).length, 1, 'no retry, no tricks');
    }
    const captcha = setup({ [API_URL]: { status: 200, body: '<html>please solve the hCaptcha</html>', headers: HTML_HEADERS } });
    assert.equal(failureKind(await captcha.ctx.get(API_URL)), 'captcha');
  });

  test('404 and 410 are not_found without retry', async () => {
    for (const status of [404, 410]) {
      const { ctx, fake } = setup({ [API_URL]: { status } });
      assert.equal(failureKind(await ctx.get(API_URL)), 'not_found');
      assert.equal(fake.calls.filter((c) => c.url === API_URL).length, 1);
    }
  });
});

describe('response classification', () => {
  test('JSON and HTML bodies are returned as text, untouched', async () => {
    const json = setup({ [API_URL]: { body: '[{"a":1}]', headers: JSON_HEADERS } });
    const okJson = await json.ctx.get(API_URL);
    assert.ok(okJson.ok && okJson.kind === 'json' && okJson.body === '[{"a":1}]');

    const html = setup({ [API_URL]: { body: '<html>hello</html>', headers: HTML_HEADERS } });
    const okHtml = await html.ctx.get(API_URL);
    assert.ok(okHtml.ok && okHtml.kind === 'html');
  });

  test('a JSON body that mentions captcha in a field is still JSON', async () => {
    const { ctx } = setup({ [API_URL]: { body: '[{"productName":"captcha just a moment"}]', headers: JSON_HEADERS } });
    const result = await ctx.get(API_URL);
    assert.ok(result.ok && result.kind === 'json');
  });
});

describe('User-Agent', () => {
  test('is cuotear/<version> (personal price monitor; +<repo url>)', () => {
    assert.equal(buildUserAgent({ env: {}, version: '1.2.3' }), 'cuotear/1.2.3 (personal price monitor; +https://github.com/agusgut0/cuotear)');
    assert.equal(
      buildUserAgent({ env: { GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'me/repo' }, version: '1.2.3' }),
      'cuotear/1.2.3 (personal price monitor; +https://github.com/me/repo)',
    );
  });

  test('ignores a malformed repository variable', () => {
    assert.match(buildUserAgent({ env: { GITHUB_SERVER_URL: 'http://x y', GITHUB_REPOSITORY: 'a b' }, version: '1' }), /agusgut0\/cuotear\)$/);
  });

  test('defaults to the version in package.json', () => {
    assert.match(buildUserAgent({ env: {} }), /^cuotear\/\d+\.\d+\.\d+ \(personal price monitor; \+https:\/\//);
  });
});
