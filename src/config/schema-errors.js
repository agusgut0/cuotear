import { isSecretKey } from './secrets.js';

/**
 * @typedef {import('ajv').ErrorObject} AjvError
 * @typedef {{ path: import('./source.js').Path, atKey: boolean, message: string }} SchemaIssue
 */

const TYPE_NAMES = /** @type {Record<string, string>} */ ({
  string: 'un texto',
  number: 'un número',
  integer: 'un número entero',
  object: 'un objeto',
  array: 'una lista',
  boolean: 'verdadero o falso',
});

/**
 * @param {string} pointer JSON pointer such as `/productos/0/urls`
 * @returns {import('./source.js').Path}
 */
function pointerToPath(pointer) {
  return pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

/**
 * @param {unknown} data
 * @param {import('./source.js').Path} path
 * @returns {unknown}
 */
function valueAt(data, path) {
  return path.reduce(
    (value, segment) => (value !== null && typeof value === 'object' ? /** @type {Record<string|number, unknown>} */ (value)[segment] : undefined),
    data,
  );
}

/**
 * @param {AjvError} error
 * @param {unknown} data
 * @returns {SchemaIssue}
 */
function toIssue(error, data) {
  const path = pointerToPath(error.instancePath);
  const params = /** @type {Record<string, any>} */ (error.params);

  switch (error.keyword) {
    case 'additionalProperties': {
      const name = String(params.additionalProperty);
      const message = isSecretKey(name)
        ? `el campo "${name}" no está permitido: los secretos no van en la configuración (usá los secretos de GitHub Actions)`
        : `campo desconocido "${name}"`;
      return { path: [...path, name], atKey: true, message };
    }
    case 'required':
      return { path, atKey: false, message: `falta el campo obligatorio "${params.missingProperty}"` };
    case 'maxItems': {
      const count = /** @type {unknown[]} */ (valueAt(data, path)).length;
      const what = path.at(-1) === 'productos' ? 'productos' : 'elementos';
      return { path, atKey: true, message: `máximo ${params.limit} ${what} (hay ${count})` };
    }
    case 'type':
      return { path, atKey: false, message: `debe ser ${TYPE_NAMES[String(params.type)] ?? String(params.type)}` };
    case 'enum':
      return { path, atKey: false, message: `valor no permitido (valores válidos: ${params.allowedValues.join(', ')})` };
    case 'const':
      return { path, atKey: false, message: `el valor debe ser ${JSON.stringify(params.allowedValue)}` };
    case 'minimum':
      return { path, atKey: false, message: `debe ser mayor o igual que ${params.limit}` };
    case 'maximum':
      return { path, atKey: false, message: `debe ser menor o igual que ${params.limit}` };
    case 'exclusiveMinimum':
      return { path, atKey: false, message: `debe ser mayor que ${params.limit}` };
    case 'minLength':
      return { path, atKey: false, message: `debe tener al menos ${params.limit} caracteres` };
    case 'maxLength':
      return { path, atKey: false, message: `debe tener como máximo ${params.limit} caracteres` };
    case 'minProperties':
      return { path, atKey: true, message: `debe tener al menos ${params.limit} entrada(s)` };
    case 'maxProperties':
      return { path, atKey: true, message: `debe tener como máximo ${params.limit} entradas` };
    case 'pattern': {
      if (error.propertyName !== undefined) {
        return { path: [...path, error.propertyName], atKey: true, message: `nombre inválido "${error.propertyName}"` };
      }
      return { path, atKey: false, message: `formato inválido (debe cumplir ${params.pattern})` };
    }
    case 'oneOf':
      return { path, atKey: false, message: 'valor inválido: se esperaba un número positivo, false o "no"' };
    default:
      return { path, atKey: false, message: `no cumple el esquema (${error.keyword})` };
  }
}

/**
 * Translates Ajv errors to es-AR issues, dropping the noisy wrapper and
 * branch errors that `if`, `propertyNames` and `oneOf` produce.
 * @param {AjvError[]} errors
 * @param {unknown} data
 * @returns {SchemaIssue[]}
 */
export function schemaIssues(errors, data) {
  const oneOfErrors = errors.filter((error) => error.keyword === 'oneOf');
  return errors
    .filter((error) => error.keyword !== 'if' && error.keyword !== 'propertyNames')
    .filter(
      (error) =>
        !oneOfErrors.some(
          (wrapper) =>
            wrapper !== error && wrapper.instancePath === error.instancePath && error.schemaPath.startsWith(`${wrapper.schemaPath}/`),
        ),
    )
    .map((error) => toIssue(error, data));
}
