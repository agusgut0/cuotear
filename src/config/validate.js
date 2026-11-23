import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { stores } from '../stores/index.js';
import { schemaIssues } from './schema-errors.js';
import { validateSemantics } from './semantic.js';
import { formatPath, parseSource } from './source.js';

export const DEFAULT_CONFIG_PATH = 'config/cuotear.yaml';

const PARSE_ERROR_MESSAGES = /** @type {Record<string, string>} */ ({
  DUPLICATE_KEY: 'clave duplicada: cada clave puede aparecer una sola vez (una URL por tienda en cada producto)',
});

/** @type {import('ajv').ValidateFunction | undefined} */
let compiledSchema;

/** @returns {import('ajv').ValidateFunction} */
function schemaValidator() {
  if (!compiledSchema) {
    const schema = JSON.parse(readFileSync(new URL('../../config/cuotear.schema.json', import.meta.url), 'utf8'));
    compiledSchema = new Ajv2020.default({ allErrors: true, strict: true, strictRequired: false }).compile(schema);
  }
  return compiledSchema;
}

/**
 * Validates the text of a configuration file: YAML syntax, JSON Schema and
 * the semantic rules driven by the store registry (DRT 4.2 and 4.3).
 * @param {string} text
 * @param {{ file?: string, registry?: readonly import('../stores/index.js').StoreRegistration[] }} [options]
 * @returns {import('./types.js').ValidationResult}
 */
export function validateConfig(text, { file = DEFAULT_CONFIG_PATH, registry = stores } = {}) {
  const source = parseSource(text);

  /** @type {(path: import('./source.js').Path, atKey: boolean, message: string) => import('./types.js').Issue} */
  const issue = (path, atKey, message) => ({ file, ...source.locate(path, atKey), path: formatPath(path), message });

  if (source.parseErrors.length > 0) {
    const errors = source.parseErrors.map(({ code, message, position }) => ({
      file,
      ...position,
      path: '',
      message: PARSE_ERROR_MESSAGES[code] ?? `YAML inválido: ${message}`,
    }));
    return { ok: false, config: null, errors, warnings: [] };
  }

  const validate = schemaValidator();
  if (!validate(source.data)) {
    const errors = schemaIssues(validate.errors ?? [], source.data).map((found) => issue(found.path, found.atKey, found.message));
    return { ok: false, config: null, errors, warnings: [] };
  }

  const config = /** @type {import('./types.js').Config} */ (source.data);
  const found = validateSemantics(config, registry);
  const errors = found.errors.map((e) => issue(e.path, e.atKey, e.message));
  const warnings = found.warnings.map((w) => issue(w.path, w.atKey, w.message));
  return { ok: errors.length === 0, config: errors.length === 0 ? config : null, errors, warnings };
}

/**
 * @param {import('./types.js').Issue} found
 * @returns {string} `file:line:column path: message`
 */
export function formatIssue({ file, line, column, path, message }) {
  return `${file}:${line}:${column} ${path === '' ? '' : `${path}: `}${message}`;
}

/**
 * @param {string} file
 * @param {{ registry?: readonly import('../stores/index.js').StoreRegistration[] }} [options]
 * @returns {import('./types.js').ValidationResult}
 */
export function validateConfigFile(file, options = {}) {
  return validateConfig(readFileSync(file, 'utf8'), { ...options, file });
}
