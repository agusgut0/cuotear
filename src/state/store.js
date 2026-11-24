import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { emptyState, isRunState, STATE_SCHEMA_VERSION } from './schema.js';

/**
 * Loading and saving of the run state (DRT 9, S-25, ADR-0004).
 *
 * A lost, unreadable, invalid or unknown-version state is not an error: the
 * run starts clean. That means failure counters at 0, no `prevBest` or
 * `eligible` (so no best-option alerts or `mejor_vp` alerts that run), no
 * pending or sent alerts, no last valid configuration and no robots copies;
 * the history is untouched. The caller shows `notice` (a GitHub `::notice::`
 * line plus a summary row) and may use `rebuilt` to skip those alerts.
 * Per DRT 9 a rebuilt state is NOT one of the operational-notice causes of
 * RNF-15 (no `cuotear-ops` issue).
 *
 * @typedef {'missing'|'unreadable'|'invalid_json'|'unknown_version'|'invalid_schema'} LossReason
 * @typedef {{ state: import('./schema.js').RunState, rebuilt: false, reason: null, notice: null }
 *   | { state: import('./schema.js').RunState, rebuilt: true, reason: LossReason, notice: string }} LoadResult
 */

export const STATE_PATH = '.state/state.json';

/**
 * Upgrades an older state to the current version. Only version 1 exists:
 * register future migrations here, keyed by the version they upgrade FROM.
 * @type {Readonly<Record<number, (old: Record<string, unknown>) => Record<string, unknown>>>}
 */
const MIGRATIONS = Object.freeze({});

/**
 * @param {LossReason} reason
 * @returns {LoadResult}
 */
function lost(reason) {
  return { state: emptyState(), rebuilt: true, reason, notice: `::notice::cuotear: the run state was rebuilt (${reason}); failure counters restart at 0 and this run sends no best-option alerts` };
}

/**
 * @param {string} [path]
 * @returns {LoadResult}
 */
export function loadState(path = STATE_PATH) {
  if (!existsSync(path)) return lost('missing');

  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return lost('unreadable');
  }

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return lost('invalid_json');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return lost('invalid_schema');

  let candidate = /** @type {Record<string, unknown>} */ (parsed);
  let version = candidate.schemaVersion;
  while (typeof version === 'number' && version < STATE_SCHEMA_VERSION) {
    const migrate = MIGRATIONS[version];
    if (migrate === undefined) return lost('unknown_version');
    candidate = migrate(candidate);
    version = candidate.schemaVersion;
  }
  if (version !== STATE_SCHEMA_VERSION) return lost('unknown_version');
  if (!isRunState(candidate)) {
    // The inflation value is a re-queryable cache: when only it is invalid, drop it and keep the rest of the state.
    if (!Object.hasOwn(candidate, 'inflation')) return lost('invalid_schema');
    const rest = { ...candidate };
    delete rest.inflation;
    if (!isRunState(rest)) return lost('invalid_schema');
    return { state: rest, rebuilt: false, reason: null, notice: null };
  }
  return { state: candidate, rebuilt: false, reason: null, notice: null };
}

/**
 * Writes the state atomically (temp file + rename) after validating it. An
 * invalid state is a bug in the caller, so this throws instead of writing it.
 * @param {import('./schema.js').RunState} state
 * @param {string} [path]
 */
export function saveState(state, path = STATE_PATH) {
  if (!isRunState(state)) throw new TypeError('refusing to save an invalid run state');
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(temporary, path);
}
