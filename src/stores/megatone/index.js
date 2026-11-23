import { findNodes, hasType, isRecord, parseJsonLdBlocks } from './jsonld.js';

/**
 * Megatone adapter (DRT 6.3, ADR-0006). One request per URL: the product page
 * of the store, read through its schema.org JSON-LD. The page has no
 * per-card installments and no cash discount, so the result carries only the
 * published price: contado = list price (payment method unknown) and no card
 * data (degraded store).
 *
 * The page is untrusted data: only numbers and enumerations derived from the
 * JSON-LD leave this module.
 *
 * @typedef {import('../types.js').StoreResult} StoreResult
 * @typedef {import('../types.js').FailureKind} FailureKind
 * @typedef {{ priceCents: number, available: boolean }} OfferPrice
 * @typedef {{ error: string } | OfferPrice[]} OffersRead
 */

export const HOST = 'www.megatone.net';
const PATH = /^\/producto\/[A-Za-z0-9_-]+\/?$/;
const PRICE_STRING = /^\d+(\.\d{1,2})?$/;
const MAX_DETAIL = 200;
const MAX_OFFERS = 50;
const CENTAVOS = 100;
const UNAVAILABLE = new Set(['OutOfStock', 'Discontinued', 'SoldOut']);

/**
 * Direct product page only: `/producto/<slug>/`.
 * @param {URL} url
 * @returns {import('../url.js').UrlCheck}
 */
export function checkMegatoneProductUrl(url) {
  if (['q', '_q'].some((name) => url.searchParams.has(name))) {
    return { ok: false, reason: 'las URLs de búsqueda no están permitidas; usá la URL de la ficha del producto' };
  }
  if (!PATH.test(url.pathname)) {
    return { ok: false, reason: 'la ruta no es la de una ficha de producto (se espera /producto/<slug>/)' };
  }
  return { ok: true, canonical: `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}` };
}

/**
 * Product page request for a configured URL (query and fragment dropped).
 * @param {URL} url
 * @returns {string | null} null when the URL is not a product page of the store
 */
export function pageUrl(url) {
  if (url.hostname !== HOST || !PATH.test(url.pathname)) return null;
  return `https://${HOST}${url.pathname.replace(/\/+$/, '')}/`;
}

/**
 * schema.org price: a number, or a string with a dot decimal separator
 * (ST-05). Anything else (thousands separators, text, negatives) is rejected.
 * @param {unknown} value
 * @returns {number | null}
 */
export function parsePrice(value) {
  /** @type {number} */
  let price;
  if (typeof value === 'number') price = value;
  else if (typeof value === 'string' && PRICE_STRING.test(value)) price = Number(value);
  else return null;
  return Number.isFinite(price) && price >= 0 && price < 1e10 ? price : null;
}

/**
 * @param {unknown} availability schema.org URL (`https://schema.org/InStock`) or bare name
 * @returns {boolean}
 */
function isAvailable(availability) {
  if (typeof availability !== 'string') return true;
  const name = availability.slice(availability.lastIndexOf('/') + 1);
  return !UNAVAILABLE.has(name);
}

/**
 * Reads `offers` (object or array; Offer or AggregateOffer). Any unreadable
 * offer fails the whole page: a half-read price is worse than no price.
 * @param {unknown} offers
 * @returns {OffersRead}
 */
function readOffers(offers) {
  const list = Array.isArray(offers) ? offers : offers === undefined ? [] : [offers];
  if (list.length === 0 || list.length > MAX_OFFERS) return { error: 'the JSON-LD offers are missing or too many' };
  /** @type {OfferPrice[]} */
  const result = [];
  for (const offer of list) {
    if (!isRecord(offer)) return { error: 'a JSON-LD offer is not an object' };
    if (offer.priceCurrency !== 'ARS') return { error: 'the JSON-LD offer currency is not ARS' };
    const raw = hasType(offer, 'AggregateOffer') ? (offer.lowPrice ?? offer.price) : offer.price;
    const price = parsePrice(raw);
    if (price === null) return { error: 'the JSON-LD offer price is missing or has an unexpected format' };
    result.push({ priceCents: Math.round(price * CENTAVOS), available: isAvailable(offer.availability) });
  }
  return result;
}

/**
 * @param {import('../../http/client.js').FetchContext} ctx
 * @param {string} rawUrl configured product URL
 * @param {import('../types.js').MeasureOptions} options
 * @returns {Promise<StoreResult>}
 */
async function measureMegatone(ctx, rawUrl, options) {
  const started = Date.now();
  let requests = 0;
  /**
   * @param {FailureKind} kind
   * @param {string} detail
   * @returns {StoreResult}
   */
  const failed = (kind, detail) => ({ outcome: 'falla', failure: { kind, detail: detail.slice(0, MAX_DETAIL) }, meta: { requests, ms: Date.now() - started } });

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return failed('parse', 'the product URL is not a valid URL');
  }
  const endpoint = pageUrl(url);
  if (endpoint === null) return failed('parse', 'the product URL is not a product page of this store');

  const response = await ctx.get(endpoint, { accept: 'text/html' });
  requests = response.requests;
  if (!response.ok) return failed(response.kind === 'captcha' ? 'blocked' : response.kind, response.detail);
  if (response.kind !== 'html') return failed('parse', 'the product page did not answer with HTML');

  const { values, skipped } = parseJsonLdBlocks(response.body);
  if (skipped > 0) options.log?.(`megatone: ${skipped} JSON-LD block(s) skipped (invalid or too large)`);
  const products = findNodes(values, 'Product');
  if (products.length === 0) return failed('parse', 'the product page has no JSON-LD Product');

  /** @type {OfferPrice[]} */
  const offers = [];
  for (const product of products) {
    const read = readOffers(product.offers);
    if (!Array.isArray(read)) return failed('parse', read.error);
    offers.push(...read);
  }

  const meta = { requests, ms: Date.now() - started };
  const best = offers.filter((offer) => offer.available && offer.priceCents > 0).sort((a, b) => a.priceCents - b.priceCents)[0];
  if (best === undefined) return { outcome: 'sin_stock', meta };

  return {
    outcome: 'ok',
    listaCents: best.priceCents,
    contado: { valorCents: best.priceCents, medio: 'ninguno', descuentoPct: null },
    tarjetas: { visa: null, mastercard: null, naranja: null },
    meta,
  };
}

/** @type {import('../index.js').StoreRegistration} */
export const megatone = {
  id: 'megatone',
  displayName: 'Megatone',
  hosts: [HOST],
  status: 'vigente',
  validateUrl: checkMegatoneProductUrl,
  captureUrls: (url) => {
    const target = pageUrl(url);
    return target === null ? [] : [target];
  },
  measure: measureMegatone,
};
