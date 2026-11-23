import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { createFetchContext } from '../../src/http/client.js';
import { stores } from '../../src/stores/index.js';
import { parsePrice } from '../../src/stores/megatone/index.js';
import { MAX_BLOCK_CHARS, MAX_BLOCKS, parseJsonLdBlocks, trimProductJsonLd } from '../../src/stores/megatone/jsonld.js';
import { fakeClock, fakeFetch, HTML_HEADERS } from '../helpers/fake-http.js';
import { failure, fixtureContext, htmlOk, jsonOk } from '../helpers/fixture-context.js';

const megatone = /** @type {import('../../src/stores/index.js').StoreRegistration} */ (stores.find((store) => store.id === 'megatone'));
const SLUG = 'televisor-tcl-75t6c-qled-75-4k-uhd-google-tv-dlg-120hz_MKT028PMTP';
const PRODUCT_URL = `https://www.megatone.net/producto/${SLUG}/`;
const OPTIONS = { codigoPostal: '5000' };

/**
 * @param {string} name
 * @returns {string}
 */
const fixture = (name) => readFileSync(new URL(`../fixtures/megatone/${name}`, import.meta.url), 'utf8');

/**
 * @param {string} name
 * @returns {Record<string, unknown>}
 */
const expected = (name) => JSON.parse(fixture(`${name}.expected.json`));

/**
 * Runs the adapter against a saved fixture and returns the result without `meta`.
 * @param {string} name fixture base name
 * @param {string} [url]
 */
async function measureFixture(name, url = PRODUCT_URL) {
  const { ctx, urls } = fixtureContext(htmlOk(fixture(`${name}.html`)));
  const { meta, ...result } = await megatone.measure(ctx, url, OPTIONS);
  return { result, meta, urls };
}

/** @param {string} url */
const check = (url) => megatone.validateUrl(new URL(url));

describe('Megatone contract: real fixture (TCL 75T6C, captured 2026-11-23)', () => {
  test('matches the reviewed expected.json', async () => {
    const { result } = await measureFixture('tcl-75t6c');
    assert.deepEqual(JSON.parse(JSON.stringify(result)), expected('tcl-75t6c'));
  });

  test('the price "2299999.00" is the list price in cents; cash = published price with unknown method; no card data (degraded)', async () => {
    const { result } = await measureFixture('tcl-75t6c');
    assert.equal(result.outcome, 'ok');
    assert.equal(result.listaCents, 2_299_999 * 100);
    assert.deepEqual(result.contado, { valorCents: 2_299_999 * 100, medio: 'ninguno', descuentoPct: null });
    assert.deepEqual(result.tarjetas, { visa: null, mastercard: null, naranja: null });
  });

  test('makes exactly one request, to the product page', async () => {
    const { urls, meta } = await measureFixture('tcl-75t6c');
    assert.deepEqual(urls, [PRODUCT_URL]);
    assert.equal(meta.requests, 1);
  });

  test('a configured URL without trailing slash or with a query requests the canonical page', async () => {
    const { urls } = await measureFixture('tcl-75t6c', `https://www.megatone.net/producto/${SLUG}?utm_source=x#top`);
    assert.deepEqual(urls, [PRODUCT_URL]);
  });

  test('the registration declares only the product page for fixture capture', () => {
    assert.deepEqual(megatone.captureUrls(new URL(PRODUCT_URL)), [PRODUCT_URL]);
    assert.deepEqual(megatone.captureUrls(new URL('https://www.megatone.net/listado/tv-audio-video/')), []);
    assert.deepEqual(megatone.captureUrls(new URL(`https://www.oncity.com/producto/${SLUG}/`)), []);
  });

  test('the capture trimming keeps only the Product JSON-LD', () => {
    const page = `<html><body><script type=application/ld+json>{"@type":"BreadcrumbList"}</script><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'x', description: 'long text', offers: { price: '1.00' } })}</script><p>other</p></body></html>`;
    const trimmed = trimProductJsonLd(page);
    assert.ok(trimmed.includes('"offers"') && !trimmed.includes('description') && !trimmed.includes('BreadcrumbList') && !trimmed.includes('other'));
  });

  test('the capture trimming whitelists the fields of each offer', () => {
    const offers = [
      { '@type': 'Offer', price: '1.00', priceCurrency: 'ARS', availability: 'https://schema.org/InStock', seller: { name: 'private' }, url: 'https://x.example/?token=1' },
      { '@type': 'AggregateOffer', lowPrice: '2.00', priceCurrency: 'ARS', offerCount: 3 },
    ];
    const page = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'x', offers })}</script>`;
    const kept = trimProductJsonLd(page);
    assert.ok(!/seller|token|offerCount/.test(kept));
    const json = JSON.parse(/<script[^>]*>([\s\S]*?)<\/script>/.exec(kept)?.[1] ?? 'null');
    assert.deepEqual(json.offers, [
      { '@type': 'Offer', price: '1.00', priceCurrency: 'ARS', availability: 'https://schema.org/InStock' },
      { '@type': 'AggregateOffer', lowPrice: '2.00', priceCurrency: 'ARS' },
    ]);
  });
});

describe('Megatone JSON-LD scanner: hostile pages finish fast (no ReDoS)', () => {
  const MIB = 1024 * 1024;
  const BUDGET_MS = 1000;
  const cases = /** @type {[string, string][]} */ ([
    ['repeated "<script " without ">"', '<script '.repeat(Math.ceil(MIB / 8))],
    ['repeated unclosed ld+json script tags', '<script type="application/ld+json">'.repeat(Math.ceil(MIB / 35))],
    ['repeated unclosed ld+json blocks with text', '<script type="application/ld+json">{"a":1}'.repeat(Math.ceil(MIB / 40))],
    ['many tiny blocks', '<script type="application/ld+json">{}</script>'.repeat(Math.ceil(MIB / 45))],
    ['repeated "</script" without ">"', `<script type="application/ld+json">${'</script '.repeat(Math.ceil(MIB / 9))}`],
    ['huge unquoted attribute run', `<script ${'type=x '.repeat(Math.ceil(MIB / 7))}`],
  ]);

  for (const [name, html] of cases) {
    test(`${name}: parser returns within budget and the adapter reports a parse failure`, async () => {
      assert.ok(html.length >= MIB);
      let started = performance.now();
      const parsed = parseJsonLdBlocks(html);
      assert.ok(performance.now() - started < BUDGET_MS, 'parseJsonLdBlocks too slow');
      assert.ok(parsed.values.length <= MAX_BLOCKS);

      started = performance.now();
      const result = await megatone.measure(fixtureContext(htmlOk(html)).ctx, PRODUCT_URL, OPTIONS);
      assert.ok(performance.now() - started < BUDGET_MS, 'measure too slow');
      assert.equal(result.outcome, 'falla');
      assert.equal(result.failure?.kind, 'parse');
    });
  }

  test('quoted, single-quoted and unquoted type attributes are all accepted, case-insensitively', () => {
    const html = [
      '<script type="application/ld+json">{"n":1}</script>',
      "<script type='application/ld+json'>{\"n\":2}</script>",
      '<script type=application/ld+json>{"n":3}</script>',
      '<SCRIPT TYPE="Application/LD+JSON">{"n":4}</SCRIPT >',
      '<script type="text/javascript">{"n":5}</script>',
      '<scripts type="application/ld+json">{"n":6}</scripts>',
    ].join('\n');
    assert.deepEqual(parseJsonLdBlocks(html).values, [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]);
  });

  test('an oversized block is skipped and counted, later blocks are still read', () => {
    const html = `<script type="application/ld+json">"${'x'.repeat(MAX_BLOCK_CHARS)}"</script><script type="application/ld+json">{"ok":true}</script>`;
    assert.deepEqual(parseJsonLdBlocks(html), { values: [{ ok: true }], skipped: 1 });
  });
});

describe('Megatone contract: URL validation (direct product page only)', () => {
  test('accepts /producto/<slug>/ with or without trailing slash and returns the canonical form', () => {
    assert.deepEqual(check(PRODUCT_URL), { ok: true, canonical: `https://www.megatone.net/producto/${SLUG}` });
    assert.deepEqual(check(`https://www.megatone.net/producto/${SLUG}`), { ok: true, canonical: `https://www.megatone.net/producto/${SLUG}` });
  });

  test('rejects searches, listings and other paths', () => {
    for (const url of [
      'https://www.megatone.net/search/?q=tcl',
      'https://www.megatone.net/busqueda/?q=tcl',
      'https://www.megatone.net/producto/abc/?q=tcl',
      'https://www.megatone.net/listado/tv-audio-video/',
      'https://www.megatone.net/producto/',
      'https://www.megatone.net/producto/a/b/',
      'https://www.megatone.net/',
    ]) {
      assert.equal(check(url).ok, false, url);
    }
  });

  test('the host is checked by the configuration (exact www.megatone.net)', () => {
    assert.deepEqual(megatone.hosts, ['www.megatone.net']);
  });
});

describe('Megatone contract: synthetic edge cases', () => {
  for (const name of [
    'synthetic-graph',
    'synthetic-aggregate',
    'synthetic-no-stock',
    'synthetic-zero-price',
    'synthetic-two-offers',
    'synthetic-no-price',
    'synthetic-bad-price-format',
    'synthetic-foreign-currency',
    'synthetic-malformed',
    'synthetic-no-jsonld',
    'synthetic-no-offers',
    'synthetic-injection',
  ]) {
    test(`${name} matches its expected.json`, async () => {
      const { result } = await measureFixture(name);
      assert.deepEqual(JSON.parse(JSON.stringify(result)), expected(name));
    });
  }

  test('OutOfStock or price 0 is sin_stock, not a failure (RN-06)', async () => {
    for (const name of ['synthetic-no-stock', 'synthetic-zero-price']) {
      const { result } = await measureFixture(name);
      assert.equal(result.outcome, 'sin_stock', name);
      assert.equal(result.failure, undefined, name);
    }
  });

  test('two offers: the cheapest available one wins (the cheaper OutOfStock one is ignored)', async () => {
    const { result } = await measureFixture('synthetic-two-offers');
    assert.equal(result.listaCents, 950_000 * 100);
  });

  test('a price in local format is a parse failure (ST-05)', () => {
    assert.equal(parsePrice('2.299.999,00'), null);
    assert.equal(parsePrice('2299999.00'), 2_299_999);
    assert.equal(parsePrice(1500.5), 1500.5);
    assert.equal(parsePrice('-1'), null);
    assert.equal(parsePrice('1e5'), null);
    assert.equal(parsePrice(Number.NaN), null);
    assert.equal(parsePrice(undefined), null);
  });

  test('both local price formats ("2.299.999,00" and "2,299,999.00") are parse failures, not a wrong price', async () => {
    assert.equal(parsePrice('2,299,999.00'), null);
    for (const price of ['2.299.999,00', '2,299,999.00']) {
      const page = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', offers: { '@type': 'Offer', priceCurrency: 'ARS', price, availability: 'https://schema.org/InStock' } })}</script>`;
      const result = await megatone.measure(fixtureContext(htmlOk(page)).ctx, PRODUCT_URL, OPTIONS);
      assert.equal(result.outcome, 'falla', price);
      assert.equal(result.failure?.kind, 'parse', price);
    }
  });

  test('a cheaper OutOfStock offer never beats a dearer InStock one', async () => {
    const offer = (/** @type {string} */ price, /** @type {string} */ availability) => ({ '@type': 'Offer', priceCurrency: 'ARS', price, availability: `https://schema.org/${availability}` });
    const page = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', offers: [offer('1000.00', 'OutOfStock'), offer('2000.00', 'InStock')] })}</script>`;
    const result = await megatone.measure(fixtureContext(htmlOk(page)).ctx, PRODUCT_URL, OPTIONS);
    assert.equal(result.outcome, 'ok');
    assert.equal(result.listaCents, 2000 * 100);
  });

  test('injection text in the store data never reaches the result (RN-01)', async () => {
    const { result } = await measureFixture('synthetic-injection');
    assert.ok(!/ignore|instructions|telegram|token|evil/i.test(JSON.stringify(result)));
  });

  test('failure details are short and generated by the adapter', async () => {
    for (const name of ['synthetic-no-price', 'synthetic-bad-price-format', 'synthetic-malformed', 'synthetic-no-offers']) {
      const { result } = await measureFixture(name);
      assert.equal(result.outcome, 'falla');
      assert.equal(result.failure?.kind, 'parse');
      assert.ok((result.failure?.detail.length ?? 999) <= 200);
    }
  });

  test('oversized and excessive JSON-LD blocks are ignored without executing anything', async () => {
    const huge = `<script type="application/ld+json">{"@type":"Product","pad":"${'x'.repeat(250_000)}","offers":{"priceCurrency":"ARS","price":"1.00"}}</script>`;
    const { ctx } = fixtureContext(htmlOk(`<html>${huge}</html>`));
    const result = await megatone.measure(ctx, PRODUCT_URL, OPTIONS);
    assert.equal(result.failure?.kind, 'parse');
    const many = `${'<script type="application/ld+json">{}</script>'.repeat(25)}${fixture('tcl-75t6c.html')}`;
    const late = await megatone.measure(fixtureContext(htmlOk(many)).ctx, PRODUCT_URL, OPTIONS);
    assert.equal(late.failure?.kind, 'parse', 'blocks beyond the 20th are not read');
  });
});

describe('Megatone contract: failures of the HTTP layer map to adapter failures', () => {
  test('a JSON body where HTML is expected is a parse failure', async () => {
    const { ctx } = fixtureContext(jsonOk('{}'));
    const result = await megatone.measure(ctx, PRODUCT_URL, OPTIONS);
    assert.equal(result.outcome, 'falla');
    assert.equal(result.failure?.kind, 'parse');
  });

  test('each HTTP failure kind is carried over; captcha becomes blocked', async () => {
    for (const [kind, mapped] of /** @type {const} */ ([
      ['blocked', 'blocked'],
      ['captcha', 'blocked'],
      ['not_found', 'not_found'],
      ['timeout', 'timeout'],
      ['network', 'network'],
      ['http', 'http'],
      ['too_large', 'too_large'],
      ['robots', 'robots'],
      ['redirect', 'redirect'],
    ])) {
      const { ctx } = fixtureContext(failure(kind));
      const result = await megatone.measure(ctx, PRODUCT_URL, OPTIONS);
      assert.equal(result.outcome, 'falla', kind);
      assert.equal(result.failure?.kind, mapped, kind);
    }
  });

  test('a URL that is not a product page of the store fails without any request', async () => {
    for (const url of ['not a url', 'https://www.megatone.net/search/?q=tcl', 'https://other.example/producto/a/']) {
      const { ctx, urls } = fixtureContext(htmlOk(''));
      const result = await megatone.measure(ctx, url, OPTIONS);
      assert.equal(result.failure?.kind, 'parse', url);
      assert.equal(urls.length, 0);
    }
  });
});

describe('Megatone contract: end to end through the real HTTP layer with a fake fetch', () => {
  /**
   * @param {Record<string, import('../helpers/fake-http.js').FakeReply>} routes
   */
  function setup(routes) {
    const clock = fakeClock();
    const robots = 'User-agent: *\nDisallow: /\nAllow: /producto/\n';
    const fake = fakeFetch({ 'https://www.megatone.net/robots.txt': { body: robots }, ...routes }, clock.now);
    const ctx = createFetchContext({ allowedHosts: ['www.megatone.net'], fetchImpl: fake.impl, now: clock.now, sleep: clock.sleep, userAgent: 'cuotear/test' });
    return { ctx, fake };
  }

  test('measures the real fixture served over the fake network (robots.txt allows /producto/)', async () => {
    const { ctx, fake } = setup({ [PRODUCT_URL]: { body: fixture('tcl-75t6c.html'), headers: HTML_HEADERS } });
    const result = await megatone.measure(ctx, PRODUCT_URL, OPTIONS);
    assert.equal(result.outcome, 'ok');
    assert.equal(result.listaCents, 229_999_900);
    assert.equal(fake.calls.filter((call) => call.url === PRODUCT_URL).length, 1);
  });

  test('a challenge page (Cloudflare "Just a moment") is blocked and not retried', async () => {
    const { ctx, fake } = setup({ [PRODUCT_URL]: { status: 403, body: fixture('synthetic-challenge.html'), headers: HTML_HEADERS } });
    const result = await megatone.measure(ctx, PRODUCT_URL, OPTIONS);
    assert.equal(result.failure?.kind, 'blocked');
    assert.equal(fake.calls.filter((call) => call.url === PRODUCT_URL).length, 1);
  });

  test('a captcha body served with 200 is blocked', async () => {
    const { ctx } = setup({ [PRODUCT_URL]: { status: 200, body: fixture('synthetic-challenge.html'), headers: HTML_HEADERS } });
    const result = await megatone.measure(ctx, PRODUCT_URL, OPTIONS);
    assert.equal(result.failure?.kind, 'blocked');
  });

  test('404 is not_found', async () => {
    const { ctx } = setup({ [PRODUCT_URL]: { status: 404 } });
    const result = await megatone.measure(ctx, PRODUCT_URL, OPTIONS);
    assert.equal(result.failure?.kind, 'not_found');
  });

  test('a path outside /producto/ is never requested', async () => {
    const { ctx, fake } = setup({});
    const result = await megatone.measure(ctx, 'https://www.megatone.net/search/?q=tcl', OPTIONS);
    assert.equal(result.failure?.kind, 'parse');
    assert.equal(fake.calls.length, 0);
  });
});
