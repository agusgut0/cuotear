/**
 * JSON-LD extraction for product pages (DRT 6.3). The page is untrusted data:
 * blocks are located with a bounded regular expression, parsed with
 * `JSON.parse` only (nothing is executed or evaluated) and walked with
 * explicit depth and node limits.
 */

export const MAX_BLOCKS = 20;
export const MAX_BLOCK_CHARS = 200_000;
const MAX_NODES = 500;
const MAX_DEPTH = 4;

const BLOCK = /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;

/**
 * Parses the JSON-LD blocks of an HTML document. Blocks that are too large or
 * are not valid JSON are skipped and counted.
 * @param {string} html
 * @returns {{ values: unknown[], skipped: number }}
 */
export function parseJsonLdBlocks(html) {
  /** @type {unknown[]} */
  const values = [];
  let skipped = 0;
  let seen = 0;
  for (const match of html.matchAll(BLOCK)) {
    seen += 1;
    if (seen > MAX_BLOCKS) break;
    const text = match[1] ?? '';
    if (text.length > MAX_BLOCK_CHARS) {
      skipped += 1;
      continue;
    }
    try {
      values.push(JSON.parse(text));
    } catch {
      skipped += 1;
    }
  }
  return { values, skipped };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} node
 * @param {string} type
 * @returns {boolean}
 */
export function hasType(node, type) {
  const declared = node['@type'];
  return declared === type || (Array.isArray(declared) && declared.includes(type));
}

/**
 * Finds the nodes of a given `@type` in parsed JSON-LD: top-level objects,
 * arrays and `@graph`, within fixed depth and node limits.
 * @param {unknown[]} roots
 * @param {string} type
 * @returns {Record<string, unknown>[]}
 */
export function findNodes(roots, type) {
  /** @type {Record<string, unknown>[]} */
  const found = [];
  let visited = 0;
  /**
   * @param {unknown} value
   * @param {number} depth
   */
  const walk = (value, depth) => {
    if (depth > MAX_DEPTH || visited >= MAX_NODES) return;
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, depth + 1);
      return;
    }
    if (!isRecord(value)) return;
    visited += 1;
    if (hasType(value, type)) found.push(value);
    if ('@graph' in value) walk(value['@graph'], depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return found;
}

/**
 * Reduces a page to the JSON-LD data of its `Product` nodes (used to build
 * fixtures): descriptions, images, ratings and every other block are dropped.
 * @param {string} html
 * @returns {string} a minimal HTML document
 */
export function trimProductJsonLd(html) {
  const { values } = parseJsonLdBlocks(html);
  const keys = ['@context', '@type', 'name', 'sku', 'url', 'offers'];
  const blocks = findNodes(values, 'Product').map((product) => {
    /** @type {Record<string, unknown>} */
    const kept = {};
    for (const key of keys) if (key in product) kept[key] = product[key];
    return `<script type="application/ld+json">${JSON.stringify(kept).replace(/</g, '\\u003c')}</script>`;
  });
  return `<!doctype html>\n<html lang="es"><head>\n${blocks.join('\n')}\n</head><body></body></html>\n`;
}
