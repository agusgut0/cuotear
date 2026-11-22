import Ajv2020 from 'ajv/dist/2020.js';

/**
 * Run-state schema (DRT 9, ADR-0004). The state lives outside the commits
 * (GitHub Actions cache) and carries what must not generate commits: failure
 * counters, the last valid configuration, previous best options and
 * eligibility, alerts, inflation and robots.txt copies.
 *
 * @typedef {Object} RunState
 * @property {1} schemaVersion
 * @property {string} [lastRunAt] UTC ISO 8601
 * @property {{ hash: string, config: Record<string, unknown> }} [lastValidConfig]
 * @property {import('../core/series.js').Counters} series failure counters by `<product>|<store>/<serie>`
 * @property {Record<string, string[]>} eligible eligible series of the previous run, by product
 * @property {Record<string, { tipo: 'contado'|'cuotas', tienda: string, serie: string, valorCents: number, r: number|null }>} prevBest
 * @property {{ fuente: 'rem'|'manual', anualPct: number, fecha: string, obtainedAt: string }} [inflation]
 * @property {Record<string, import('../http/client.js').RobotsEntry>} robots
 * @property {Record<string, unknown>[]} pendingAlerts
 * @property {{ id: string, at: string }[]} sentAlertIds
 * @property {{ lastCauses: string[] }} ops
 */

export const STATE_SCHEMA_VERSION = 1;

const timestamp = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?Z$' };

export const stateSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://cuotear.local/state/state.schema.json',
  title: 'cuotear: run state v1',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'series', 'eligible', 'prevBest', 'robots', 'pendingAlerts', 'sentAlertIds', 'ops'],
  properties: {
    schemaVersion: { const: STATE_SCHEMA_VERSION },
    lastRunAt: timestamp,
    lastValidConfig: {
      type: 'object',
      additionalProperties: false,
      required: ['hash', 'config'],
      properties: { hash: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' }, config: { type: 'object' } },
    },
    series: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['failures'],
        properties: { failures: { type: 'integer', minimum: 0, maximum: 1000000 }, lastValidAt: timestamp },
      },
    },
    eligible: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
    prevBest: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['tipo', 'tienda', 'serie', 'valorCents', 'r'],
        properties: {
          tipo: { enum: ['contado', 'cuotas'] },
          tienda: { type: 'string' },
          serie: { type: 'string' },
          valorCents: { type: 'number', minimum: 0 },
          r: { anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }] },
        },
      },
    },
    inflation: {
      type: 'object',
      additionalProperties: false,
      required: ['fuente', 'anualPct', 'fecha', 'obtainedAt'],
      properties: { fuente: { enum: ['rem', 'manual'] }, anualPct: { type: 'number', minimum: 0 }, fecha: { type: 'string' }, obtainedAt: timestamp },
    },
    robots: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['fetchedAt', 'status', 'rules'],
        properties: {
          fetchedAt: timestamp,
          status: { type: 'integer' },
          rules: {
            type: 'array',
            items: { type: 'object', additionalProperties: false, required: ['allow', 'pattern'], properties: { allow: { type: 'boolean' }, pattern: { type: 'string' } } },
          },
        },
      },
    },
    pendingAlerts: { type: 'array', items: { type: 'object' } },
    sentAlertIds: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['id', 'at'], properties: { id: { type: 'string' }, at: timestamp } },
    },
    ops: { type: 'object', additionalProperties: false, required: ['lastCauses'], properties: { lastCauses: { type: 'array', items: { type: 'string' } } } },
  },
};

/** @type {import('ajv').ValidateFunction | undefined} */
let compiled;

/**
 * @param {unknown} value
 * @returns {value is RunState}
 */
export function isRunState(value) {
  compiled ??= new Ajv2020.default({ allErrors: false, strict: true, strictRequired: false }).compile(stateSchema);
  return compiled(value) === true;
}

/**
 * A clean state: what a run starts with after a loss (S-25).
 * @returns {RunState}
 */
export function emptyState() {
  return { schemaVersion: STATE_SCHEMA_VERSION, series: {}, eligible: {}, prevBest: {}, robots: {}, pendingAlerts: [], sentAlertIds: [], ops: { lastCauses: [] } };
}
