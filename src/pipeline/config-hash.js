import { createHash } from 'node:crypto';

/**
 * Canonical JSON: the same text for the same data whatever the order of the
 * keys of its objects (arrays keep their order). Used for hashes, so editing the
 * YAML without changing its meaning does not change them.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  });
}

/**
 * Hash of what defines a product (DRT 13.2): a change in it silences
 * `cambio_mejor_opcion` for one run. Key order does not matter.
 * @param {import('../config/types.js').Product} product
 * @returns {string} `sha256:<hex>`
 */
export const productConfigHash = (product) => `sha256:${createHash('sha256').update(canonicalJson(product)).digest('hex')}`;
