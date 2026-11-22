import { MAX_INSTALLMENTS } from '../../core/compare.js';
import { CASH_PREFERENCE, cardOf, cashMedioOf, normalizeName } from './payment.js';
import { catalogValidator } from './schema.js';

/**
 * Generic VTEX adapter (DRT 6.2, ADR-0006). One request per URL: the product
 * catalog API. The checkout simulation is optional per profile and is NOT
 * implemented yet; profiles that enable it are rejected.
 *
 * The catalog response is untrusted data: it is parsed with JSON.parse,
 * validated against a schema of the fields used, read field by field (never
 * spread or merged) and reduced to numbers and enumerations.
 *
 * @typedef {import('../types.js').Card} Card
 * @typedef {import('../types.js').Medio} Medio
 * @typedef {import('../types.js').StoreResult} StoreResult
 * @typedef {import('../types.js').CardResult} CardResult
 * @typedef {import('../types.js').FailureKind} FailureKind
 * @typedef {import('./profiles.js').VtexProfile} VtexProfile
 *
 * @typedef {{ name: string, n: number, valueCents: number, totalCents: number, rate: number }} Line one installment line, name normalized
 * @typedef {{ sellerId: string, isDefault: boolean, priceCents: number, lines: Line[] }} Seller
 */

const SLUG = /^[a-z0-9-]+$/;
const MAX_DETAIL = 200;
const CENTAVOS = 100;

/**
 * Catalog endpoint for a product page URL: "Search product by product URL"
 * of the VTEX Legacy Search API.
 * @param {URL} url `https://<host>/<slug>/p`
 * @returns {string | null} null when the path is not a product page
 */
export function catalogUrl(url) {
  const slug = /^\/([^/]+)\/p\/?$/.exec(url.pathname)?.[1];
  if (slug === undefined || !SLUG.test(slug)) return null;
  return `https://${url.hostname}/api/catalog_system/pub/products/search/${slug}/p`;
}

/**
 * @param {number} pesos
 * @returns {number}
 */
const toCents = (pesos) => Math.round(pesos * CENTAVOS);

/**
 * Builds the store registration for a VTEX profile.
 * @param {VtexProfile} profile
 * @param {(url: URL) => import('../url.js').UrlCheck} validateUrl
 * @returns {import('../index.js').StoreRegistration}
 */
export function createVtexStore(profile, validateUrl) {
  if (profile.simulacion) throw new Error(`VTEX checkout simulation is not implemented (profile ${profile.id})`);
  return {
    id: profile.id,
    displayName: profile.displayName,
    hosts: [...profile.hosts],
    status: profile.status,
    validateUrl,
    captureUrls: (url) => {
      const target = catalogUrl(url);
      return target === null ? [] : [target];
    },
    measure: (ctx, url, options) => measureVtex(profile, ctx, url, options),
  };
}

/**
 * @param {VtexProfile} profile
 * @param {import('../../http/client.js').FetchContext} ctx
 * @param {string} rawUrl configured product URL
 * @param {import('../types.js').MeasureOptions} options
 * @returns {Promise<StoreResult>}
 */
export async function measureVtex(profile, ctx, rawUrl, options) {
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
  if (!profile.hosts.includes(url.hostname)) return failed('parse', 'the product URL host does not belong to this store');
  const endpoint = catalogUrl(url);
  if (endpoint === null) return failed('parse', 'the product URL is not a product page');

  const response = await ctx.get(endpoint, { accept: 'application/json' });
  requests = response.requests;
  if (!response.ok) return failed(response.kind === 'captcha' ? 'blocked' : response.kind, response.detail);
  if (response.kind !== 'json') return failed('parse', 'the catalog API did not answer with JSON');

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    return failed('parse', 'the catalog response is not valid JSON');
  }
  if (!catalogValidator()(parsed)) return failed('parse', 'the catalog response does not have the expected shape');

  const products = /** @type {Record<string, any>[]} */ (parsed);
  const meta = () => ({ requests, ms: Date.now() - started });
  if (products.length === 0) return { outcome: 'sin_oferta', meta: meta() };
  if (products.length > 1) return failed('ambiguous', 'the catalog returned more than one product for the URL');

  const items = /** @type {Record<string, any>[]} */ (products[0]?.items);
  const skuId = url.searchParams.get('skuId');
  const item = items.length === 1 ? items[0] : items.find((candidate) => candidate.itemId === skuId);
  if (item === undefined) return failed('ambiguous', 'the product has several items and none matches the skuId of the URL');

  const seller = pickSeller(readSellers(item.sellers, options));
  if (seller === null) return { outcome: 'sin_stock', meta: meta() };

  return {
    outcome: 'ok',
    listaCents: seller.priceCents,
    contado: extractContado(seller),
    tarjetas: extractCards(seller.lines),
    meta: meta(),
  };
}

/**
 * Reads the sellers that can sell the item (RN-06, S-38): price above zero,
 * stock and not flagged unavailable.
 * @param {Record<string, any>[]} sellers
 * @param {import('../types.js').MeasureOptions} options
 * @returns {Seller[]}
 */
function readSellers(sellers, options) {
  /** @type {Seller[]} */
  const available = [];
  for (const seller of sellers) {
    const offer = seller.commertialOffer;
    if (offer.Price <= 0 || offer.AvailableQuantity <= 0 || offer.IsAvailable === false) continue;
    available.push({
      sellerId: seller.sellerId,
      isDefault: seller.sellerDefault === true,
      priceCents: toCents(offer.Price),
      lines: readLines(offer.Installments ?? [], options),
    });
  }
  return available;
}

/**
 * Seller rule of ADR 0006: lowest price, then the default seller, then the
 * lowest sellerId. Installments and cash come from the same seller.
 * @param {Seller[]} sellers
 * @returns {Seller | null}
 */
function pickSeller(sellers) {
  const sorted = [...sellers].sort(
    (a, b) => a.priceCents - b.priceCents || Number(b.isDefault) - Number(a.isDefault) || (a.sellerId < b.sellerId ? -1 : a.sellerId > b.sellerId ? 1 : 0),
  );
  return sorted[0] ?? null;
}

/**
 * Explicit field-by-field read of the installment lines; malformed lines are dropped.
 * @param {unknown[]} installments
 * @param {import('../types.js').MeasureOptions} options
 * @returns {Line[]}
 */
function readLines(installments, options) {
  /** @type {Line[]} */
  const lines = [];
  for (const raw of installments) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = /** @type {Record<string, unknown>} */ (raw);
    const name = entry.PaymentSystemName;
    const n = entry.NumberOfInstallments;
    const value = entry.Value;
    const total = entry.TotalValuePlusInterestRate;
    const rate = entry.InterestRate;
    if (typeof name !== 'string' || name.length > 100) continue;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 1000) continue;
    if (!isMoney(value) || !isMoney(total) || typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) continue;
    const normalized = normalizeName(name);
    if (cardOf(normalized) === null && cashMedioOf(normalized) === null) {
      options.log?.(`unrecognized payment system (normalized): ${normalized.replace(/[^a-z0-9 ]/g, '').slice(0, 40)}`);
    }
    lines.push({ name: normalized, n, valueCents: toCents(value), totalCents: toCents(total), rate });
  }
  return lines;
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isMoney(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1e10;
}

/**
 * Cash price (RF-20, S-37): the lowest one-payment line among transferencia,
 * efectivo and debito; the value never exceeds the list price.
 * @param {Seller} seller
 * @returns {import('../types.js').Contado}
 */
function extractContado(seller) {
  const lista = seller.priceCents;
  /** @type {{ valueCents: number, medio: Medio }[]} */
  const candidates = [];
  for (const line of seller.lines) {
    if (line.n !== 1 || line.valueCents <= 0 || line.valueCents > lista) continue;
    const medio = cashMedioOf(line.name);
    if (medio !== null) candidates.push({ valueCents: line.valueCents, medio });
  }
  if (candidates.length === 0) return { valorCents: lista, medio: 'ninguno', descuentoPct: null };

  const lowest = Math.min(...candidates.map((candidate) => candidate.valueCents));
  const medio = CASH_PREFERENCE.find((preferred) => candidates.some((candidate) => candidate.valueCents === lowest && candidate.medio === preferred));
  const difference = lista - lowest;
  return {
    valorCents: lowest,
    medio: medio ?? 'ninguno',
    descuentoPct: difference > CENTAVOS ? Math.round((difference / lista) * 10_000) / 100 : 0,
  };
}

/**
 * Interest-free installments per card (RF-14, RN-09, RN-14, S-04).
 * @param {Line[]} lines
 * @returns {Record<Card, CardResult>}
 */
function extractCards(lines) {
  /** @type {Record<Card, CardResult>} */
  const result = { visa: null, mastercard: null, naranja: null };
  for (const card of /** @type {Card[]} */ (['visa', 'mastercard', 'naranja'])) {
    const matching = lines
      .filter((line) => cardOf(line.name) === card && line.rate === 0 && line.n >= 2 && line.n <= MAX_INSTALLMENTS && line.valueCents > 0 && line.totalCents > 0)
      .sort((a, b) => b.n - a.n || a.totalCents - b.totalCents);
    const best = matching[0];
    if (best === undefined) continue;
    if (Math.abs(best.totalCents - best.n * best.valueCents) > best.n * CENTAVOS) {
      result[card] = { invalida: true, motivo: 'the published total differs from n x installment by more than n pesos' };
    } else {
      result[card] = { n: best.n, cuotaCents: best.valueCents, totalCents: best.totalCents };
    }
  }
  return result;
}
