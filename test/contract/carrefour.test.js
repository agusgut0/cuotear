import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { stores } from '../../src/stores/index.js';
import { carrefour as profile } from '../../src/stores/vtex/profiles.js';
import { fixtureContext, jsonOk } from '../helpers/fixture-context.js';

const carrefour = /** @type {import('../../src/stores/index.js').StoreRegistration} */ (stores.find((store) => store.id === 'carrefour'));
const OPTIONS = { codigoPostal: '5000' };

// Real captures (2026-11-23): the same TCL 75T6C sold by two different marketplace sellers.
const DMAKER_SLUG = 'smart-tv-tcl-75---qled-4k-75t6c-google-tv-1774724';
const DUAN_SLUG = 'smart-tv-tcl-75-75t6c-qled-uhd-google-tv-1779459';
const productUrl = (/** @type {string} */ slug) => `https://www.carrefour.com.ar/${slug}/p`;
const catalogUrl = (/** @type {string} */ slug) => `https://www.carrefour.com.ar/api/catalog_system/pub/products/search/${slug}/p`;

/**
 * @param {string} name
 * @returns {string}
 */
const fixture = (name) => readFileSync(new URL(`../fixtures/carrefour/${name}`, import.meta.url), 'utf8');

/**
 * @param {string} name
 * @returns {Record<string, unknown>}
 */
const expected = (name) => JSON.parse(fixture(`${name}.expected.json`));

/** @param {import('../../src/stores/types.js').CardResult | undefined} card */
const nOf = (card) => (card && 'n' in card ? card.n : null);

/**
 * Runs the adapter against a (possibly modified) catalog response.
 * @param {string} body
 * @param {string} slug
 */
async function measureBody(body, slug) {
  const { ctx, urls } = fixtureContext(jsonOk(body));
  const { meta, ...result } = await carrefour.measure(ctx, productUrl(slug), OPTIONS);
  return { result, meta, urls };
}

/**
 * Applies a change to the raw catalog JSON of a fixture and measures it.
 * @param {string} name
 * @param {string} slug
 * @param {(sellers: Record<string, any>[]) => void} change
 */
async function measureModified(name, slug, change) {
  const raw = JSON.parse(fixture(`${name}.json`));
  change(raw[0].items[0].sellers);
  return measureBody(JSON.stringify(raw), slug);
}

describe('Carrefour contract: profile', () => {
  test('is a VTEX profile without checkout simulation, vigente, with its own host only', () => {
    assert.equal(profile.simulacion, false);
    assert.equal(carrefour.status, 'vigente');
    assert.deepEqual(carrefour.hosts, ['www.carrefour.com.ar']);
  });
});

describe('Carrefour contract: real fixture, marketplace seller DMAKER (TCL 75T6C, captured 2026-11-23)', () => {
  test('matches the reviewed expected.json', async () => {
    const { result } = await measureBody(fixture('tcl-75t6c.json'), DMAKER_SLUG);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), expected('tcl-75t6c'));
  });

  test('the CARREFOUR seller at price 0 is discarded and the marketplace seller wins (S-38, ADR 0006)', async () => {
    const { result } = await measureBody(fixture('tcl-75t6c.json'), DMAKER_SLUG);
    assert.equal(result.outcome, 'ok');
    assert.equal(result.listaCents, 2_189_999 * 100, 'Price of DMAKER, not the struck-through ListPrice 2.999.999 (ST-04)');
  });

  test('cash is the Efectivo / debit lines at the list price (0 %); "Tarjeta Carrefour Mastercard" is not a cash candidate', async () => {
    const { result } = await measureBody(fixture('tcl-75t6c.json'), DMAKER_SLUG);
    assert.deepEqual(result.contado, { valorCents: 2_189_999 * 100, medio: 'efectivo', descuentoPct: 0 });
  });

  test('installments with interest (Visa and Mastercard 3x at 3.85 %) are ignored: no card is eligible (RN-09)', async () => {
    const { result } = await measureBody(fixture('tcl-75t6c.json'), DMAKER_SLUG);
    assert.deepEqual(result.tarjetas, { visa: null, mastercard: null, naranja: null });
  });

  test('makes exactly one request, to the catalog API, and never to checkout or simulation', async () => {
    const { urls, meta } = await measureBody(fixture('tcl-75t6c.json'), DMAKER_SLUG);
    assert.deepEqual(urls, [catalogUrl(DMAKER_SLUG)]);
    assert.equal(meta.requests, 1);
    assert.ok(urls.every((url) => !/checkout|simulation/i.test(url)));
  });

  test('Mastercard 3x interest-free only: that card is reported, Visa and Naranja stay null (the odd Carrefour card set of the spike)', async () => {
    const { result } = await measureModified('tcl-75t6c', DMAKER_SLUG, (sellers) => {
      const line = sellers[0]?.commertialOffer.Installments.find((/** @type {any} */ entry) => entry.PaymentSystemName === 'Mastercard' && entry.NumberOfInstallments === 3);
      line.InterestRate = 0;
      line.TotalValuePlusInterestRate = Math.round(line.Value * 3 * 100) / 100;
    });
    assert.equal(result.outcome, 'ok');
    assert.equal(nOf(result.tarjetas?.mastercard), 3);
    assert.equal(result.tarjetas?.visa, null);
    assert.equal(result.tarjetas?.naranja, null);
  });

  test('if the marketplace seller has no stock, Carrefour at price 0 does not rescue it: sin_stock (RN-06)', async () => {
    const { result } = await measureModified('tcl-75t6c', DMAKER_SLUG, (sellers) => {
      if (sellers[0] !== undefined) sellers[0].commertialOffer.AvailableQuantity = 0;
    });
    assert.equal(result.outcome, 'sin_stock');
    assert.equal(result.failure, undefined);
  });
});

describe('Carrefour contract: real fixture, marketplace seller Juan Duran Trendy Deals (TCL 75T6C, captured 2026-11-23)', () => {
  test('matches the reviewed expected.json', async () => {
    const { result } = await measureBody(fixture('tcl-75t6c-juan-duran.json'), DUAN_SLUG);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), expected('tcl-75t6c-juan-duran'));
  });

  test('Visa and Mastercard 12x interest-free with installment and total; Naranja only has the 1-payment line so it is null (RF-14)', async () => {
    const { result } = await measureBody(fixture('tcl-75t6c-juan-duran.json'), DUAN_SLUG);
    assert.deepEqual(result.tarjetas, {
      visa: { n: 12, cuotaCents: 22_512_491, totalCents: 270_149_900 },
      mastercard: { n: 12, cuotaCents: 22_512_491, totalCents: 270_149_900 },
      naranja: null,
    });
  });

  test('"Tarjeta Carrefour Mastercard" is never taken as Mastercard (RN-14)', async () => {
    const { result } = await measureModified('tcl-75t6c-juan-duran', DUAN_SLUG, (sellers) => {
      const offer = sellers[0]?.commertialOffer;
      offer.Installments = offer.Installments.filter((/** @type {any} */ entry) => entry.PaymentSystemName !== 'Mastercard');
    });
    assert.equal(result.tarjetas?.mastercard, null, 'the generic Mastercard lines were removed; the store brand 12x must not replace them');
    assert.equal(nOf(result.tarjetas?.visa), 12);
  });

  test('cash tie between Efectivo, Maestro and Visa Electron at the list price prefers efectivo', async () => {
    const { result } = await measureBody(fixture('tcl-75t6c-juan-duran.json'), DUAN_SLUG);
    assert.deepEqual(result.contado, { valorCents: 2_701_499 * 100, medio: 'efectivo', descuentoPct: 0 });
  });
});

describe('Carrefour contract: registration', () => {
  test('captureUrls declares only the catalog request and ignores non product pages', () => {
    assert.deepEqual(carrefour.captureUrls(new URL(productUrl(DMAKER_SLUG))), [catalogUrl(DMAKER_SLUG)]);
    assert.deepEqual(carrefour.captureUrls(new URL('https://www.carrefour.com.ar/busca')), []);
  });

  test('URLs of other hosts or search pages fail without any request', async () => {
    for (const url of ['https://www.oncity.com/a-slug/p', 'https://www.carrefour.com.ar/busca/tv', 'not a url']) {
      const { ctx, urls } = fixtureContext(jsonOk('[]'));
      const result = await carrefour.measure(ctx, url, OPTIONS);
      assert.equal(result.failure?.kind, 'parse', url);
      assert.equal(urls.length, 0);
    }
  });
});
