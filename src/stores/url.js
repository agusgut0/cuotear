/**
 * @typedef {{ ok: true, canonical: string } | { ok: false, reason: string }} UrlCheck
 */

const SEARCH_PARAMS = ['q', '_q'];

/**
 * Builds the normalized form of a store URL: lowercase host, no fragment,
 * no trailing slash and no query string except `skuId`.
 * @param {URL} url
 * @returns {string}
 */
export function normalizeStoreUrl(url) {
  const path = url.pathname.replace(/\/+$/, '');
  const skuId = url.searchParams.get('skuId');
  const query = skuId === null ? '' : `?skuId=${encodeURIComponent(skuId)}`;
  return `${url.protocol}//${url.host.toLowerCase()}${path}${query}`;
}

/**
 * Checks that a URL points at a product page (and not at a search) following
 * the given path pattern, and returns its canonical form.
 * @param {URL} url
 * @param {RegExp} pathPattern
 * @param {string} expectedShape human-readable shape for the error message
 * @returns {UrlCheck}
 */
export function checkProductUrl(url, pathPattern, expectedShape) {
  if (SEARCH_PARAMS.some((name) => url.searchParams.has(name))) {
    return { ok: false, reason: 'las URLs de búsqueda no están permitidas; usá la URL de la ficha del producto' };
  }
  if (!pathPattern.test(url.pathname)) {
    return { ok: false, reason: `la ruta no es la de una ficha de producto (se espera ${expectedShape})` };
  }
  return { ok: true, canonical: normalizeStoreUrl(url) };
}

/**
 * VTEX product page: `/<slug>/p`.
 * @param {URL} url
 * @returns {UrlCheck}
 */
export function checkVtexProductUrl(url) {
  return checkProductUrl(url, /^\/[a-z0-9-]+\/p\/?$/, '/<slug>/p');
}
