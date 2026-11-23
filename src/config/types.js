/**
 * Shapes of the validated configuration (see config/cuotear.schema.json).
 *
 * @typedef {'contado'|'total_cuotas'|'mejor_vp'} AppliesTo
 * @typedef {number|false|'no'} Disableable
 *
 * @typedef {Object} AlertRules
 * @property {Disableable} [baja_minima_pct]
 * @property {Disableable} [baja_minima_monto]
 * @property {Disableable} [precio_objetivo]
 * @property {AppliesTo} [aplica_a]
 * @property {boolean} [cambio_mejor_opcion]
 *
 * @typedef {Object} ManualInflation
 * @property {'mensual'|'anual'} periodo
 * @property {number} pct
 *
 * @typedef {Object} Product
 * @property {string} id
 * @property {string} nombre
 * @property {Record<string, string>} urls store id -> product URL
 * @property {AlertRules} [reglas]
 *
 * @typedef {Object} Config
 * @property {1} version
 * @property {{ canal?: 'telegram'|'ninguno', idioma?: 'es-AR'|'en', reglas?: AlertRules }} [alertas]
 * @property {{ s?: 0|1, inflacion?: { fuente: 'rem'|'manual', manual?: ManualInflation } }} [comparacion]
 * @property {Record<string, number|string>} [operacion]
 * @property {Product[]} productos
 *
 * @typedef {Object} Issue
 * @property {string} file
 * @property {number} line 1-based
 * @property {number} column 1-based
 * @property {string} path e.g. `productos[2].urls.oncity`
 * @property {string} message es-AR
 *
 * @typedef {Object} ValidationResult
 * @property {boolean} ok
 * @property {Config|null} config the parsed configuration when `ok`
 * @property {Issue[]} errors
 * @property {Issue[]} warnings
 */

export {};
