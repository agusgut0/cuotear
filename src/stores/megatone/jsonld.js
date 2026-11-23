/**
 * JSON-LD extraction for product pages (DRT 6.3). The page is untrusted data:
 * blocks are located with a linear scanner (no backtracking), parsed with
 * `JSON.parse` only (nothing is executed or evaluated) and walked with
 * explicit depth and node limits.
 */

export const MAX_BLOCKS = 20;
export const MAX_BLOCK_CHARS = 200_000;
const MAX_NODES = 500;
const MAX_DEPTH = 4;

const MAX_TAG_CHARS = 1024;
const OPEN = '<script';
const CLOSE = '</script';
const LD_TYPE = /\btype\s*=\s*["']?application\/ld\+json/;
const WORD = /\w/;
const SPACE = /\s/;

/**
 * ASCII-only lowercase: unlike `toLowerCase` it never changes the string
 * length, so indexes found in the copy are valid in the original.
 * @param {string} text
 * @returns {string}
 */
const asciiLower = (text) => text.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());

/**
 * Finds `</script\s*>` from `from`. Every `indexOf` moves forward, so the total
 * work stays linear in the page size.
 * @param {string} lower
 * @param {number} from
 * @returns {{ start: number, end: number } | null}
 */
function findClose(lower, from) {
  let at = from;
  for (;;) {
    const start = lower.indexOf(CLOSE, at);
    if (start === -1) return null;
    let cursor = start + CLOSE.length;
    while (cursor < lower.length && SPACE.test(lower.charAt(cursor))) cursor += 1;
    if (lower.charAt(cursor) === '>') return { start, end: cursor + 1 };
    at = start + CLOSE.length;
  }
}

/**
 * Parses the JSON-LD blocks of an HTML document. Blocks that are too large or
 * are not valid JSON are skipped and counted. Scanning is linear: it stops at
 * `MAX_BLOCKS` blocks and never accepts an opening tag longer than
 * `MAX_TAG_CHARS`.
 * @param {string} html
 * @returns {{ values: unknown[], skipped: number }}
 */
export function parseJsonLdBlocks(html) {
  /** @type {unknown[]} */
  const values = [];
  let skipped = 0;
  let seen = 0;
  const lower = asciiLower(html);
  let pos = 0;
  let nextGt = -2; // cached position of the next '>' (-1: none left)
  for (;;) {
    const open = lower.indexOf(OPEN, pos);
    if (open === -1) break;
    const afterName = open + OPEN.length;
    if (WORD.test(lower.charAt(afterName))) {
      pos = afterName;
      continue;
    }
    if (nextGt !== -1 && nextGt < afterName) nextGt = lower.indexOf('>', afterName);
    if (nextGt === -1) break; // no tag can end anywhere after this point
    if (nextGt - open > MAX_TAG_CHARS) {
      pos = afterName;
      continue;
    }
    const bodyStart = nextGt + 1;
    pos = bodyStart;
    if (!LD_TYPE.test(lower.slice(afterName, nextGt))) continue;
    const close = findClose(lower, bodyStart);
    if (close === null) break; // unclosed: nothing after it can close either
    pos = close.end;
    seen += 1;
    if (seen > MAX_BLOCKS) break;
    if (close.start - bodyStart > MAX_BLOCK_CHARS) {
      skipped += 1;
      continue;
    }
    try {
      values.push(JSON.parse(html.slice(bodyStart, close.start)));
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

const OFFER_KEYS = ['@type', 'price', 'lowPrice', 'priceCurrency', 'availability'];

/**
 * Whitelists the fields of an offer (or list of offers) kept in fixtures.
 * @param {unknown} offers
 * @returns {unknown}
 */
function trimOffers(offers) {
  if (Array.isArray(offers)) return offers.filter(isRecord).map((offer) => trimOffers(offer));
  if (!isRecord(offers)) return offers;
  /** @type {Record<string, unknown>} */
  const kept = {};
  for (const key of OFFER_KEYS) if (key in offers) kept[key] = offers[key];
  return kept;
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
    for (const key of keys) if (key in product) kept[key] = key === 'offers' ? trimOffers(product[key]) : product[key];
    return `<script type="application/ld+json">${JSON.stringify(kept).replace(/</g, '\\u003c')}</script>`;
  });
  return `<!doctype html>\n<html lang="es"><head>\n${blocks.join('\n')}\n</head><body></body></html>\n`;
}
