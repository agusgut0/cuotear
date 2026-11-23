/**
 * Operational parameters of a run, read from the effective configuration with
 * the defaults of DRT 17.
 *
 * @typedef {Object} Settings
 * @property {number} failuresForNoData
 * @property {number} staleHours
 * @property {number} retentionMonths
 * @property {number} marginalPct
 * @property {string} codigoPostal
 * @property {0|1} s month of the first installment
 * @property {{ fuente: 'rem'|'manual', manual?: import('../config/types.js').ManualInflation }} inflation
 */

/**
 * @param {import('../config/types.js').Config} config
 * @returns {Settings}
 */
export function settingsOf(config) {
  const operation = config.operacion ?? {};
  /** @type {(key: string, fallback: number) => number} */
  const number = (key, fallback) => {
    const value = operation[key];
    return typeof value === 'number' ? value : fallback;
  };
  const postalCode = operation.codigo_postal;
  return {
    failuresForNoData: number('fallas_para_sin_datos', 4),
    staleHours: number('desactualizado_horas', 12),
    retentionMonths: number('retencion_meses', 12),
    marginalPct: number('marginal_pct', 1),
    codigoPostal: typeof postalCode === 'string' ? postalCode : '5000',
    s: config.comparacion?.s ?? 1,
    inflation: config.comparacion?.inflacion ?? { fuente: 'rem' },
  };
}
