import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { stores } from '../../src/stores/index.js';
import { naldo as profile } from '../../src/stores/vtex/profiles.js';
import { fixtureContext, jsonOk } from '../helpers/fixture-context.js';

const naldo = /** @type {import('../../src/stores/index.js').StoreRegistration} */ (stores.find((store) => store.id === 'naldo'));
const OPTIONS = { codigoPostal: '5000' };
const SLUG = '75-75a400u-qled-4k-google-tv-hdr10--506269';
const PRODUCT_URL = `https://www.naldo.com.ar/${SLUG}/p`;
const CATALOG_URL = `https://www.naldo.com.ar/api/catalog_system/pub/products/search/${SLUG}/p`;

/**
 * @param {string} name
 * @returns {string}
 */
const fixture = (name) => readFileSync(new URL(`../fixtures/naldo/${name}`, import.meta.url), 'utf8');

/**
 * @param {string} body
 * @param {string} [url]
 */
async function measureBody(body, url = PRODUCT_URL) {
  const { ctx, urls } = fixtureContext(jsonOk(body));
  const { meta, ...result } = await naldo.measure(ctx, url, OPTIONS);
  return { result, meta, urls };
}

describe('Naldo contract: profile', () => {
  test('is provisional (validated with a different product than the 75T6C), without checkout simulation, with its own host only', () => {
    assert.equal(profile.simulacion, false);
    assert.equal(naldo.status, 'provisional');
    assert.deepEqual(naldo.hosts, ['www.naldo.com.ar']);
  });
});

describe('Naldo contract: real fixture (TCL 75A400U, captured 2026-11-23; the 75T6C is not offered by Naldo)', () => {
  test('matches the reviewed expected.json without any code change in the VTEX adapter', async () => {
    const { result } = await measureBody(fixture('tcl-75a400u.json'));
    assert.deepEqual(JSON.parse(JSON.stringify(result)), JSON.parse(fixture('tcl-75a400u.expected.json')));
  });

  test('list is the VTEX Price and cash is the debit lines (Visa Electron, Maestro, Mastercard Debit) at 0 %', async () => {
    const { result } = await measureBody(fixture('tcl-75a400u.json'));
    assert.equal(result.listaCents, 2_999_999 * 100);
    assert.deepEqual(result.contado, { valorCents: 2_999_999 * 100, medio: 'debito', descuentoPct: 0 });
  });

  test('Visa, Mastercard and Naranja 6x interest-free (the 3x of Visa/Mastercard are lower; 9x and above carry interest)', async () => {
    const { result } = await measureBody(fixture('tcl-75a400u.json'));
    assert.deepEqual(result.tarjetas, {
      visa: { n: 6, cuotaCents: 49_999_983, totalCents: 299_999_900 },
      mastercard: { n: 6, cuotaCents: 49_999_983, totalCents: 299_999_900 },
      naranja: { n: 6, cuotaCents: 49_999_983, totalCents: 299_999_900 },
    });
  });

  test('makes exactly one request, to the catalog API, and never to checkout or simulation', async () => {
    const { urls, meta } = await measureBody(fixture('tcl-75a400u.json'));
    assert.deepEqual(urls, [CATALOG_URL]);
    assert.equal(meta.requests, 1);
    assert.ok(urls.every((url) => !/checkout|simulation/i.test(url)));
  });

  test('an empty array (product not offered, e.g. the 75T6C) is sin_oferta, not a failure (RF-07)', async () => {
    const { result } = await measureBody('[]', 'https://www.naldo.com.ar/smart-tv-tcl-75t6c/p');
    assert.equal(result.outcome, 'sin_oferta');
    assert.equal(result.failure, undefined);
  });

  test('registration declares only the catalog request; other hosts fail without a request', async () => {
    assert.deepEqual(naldo.captureUrls(new URL(PRODUCT_URL)), [CATALOG_URL]);
    const { ctx, urls } = fixtureContext(jsonOk('[]'));
    const result = await naldo.measure(ctx, `https://www.carrefour.com.ar/${SLUG}/p`, OPTIONS);
    assert.equal(result.failure?.kind, 'parse');
    assert.equal(urls.length, 0);
  });
});
