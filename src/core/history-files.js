import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseHistory, serializeHistory } from './history.js';

/**
 * The only module of the history code that touches the filesystem
 * (DRT 8.1): one JSON Lines file per product under `data/history/`.
 */

export const HISTORY_DIR = 'data/history';

const PRODUCT_ID = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/**
 * Path of a product's history file. The product id is validated so it can
 * never escape the directory.
 * @param {string} directory
 * @param {string} productId
 * @returns {string}
 */
export function historyPath(directory, productId) {
  if (!PRODUCT_ID.test(productId)) throw new RangeError(`invalid product id: ${productId}`);
  return join(directory, `${productId}.jsonl`);
}

/**
 * @param {string} directory
 * @param {string} productId
 * @returns {{ points: import('./history.js').HistoryPoint[], ignored: number }} a missing file is an empty history
 */
export function readHistory(directory, productId) {
  const path = historyPath(directory, productId);
  if (!existsSync(path)) return { points: [], ignored: 0 };
  return parseHistory(readFileSync(path, 'utf8'));
}

/**
 * Writes a product's history only when its serialized text differs from the
 * file, so a run without changes touches no file (RF-24: zero commits).
 * @param {string} directory
 * @param {string} productId
 * @param {readonly import('./history.js').HistoryPoint[]} points
 * @returns {boolean} true when the file was written
 */
export function writeHistory(directory, productId, points) {
  const path = historyPath(directory, productId);
  const text = serializeHistory(points);
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (current === text || (current === null && text === '')) return false;
  mkdirSync(directory, { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, path);
  return true;
}

/**
 * Deletes the history of a product removed from the configuration (S-33).
 * @param {string} directory
 * @param {string} productId
 * @returns {boolean} true when a file was deleted
 */
export function removeHistory(directory, productId) {
  const path = historyPath(directory, productId);
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}
