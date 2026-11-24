import { purge, serializeHistory } from './history.js';

/**
 * Size limits of the history (DRT 8.2, RNF-13, S-33). Pure: the pipeline gives
 * the proposed content of every product file and gets back what to write.
 * The thresholds are code constants, not configuration (ST-07).
 *
 * @typedef {import('./history.js').HistoryPoint} HistoryPoint
 */

const MB = 1024 * 1024;

/** From this size on the owner is warned (cause `historial-45mb`). */
export const WARN_BYTES = 45 * MB;
/** Soft limit: above it the warning stays, points are still recorded. */
export const SOFT_BYTES = 50 * MB;
/** Hard limit: above it no new points are persisted (cause `historial-100mb`). */
export const HARD_BYTES = 100 * MB;

export const SIZE_CAUSE_WARN = 'historial-45mb';
export const SIZE_CAUSE_HARD = 'historial-100mb';

/** @param {string} text @returns {number} UTF-8 bytes */
const bytesOf = (text) => Buffer.byteLength(text, 'utf8');

/**
 * @param {number} bytes total size of `data/history/*.jsonl`
 * @returns {'ok' | 'warn' | 'soft' | 'hard'}
 */
export function sizeLevel(bytes) {
  if (bytes > HARD_BYTES) return 'hard';
  if (bytes > SOFT_BYTES) return 'soft';
  if (bytes >= WARN_BYTES) return 'warn';
  return 'ok';
}

/**
 * Decides what to persist. Size is measured on the PROPOSED files (after this
 * run's points and retention). Above the hard limit the new points are
 * dropped: each file keeps its previous points, still subject to retention so
 * the history can shrink back under the limit.
 *
 * @param {{
 *   products: readonly { id: string, previous: readonly HistoryPoint[], proposed: readonly HistoryPoint[] }[],
 *   now: Date,
 *   retentionMonths?: number,
 * }} input
 * @returns {{ writes: Map<string, readonly HistoryPoint[]>, bytes: number, level: 'ok' | 'warn' | 'soft' | 'hard', cause: string | null, frozen: boolean }}
 */
export function limitHistory({ products, now, retentionMonths }) {
  /** @type {Map<string, readonly HistoryPoint[]>} */
  const writes = new Map(products.map((product) => [product.id, product.proposed]));
  const total = () => [...writes.values()].reduce((sum, points) => sum + bytesOf(serializeHistory(points)), 0);

  let bytes = total();
  const proposedLevel = sizeLevel(bytes);
  if (proposedLevel !== 'hard') return { writes, bytes, level: proposedLevel, cause: proposedLevel === 'ok' ? null : SIZE_CAUSE_WARN, frozen: false };

  for (const product of products) writes.set(product.id, purge(product.previous, now, retentionMonths).points);
  bytes = total();
  return { writes, bytes, level: 'hard', cause: SIZE_CAUSE_HARD, frozen: true };
}
