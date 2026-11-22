import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { createFetchContext } from '../../src/http/client.js';
import { stores } from '../../src/stores/index.js';
import { catalogUrl } from '../../src/stores/vtex/adapter.js';
import { fakeClock, fakeFetch, HTML_HEADERS, JSON_HEADERS } from '../helpers/fake-http.js';
import { failure, fixtureContext, htmlOk, jsonOk } from '../helpers/fixture-context.js';

const oncity = /** @type {import('../../src/stores/index.js').StoreRegistration} */ (stores.find((store) => store.id === 'oncity'));
const SLUG = 'smart-tv-qled-google-tcl-75--uhd-4k-3840-x-2160-75t6c-158450';
const PRODUCT_URL = `https://www.oncity.com/${SLUG}/p`;
const CATALOG_URL = `https://www.oncity.com/api/catalog_system/pub/products/search/${SLUG}/p`;
const OPTIONS = { codigoPostal: '5000' };

/** @param {import('../../src/stores/types.js').CardResult | undefined} card */
const nOf = (card) => (card && 'n' in card ? card.n : null);

/**
 * @param {string} name
 * @returns {string}
 */
const fixture = (name) => readFileSync(new URL(`../fixtures/oncity/${name}`, import.meta.url), 'utf8');

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
  const { ctx, urls } = fixtureContext(jsonOk(fixture(`${name}.json`)));
  const { meta, ...result } = await oncity.measure(ctx, url, OPTIONS);
  return { result, meta, urls };
}

describe('On City contract: real fixture (TCL 75T6C, captured 2026-11-22)', () => {
  test('matches the reviewed expected.json', async () => {
    const { result } = await measureFixture('tcl-75t6c');
    assert.deepEqual(JSON.parse(JSON.stringify(result)), expected('tcl-75t6c'));
  });

  test('list price is the VTEX Price (S-44) and the cash price is a debit line with 0 % discount (RF-20)', async () => {
    const { result } = await measureFixture('tcl-75t6c');
    assert.equal(result.outcome, 'ok');
    assert.equal(result.listaCents, 2_299_999 * 100);
    assert.deepEqual(result.contado, { valorCents: 2_299_999 * 100, medio: 'debito', descuentoPct: 0 });
  });

  test('Visa 15x, Mastercard 18x and Naranja X 12x interest-free, with installment and total (RF-14)', async () => {
    const { result } = await measureFixture('tcl-75t6c');
    assert.deepEqual(result.tarjetas, {
      visa: { n: 15, cuotaCents: 15_333_326, totalCents: 229_999_900 },
      mastercard: { n: 18, cuotaCents: 12_777_772, totalCents: 229_999_900 },
      naranja: { n: 12, cuotaCents: 19_166_658, totalCents: 229_999_900 },
    });
  });

  test('stock is available (the seller is not discarded) and the brand cards of the store are not picked up (RN-14)', async () => {
    const { result } = await measureFixture('tcl-75t6c');
    assert.notEqual(result.outcome, 'sin_stock');
    const json = JSON.stringify(result);
    assert.ok(!/Patagonia|On City Cr/.test(json));
  });

  test('makes exactly one request, to the catalog API, and never to the checkout (robots.txt: Disallow /*checkout*)', async () => {
    const { urls, meta } = await measureFixture('tcl-75t6c');
    assert.deepEqual(urls, [CATALOG_URL]);
    assert.equal(meta.requests, 1);
    assert.ok(urls.every((url) => !/checkout|simulation/i.test(url)));
  });

  test('the registration declares only the catalog request for fixture capture', () => {
    assert.deepEqual(oncity.captureUrls(new URL(PRODUCT_URL)), [CATALOG_URL]);
    assert.deepEqual(oncity.captureUrls(new URL('https://www.oncity.com/busqueda')), []);
  });

  test('catalogUrl builds the per-URL endpoint only for product pages', () => {
    assert.equal(catalogUrl(new URL(PRODUCT_URL)), CATALOG_URL);
    assert.equal(catalogUrl(new URL('https://www.oncity.com/p')), null);
    assert.equal(catalogUrl(new URL('https://www.oncity.com/a/b/p')), null);
  });
});

describe('On City contract: synthetic edge cases', () => {
  for (const name of [
    'synthetic-no-stock',
    'synthetic-empty',
    'synthetic-missing-card',
    'synthetic-unknown-payment',
    'synthetic-two-sellers',
    'synthetic-two-sellers-tie',
    'synthetic-cash-discount',
    'synthetic-cash-tie',
    'synthetic-interest-and-invalid',
    'synthetic-two-items',
    'synthetic-injection',
    'synthetic-malformed',
    'synthetic-bad-shape',
  ]) {
    test(`${name} matches its expected.json`, async () => {
      const { result } = await measureFixture(name);
      assert.deepEqual(JSON.parse(JSON.stringify(result)), expected(name));
    });
  }

  test('price 0 / no stock is sin_stock, not a failure (RN-06)', async () => {
    const { result } = await measureFixture('synthetic-no-stock');
    assert.equal(result.outcome, 'sin_stock');
    assert.equal(result.failure, undefined);
  });

  test('an empty array is sin_oferta, not a failure (RF-07)', async () => {
    const { result } = await measureFixture('synthetic-empty');
    assert.equal(result.outcome, 'sin_oferta');
  });

  test('a missing card is null (sin datos) without failure (RF-14)', async () => {
    const { result } = await measureFixture('synthetic-missing-card');
    assert.equal(result.outcome, 'ok');
    assert.equal(result.tarjetas?.naranja, null);
  });

  test('unknown or store-branded payment systems are ignored and aliases are accepted (RN-14)', async () => {
    const { result } = await measureFixture('synthetic-unknown-payment');
    assert.equal(result.tarjetas?.visa, null);
    assert.equal(nOf(result.tarjetas?.mastercard), 6);
    assert.equal(nOf(result.tarjetas?.naranja), 3);
  });

  test('two sellers: the cheapest available one wins and cash and installments come from it (S-38, ADR 0006)', async () => {
    const { result } = await measureFixture('synthetic-two-sellers');
    assert.equal(result.listaCents, 900_000 * 100);
    assert.equal(nOf(result.tarjetas?.visa), 6);
  });

  test('seller tie: sellerDefault wins, then the lowest sellerId', async () => {
    const tie = await measureFixture('synthetic-two-sellers-tie');
    assert.equal(nOf(tie.result.tarjetas?.visa), 12, 'seller 5 is the default');
    const raw = JSON.parse(fixture('synthetic-two-sellers-tie.json'));
    raw[0].items[0].sellers[1].sellerDefault = false;
    const { ctx } = fixtureContext(jsonOk(JSON.stringify(raw)));
    const result = await oncity.measure(ctx, PRODUCT_URL, OPTIONS);
    assert.equal(nOf(result.tarjetas?.visa), 10, 'with no default, seller 3 (lowest id) wins');
  });

  test('several items: skuId selects the item, otherwise the result is ambiguous', async () => {
    const without = await measureFixture('synthetic-two-items');
    assert.equal(without.result.failure?.kind, 'ambiguous');
    const withSku = await measureFixture('synthetic-two-items', `${PRODUCT_URL}?skuId=2`);
    assert.equal(withSku.result.outcome, 'ok');
    assert.equal(withSku.result.listaCents, 800_000 * 100);
    const unknownSku = await measureFixture('synthetic-two-items', `${PRODUCT_URL}?skuId=99`);
    assert.equal(unknownSku.result.failure?.kind, 'ambiguous');
  });

  test('cash: lowest one-payment line of transferencia, efectivo or debito; credit lines and values above the list are ignored (RF-20)', async () => {
    const { result } = await measureFixture('synthetic-cash-discount');
    assert.deepEqual(result.contado, { valorCents: 900_000 * 100, medio: 'transferencia', descuentoPct: 10 });
  });

  test('cash tie prefers transferencia > efectivo > debito', async () => {
    const { result } = await measureFixture('synthetic-cash-tie');
    assert.deepEqual(result.contado, { valorCents: 900_000 * 100, medio: 'efectivo', descuentoPct: 10 });
  });

  test('installments with interest are ignored and an inconsistent total makes only that card invalid (RN-09, RF-14)', async () => {
    const { result } = await measureFixture('synthetic-interest-and-invalid');
    assert.equal(result.tarjetas?.visa, null);
    assert.deepEqual(result.tarjetas?.mastercard, { invalida: true, motivo: 'the published total differs from n x installment by more than n pesos' });
    assert.equal(nOf(result.tarjetas?.naranja), 3);
  });

  test('injection text in the store data never reaches the result (RN-01)', async () => {
    const { result } = await measureFixture('synthetic-injection');
    assert.ok(!/ignore|instructions|telegram|token/i.test(JSON.stringify(result)));
    const unknown = await measureFixture('synthetic-unknown-payment');
    assert.ok(!/ignor|instrucciones|historial/i.test(JSON.stringify(unknown.result)));
  });

  test('failure details are short and generated by the adapter', async () => {
    for (const name of ['synthetic-malformed', 'synthetic-bad-shape', 'synthetic-two-items']) {
      const { result } = await measureFixture(name);
      assert.equal(result.outcome, 'falla');
      assert.ok((result.failure?.detail.length ?? 999) <= 200);
    }
  });
});

describe('On City contract: failures of the HTTP layer map to adapter failures', () => {
  test('an HTML body where JSON is expected is a parse failure', async () => {
    const { ctx } = fixtureContext(htmlOk('<html>home</html>'));
    const result = await oncity.measure(ctx, PRODUCT_URL, OPTIONS);
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
      const result = await oncity.measure(ctx, PRODUCT_URL, OPTIONS);
      assert.equal(result.outcome, 'falla', kind);
      assert.equal(result.failure?.kind, mapped, kind);
    }
  });

  test('a URL that is not a product page of the store fails without any request', async () => {
    for (const url of ['not a url', 'https://www.oncity.com/busqueda', 'https://other.example/a-slug/p']) {
      const { ctx, urls } = fixtureContext(jsonOk('[]'));
      const result = await oncity.measure(ctx, url, OPTIONS);
      assert.equal(result.failure?.kind, 'parse', url);
      assert.equal(urls.length, 0);
    }
  });
});

describe('On City contract: end to end through the real HTTP layer with a fake fetch', () => {
  /**
   * @param {Record<string, import('../helpers/fake-http.js').FakeReply>} routes
   */
  function setup(routes) {
    const clock = fakeClock();
    const fake = fakeFetch({ 'https://www.oncity.com/robots.txt': { body: 'User-agent: *\nDisallow: /*checkout*\nDisallow: /*test*\n' }, ...routes }, clock.now);
    const ctx = createFetchContext({ allowedHosts: ['www.oncity.com'], fetchImpl: fake.impl, now: clock.now, sleep: clock.sleep, userAgent: 'cuotear/test' });
    return { ctx, fake };
  }

  test('measures the real fixture served over the fake network', async () => {
    const { ctx, fake } = setup({ [CATALOG_URL]: { body: fixture('tcl-75t6c.json'), headers: JSON_HEADERS } });
    const result = await oncity.measure(ctx, PRODUCT_URL, OPTIONS);
    assert.equal(result.outcome, 'ok');
    assert.equal(result.tarjetas?.mastercard && 'n' in result.tarjetas.mastercard ? result.tarjetas.mastercard.n : null, 18);
    assert.ok(fake.calls.every((call) => !/checkout/i.test(call.url)));
  });

  test('a challenge page (Cloudflare "Just a moment") is blocked and not retried', async () => {
    const { ctx, fake } = setup({ [CATALOG_URL]: { status: 403, body: fixture('synthetic-challenge.html'), headers: HTML_HEADERS } });
    const result = await oncity.measure(ctx, PRODUCT_URL, OPTIONS);
    assert.equal(result.failure?.kind, 'blocked');
    assert.equal(fake.calls.filter((call) => call.url === CATALOG_URL).length, 1);
  });

  test('a captcha body served with 200 is blocked', async () => {
    const { ctx } = setup({ [CATALOG_URL]: { status: 200, body: fixture('synthetic-challenge.html'), headers: HTML_HEADERS } });
    const result = await oncity.measure(ctx, PRODUCT_URL, OPTIONS);
    assert.equal(result.failure?.kind, 'blocked');
  });

  test('404 is not_found', async () => {
    const { ctx } = setup({ [CATALOG_URL]: { status: 404 } });
    const result = await oncity.measure(ctx, PRODUCT_URL, OPTIONS);
    assert.equal(result.failure?.kind, 'not_found');
  });

  test('a slug that robots.txt disallows is a robots failure and is never requested (RNF-07)', async () => {
    const slug = 'tv-test-75-t6c';
    const { ctx, fake } = setup({});
    const result = await oncity.measure(ctx, `https://www.oncity.com/${slug}/p`, OPTIONS);
    assert.equal(result.failure?.kind, 'robots');
    assert.ok(fake.calls.every((call) => call.url === 'https://www.oncity.com/robots.txt'));
  });
});
