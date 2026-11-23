import { createHash } from 'node:crypto';
import { validateConfigFile } from '../config/validate.js';

/**
 * Chooses the effective configuration of a run (RF-19, S-12, DRT 4.4): the
 * repository file when valid, else the last valid one kept in the run state,
 * else none (nothing is measured or published).
 *
 * @typedef {{ kind: 'repo', config: import('../config/types.js').Config, hash: string, errors: [] }
 *   | { kind: 'fallback', config: import('../config/types.js').Config, errors: import('../config/types.js').Issue[] }
 *   | { kind: 'none', errors: import('../config/types.js').Issue[] }} ConfigChoice
 */

/**
 * @param {import('../config/types.js').Config} config
 * @returns {string} `sha256:<hex>` of the normalized configuration
 */
export const configHash = (config) => `sha256:${createHash('sha256').update(JSON.stringify(config)).digest('hex')}`;

/**
 * @param {{ configPath: string, state: import('../state/schema.js').RunState, registry?: readonly import('../stores/index.js').StoreRegistration[] }} input
 * @returns {ConfigChoice}
 */
export function selectConfig({ configPath, state, registry }) {
  /** @type {import('../config/types.js').ValidationResult} */
  let result;
  try {
    result = validateConfigFile(configPath, registry === undefined ? {} : { registry });
  } catch (error) {
    const message = `no se pudo leer el archivo: ${error instanceof Error ? error.message : String(error)}`;
    result = { ok: false, config: null, errors: [{ file: configPath, line: 1, column: 1, path: '', message }], warnings: [] };
  }

  if (result.ok && result.config !== null) return { kind: 'repo', config: result.config, hash: configHash(result.config), errors: [] };
  if (state.lastValidConfig !== undefined) {
    return { kind: 'fallback', config: /** @type {import('../config/types.js').Config} */ (/** @type {unknown} */ (state.lastValidConfig.config)), errors: result.errors };
  }
  return { kind: 'none', errors: result.errors };
}
