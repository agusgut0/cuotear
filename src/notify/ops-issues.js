import { createApi, isValidRepo } from './github-api.js';

/**
 * Operational notices as GitHub issues, one open issue per cause (DRT 13.6,
 * ADR-0009). Reconciliation per run: present cause with an open issue =>
 * update the body (no comment); without one => create it; absent cause with an
 * open issue => "resuelto" comment + close (ST-11).
 *
 * Issues are public: bodies hold only fixed texts, the cause key, store ids
 * from the registry (validated against a strict pattern), timestamps and the
 * run link. No downloaded text, no secrets. An API failure is logged and never
 * thrown (RNF-15). `dryRun` touches nothing.
 *
 * @typedef {typeof fetch} FetchFn
 * @typedef {{ status: 'ok' | 'skipped' | 'failed', created: string[], updated: string[], closed: string[], errors: number }} ReconcileResult
 */

export const OPS_LABEL = 'cuotear-ops';
export const TITLE_PREFIX = '[cuotear-ops] ';
export const MAX_PAGES = 5;
const PER_PAGE = 100;
const MAX_RUNS_COUNT = 1_000_000;

const FIXED_CAUSES = /** @type {const} */ ({
  'todas-tiendas-fallan': 'Todas las tiendas fallaron en la última ejecución; el sitio conserva los datos anteriores',
  'secretos-canal': 'Faltan o son inválidos los secretos del canal de alertas; no se envían alertas',
  'config-invalida': 'La configuración del repositorio es inválida; se usa la última configuración válida',
  'config-ausente': 'No hay configuración válida disponible',
  'historial-45mb': 'El historial superó los 45 MB',
  'historial-100mb': 'El historial superó los 100 MB',
  'commit-conflicto': 'No se pudo publicar el commit del historial por un conflicto; se reintenta en la próxima ejecución',
  inactividad: 'El repositorio lleva más de 45 días sin commits; GitHub puede suspender las ejecuciones programadas',
  disponibilidad: 'La disponibilidad de las ejecuciones programadas en 30 días quedó por debajo del 95 %',
});

const ROBOTS_PATTERN = /^robots:[a-z0-9-]{2,30}$/;
/** Store ids as they may appear in a `robots:<store>` cause (source of an anchored pattern). */
export const STORE_ID_SOURCE = '^[a-z0-9-]{2,30}$';
/** Source of an anchored pattern that accepts exactly the valid cause keys; the state schema reuses it. */
export const CAUSE_PATTERN_SOURCE = `^(?:${Object.keys(FIXED_CAUSES).join('|')}|robots:[a-z0-9-]{2,30})$`;
const MARKER_PATTERN = /<!-- cuotear-ops:cause=([a-z0-9:-]{1,60}) -->/;
const RUNS_PATTERN = /<!-- cuotear-ops:runs=(\d{1,7}) -->/;

/**
 * @param {unknown} cause
 * @returns {cause is string}
 */
export const isValidCause = (cause) => typeof cause === 'string' && (Object.hasOwn(FIXED_CAUSES, cause) || ROBOTS_PATTERN.test(cause));

/**
 * Title description in es-AR for a validated cause.
 * @param {string} cause
 * @returns {string}
 */
function describeCause(cause) {
  if (ROBOTS_PATTERN.test(cause)) {
    return `robots.txt de la tienda ${cause.slice('robots:'.length)} prohíbe o no permite leer una URL configurada; no se hizo ningún pedido de producto`;
  }
  return FIXED_CAUSES[/** @type {keyof typeof FIXED_CAUSES} */ (cause)];
}

/**
 * Drops `todas-tiendas-fallan` when every measured store already has its own
 * `robots:<store>` cause (the failure is fully explained; DRT 13.6 Supuesto).
 * Without the measured stores no deduplication happens.
 * @param {readonly string[]} causes
 * @param {readonly string[] | undefined} measuredStores stores with at least one measured URL
 * @returns {string[]}
 */
export function dedupeCauses(causes, measuredStores) {
  const list = [...causes];
  if (!list.includes('todas-tiendas-fallan') || measuredStores === undefined || measuredStores.length === 0) return list;
  const covered = measuredStores.every((store) => list.includes(`robots:${store}`));
  return covered ? list.filter((cause) => cause !== 'todas-tiendas-fallan') : list;
}

/**
 * @param {string} repo
 * @param {string | undefined} runUrl
 * @returns {string | undefined} the link only when it points to a run of this repo
 */
function safeRunUrl(repo, runUrl) {
  if (typeof runUrl !== 'string') return undefined;
  return new RegExp(`^https://github\\.com/${repo.replace(/[.]/g, '\\.')}/actions/runs/[0-9]{1,20}$`).test(runUrl) ? runUrl : undefined;
}

/**
 * @param {{ cause: string, runs: number, now: Date, runUrl?: string }} input
 * @returns {string}
 */
export function buildBody({ cause, runs, now, runUrl }) {
  return [
    `<!-- cuotear-ops:cause=${cause} -->`,
    `<!-- cuotear-ops:runs=${runs} -->`,
    `**Aviso operativo:** ${describeCause(cause)}.`,
    '',
    `- Causa: \`${cause}\``,
    `- Última vez visto: ${now.toISOString()}`,
    `- Ejecuciones consecutivas con este aviso: ${runs}`,
    ...(runUrl === undefined ? [] : [`- Ejecución: ${runUrl}`]),
    '',
    'Este issue lo mantiene cuotear: se actualiza en cada ejecución y se cierra solo cuando la causa desaparece.',
  ].join('\n');
}

/**
 * Cause key from a body, or undefined when the marker is missing or edited
 * into something that is not a valid cause (the issue is then left alone).
 * @param {unknown} body
 * @returns {string | undefined}
 */
export function parseCause(body) {
  if (typeof body !== 'string') return undefined;
  const cause = MARKER_PATTERN.exec(body)?.[1];
  return isValidCause(cause) ? cause : undefined;
}

/**
 * @param {unknown} body
 * @returns {number}
 */
function parseRuns(body) {
  if (typeof body !== 'string') return 0;
  const runs = Number.parseInt(RUNS_PATTERN.exec(body)?.[1] ?? '', 10);
  return Number.isSafeInteger(runs) && runs >= 0 && runs < MAX_RUNS_COUNT ? runs : 0;
}

/**
 * @param {{
 *   causes: readonly string[],
 *   repo: string,
 *   token: string | undefined,
 *   fetch?: FetchFn,
 *   runUrl?: string,
 *   now?: Date,
 *   dryRun?: boolean,
 *   measuredStores?: readonly string[],
 *   log?: (line: string) => void,
 *   timeoutMs?: number,
 * }} input
 * @returns {Promise<ReconcileResult>}
 */
export async function reconcileOpsIssues({ causes, repo, token, fetch: fetchFn = fetch, runUrl, now = new Date(), dryRun = false, measuredStores, log = console.log, timeoutMs }) {
  /** @type {ReconcileResult} */
  const result = { status: 'ok', created: [], updated: [], closed: [], errors: 0 };
  try {
    const valid = dedupeCauses(causes.filter((cause) => {
      if (isValidCause(cause)) return true;
      log('[cuotear] ops-issues: ignoring a cause with an invalid key');
      return false;
    }), measuredStores);
    const present = [...new Set(valid)].sort();
    if (dryRun) {
      log(`[cuotear] ops-issues: dry run, issues untouched (${present.length} cause(s))`);
      return { ...result, status: 'skipped' };
    }
    if (token === undefined || token === '' || !isValidRepo(repo)) {
      log('[cuotear] ops-issues: no token or repository available, issues untouched');
      return { ...result, status: 'skipped' };
    }
    const api = createApi({ fetch: fetchFn, token, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
    const base = `/repos/${repo}`;
    const link = safeRunUrl(repo, runUrl);

    /** @type {Map<string, { number: number, body: unknown }[]>} */
    const open = new Map();
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const response = await api('GET', `${base}/issues?labels=${OPS_LABEL}&state=open&per_page=${PER_PAGE}&page=${page}`);
      if (!response.ok || !Array.isArray(response.data)) {
        log(`[cuotear] ops-issues: listing open issues failed (status ${response.status}); nothing reconciled`);
        return { ...result, status: 'failed', errors: 1 };
      }
      for (const issue of response.data) {
        if (typeof issue !== 'object' || issue === null || 'pull_request' in issue) continue;
        const { number, body } = /** @type {{ number?: unknown, body?: unknown }} */ (issue);
        const cause = parseCause(body);
        if (typeof number !== 'number' || !Number.isSafeInteger(number) || cause === undefined) continue;
        open.set(cause, [...(open.get(cause) ?? []), { number, body }]);
      }
      if (response.data.length < PER_PAGE) break;
    }

    /**
     * @param {boolean} ok
     * @param {string} what
     */
    const track = (ok, what) => {
      if (!ok) {
        result.errors += 1;
        log(`[cuotear] ops-issues: ${what} failed`);
      }
      return ok;
    };
    let labelReady = false;

    for (const cause of present) {
      const existing = open.get(cause)?.[0];
      if (existing !== undefined) {
        const body = buildBody({ cause, runs: parseRuns(existing.body) + 1, now, ...(link === undefined ? {} : { runUrl: link }) });
        const response = await api('PATCH', `${base}/issues/${existing.number}`, { body });
        if (track(response.ok, `updating the issue for ${cause}`)) result.updated.push(cause);
        continue;
      }
      if (!labelReady) {
        const label = await api('POST', `${base}/labels`, { name: OPS_LABEL, color: 'b60205', description: 'Avisos operativos de cuotear' });
        // 422 = the label already exists.
        if (!label.ok && label.status !== 422) log('[cuotear] ops-issues: creating the label failed');
        labelReady = true;
      }
      const body = buildBody({ cause, runs: 1, now, ...(link === undefined ? {} : { runUrl: link }) });
      const response = await api('POST', `${base}/issues`, { title: `${TITLE_PREFIX}${describeCause(cause)}`, body, labels: [OPS_LABEL] });
      if (track(response.ok, `creating the issue for ${cause}`)) result.created.push(cause);
    }

    for (const [cause, issues] of open) {
      if (present.includes(cause)) continue;
      let closedAll = true;
      for (const issue of issues) {
        const comment = await api('POST', `${base}/issues/${issue.number}/comments`, { body: `Resuelto: la causa \`${cause}\` no apareció en la última ejecución (${now.toISOString()}). Se cierra el aviso.` });
        if (!track(comment.ok, `commenting on the issue for ${cause}`)) {
          closedAll = false;
          continue;
        }
        const closed = await api('PATCH', `${base}/issues/${issue.number}`, { state: 'closed', state_reason: 'completed' });
        if (!track(closed.ok, `closing the issue for ${cause}`)) closedAll = false;
      }
      if (closedAll) result.closed.push(cause);
    }
    log(`[cuotear] ops-issues: created ${result.created.length}, updated ${result.updated.length}, closed ${result.closed.length}, errors ${result.errors}`);
  } catch {
    log('[cuotear] ops-issues: unexpected error; issues not reconciled');
    return { ...result, status: 'failed', errors: result.errors + 1 };
  }
  return result;
}
