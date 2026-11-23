import { computeAvailability } from './availability.js';
import { checkInactivity } from './inactivity.js';
import { isValidCause, reconcileOpsIssues, STORE_ID_SOURCE } from './ops-issues.js';
import { isAlert, readSecrets, sendAlerts } from './telegram.js';
import { MAX_PENDING_ALERTS, MAX_SENT_ALERT_IDS } from '../state/schema.js';
import { stores as defaultRegistry } from '../stores/index.js';

/**
 * Notification step of a run (DRT 11 step 12, 13.3, 13.5, 13.6, 18.3):
 * sends the alerts through Telegram, computes availability and inactivity and
 * reconciles the `cuotear-ops` issues. It takes the state and returns the next
 * one; it never throws and never decides the exit code (RNF-15).
 *
 * - Dedupe: an alert whose id is in `sentAlertIds` (14 days) is not sent again.
 * - Pending: an alert not accepted by Telegram stays in `pendingAlerts`, is
 *   retried on the next run and is dropped after 48 h with a log line (ST-09).
 *   An alert dated in the future or with an invalid date is dropped too.
 * - An id is marked as sent only after Telegram accepted the message, and it is
 *   never lost afterwards: a later failure of this step keeps it.
 * - `canal: ninguno`: nothing is sent, nothing is kept and no notice is raised.
 * - `dryRun`: no message, no issue, the state is returned untouched.
 * - The state is untrusted (a cache can be altered): causes and store ids read
 *   from it are validated before they reach a log line or an issue.
 *
 * @typedef {typeof fetch} FetchFn
 *
 * @typedef {Object} NotifyDeps everything with side effects, injectable so tests never use the network
 * @property {Record<string, string | undefined>} [env] `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
 * @property {FetchFn} [telegramFetch]
 * @property {FetchFn} [githubFetch]
 * @property {string} [githubToken] `GITHUB_TOKEN`
 * @property {string} [repo] `owner/name` (`GITHUB_REPOSITORY`)
 * @property {string} [runUrl] link to this run
 * @property {string} [siteUrl] public URL of the site
 * @property {Date} [cronStart] when scheduling started (shortens the availability window of a young repo)
 * @property {() => Promise<string>} [lastCommitDate] injectable `git log` for the inactivity check
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {() => number} [clock] milliseconds, for the pace between messages
 * @property {boolean} [commitConflict] the history commit was not pushed (cause `commit-conflicto`)
 * @property {ReadonlySet<string>} [allowedHosts]
 * @property {number} [maxMessages] messages sent per run at most (default 10); the rest stay pending
 *
 * @typedef {Object} NotifyInput
 * @property {import('../state/schema.js').RunState} state state after the run step
 * @property {import('../config/types.js').Config | null} config effective configuration; null when there is none
 * @property {readonly string[]} [extraCauses] causes known by the caller (`config-invalida`, `config-ausente`)
 * @property {Record<string, string>} storeNames
 * @property {Date} now
 * @property {boolean} [dryRun]
 * @property {(line: string) => void} [log]
 * @property {NotifyDeps} [deps]
 *
 * @typedef {Object} NotifyOutcome
 * @property {import('../state/schema.js').RunState} state
 * @property {{ sent: number, pending: number, discarded: number, causes: string[], availability: number | null, inactivityDays: number | null }} summary
 */

export const SENT_RETENTION_MS = 14 * 86_400_000;
export const PENDING_MAX_AGE_MS = 48 * 3_600_000;
/** Causes that only this step can know: they are carried to the next run's footer. */
export const NOTIFY_CAUSES = /** @type {const} */ (['secretos-canal', 'inactividad', 'disponibilidad', 'commit-conflicto']);

const NOTIFY_OWNED = new Set([...NOTIFY_CAUSES, 'config-invalida', 'config-ausente']);
const STORE_ID = new RegExp(STORE_ID_SOURCE);

/**
 * @template T
 * @param {readonly T[]} list
 * @param {number} max
 * @returns {T[]} the newest `max` entries
 */
const newest = (list, max) => (list.length > max ? list.slice(list.length - max) : [...list]);

/**
 * @param {import('../state/schema.js').RunState} state
 * @param {Date} now
 * @param {(line: string) => void} log
 * @returns {{ sent: import('../state/schema.js').RunState['sentAlertIds'], pending: import('../core/alerts.js').Alert[], discarded: number }}
 */
function prepareAlerts(state, now, log) {
  const sent = newest(state.sentAlertIds.filter((entry) => now.getTime() - Date.parse(entry.at) <= SENT_RETENTION_MS), MAX_SENT_ALERT_IDS);
  const seen = new Set(sent.map((entry) => entry.id));
  /** @type {import('../core/alerts.js').Alert[]} */
  const pending = [];
  let discarded = 0;
  for (const candidate of state.pendingAlerts) {
    if (!isAlert(candidate)) {
      log('[cuotear] notify: a pending alert is malformed; dropped');
      discarded += 1;
      continue;
    }
    if (seen.has(candidate.id)) continue;
    // `isAlert` guarantees a safe id, a configured-looking product id and a valid timestamp: they can be logged.
    const age = now.getTime() - Date.parse(candidate.detectedAt);
    if (age < 0) {
      log(`[cuotear] notify: alert ${candidate.id.slice(0, 12)} for ${candidate.productId} is dated in the future; discarded`);
      discarded += 1;
      continue;
    }
    if (!(age <= PENDING_MAX_AGE_MS)) {
      log(`[cuotear] notify: alert ${candidate.id.slice(0, 12)} for ${candidate.productId} is older than 48 h and was not delivered; discarded`);
      discarded += 1;
      continue;
    }
    seen.add(candidate.id);
    pending.push(candidate);
  }
  return { sent, pending: newest(pending, MAX_PENDING_ALERTS), discarded };
}

/**
 * @param {NotifyInput} input
 * @returns {Promise<NotifyOutcome>}
 */
export async function runNotify({ state, config, extraCauses = [], storeNames, now, dryRun = false, log = console.log, deps = {} }) {
  const {
    env = {},
    telegramFetch = fetch,
    githubFetch = fetch,
    githubToken,
    repo = '',
    runUrl,
    siteUrl,
    cronStart,
    lastCommitDate,
    sleep,
    clock,
    commitConflict = false,
    allowedHosts = new Set(defaultRegistry.flatMap((store) => store.hosts)),
    maxMessages,
  } = deps;
  const summary = { sent: 0, pending: 0, discarded: 0, causes: /** @type {string[]} */ ([]), availability: /** @type {number | null} */ (null), inactivityDays: /** @type {number | null} */ (null) };
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z');

  // What a failure must never lose: the ids Telegram accepted, and the alerts still waiting.
  let sent = state.sentAlertIds;
  let pending = /** @type {import('../core/alerts.js').Alert[]} */ (/** @type {unknown} */ (state.pendingAlerts));
  /** @returns {NotifyOutcome} */
  const keepWhatWentOut = () => {
    const done = new Set(sent.map((entry) => entry.id));
    return { state: { ...state, pendingAlerts: pending.filter((alert) => !done.has(alert.id)), sentAlertIds: sent }, summary };
  };

  try {
    const lastCauses = state.ops.lastCauses.filter(isValidCause);
    const measuredStores = state.ops.measuredStores?.filter((store) => typeof store === 'string' && STORE_ID.test(store));

    if (dryRun) {
      log(`[cuotear] notify: dry run, nothing is sent and no issue is touched (${state.pendingAlerts.length} alert(s) waiting)`);
      return { state, summary: { ...summary, pending: state.pendingAlerts.length, causes: [...lastCauses, ...extraCauses.filter(isValidCause)] } };
    }

    const prepared = prepareAlerts(state, now, log);
    summary.discarded = prepared.discarded;
    ({ pending, sent } = prepared);
    const channel = config?.alertas?.canal ?? 'telegram';
    let channelBroken = state.ops.channelBroken === true;
    // The run step owns `lastCauses`; the causes this step adds are recomputed, never inherited (an idempotent re-run).
    const causes = [...lastCauses.filter((cause) => !NOTIFY_OWNED.has(cause)), ...extraCauses.filter(isValidCause)];

    if (config === null || channel === 'ninguno') {
      // No channel (or no configuration): there is nobody to notify and no notice for it.
      if (channel === 'ninguno') {
        pending = [];
        channelBroken = false;
      }
    } else {
      const secrets = readSecrets(env);
      if (secrets === null) {
        log('[cuotear] notify: the Telegram secrets are missing or malformed; no alert is sent');
        causes.push('secretos-canal');
      } else if (pending.length > 0) {
        try {
          const result = await sendAlerts({
            alerts: pending,
            secrets,
            context: { config, language: config.alertas?.idioma ?? 'es-AR', storeNames, allowedHosts, ...(siteUrl === undefined ? {} : { siteUrl }) },
            fetch: telegramFetch,
            log,
            onSent: (ids) => {
              sent = newest([...sent, ...ids.map((id) => ({ id, at: stamp }))], MAX_SENT_ALERT_IDS);
              summary.sent += ids.length;
            },
            ...(maxMessages === undefined ? {} : { maxMessages }),
            ...(sleep === undefined ? {} : { sleep }),
            ...(clock === undefined ? {} : { now: clock }),
          });
          const left = new Set(result.pending);
          // Alerts dropped by the renderer (product removed) are in neither list: they are gone.
          pending = pending.filter((alert) => left.has(alert.id));
          if (result.unauthorized) channelBroken = true;
          else if (result.sent.length > 0) channelBroken = false;
        } catch {
          // Whatever was accepted before the failure is already in `sent`; the rest waits for the next run.
          log('::warning::cuotear: notify: sending failed unexpectedly; the alerts not sent stay pending');
          const done = new Set(sent.map((entry) => entry.id));
          pending = pending.filter((alert) => !done.has(alert.id));
        }
      }
      if (channelBroken) causes.push('secretos-canal');
    }
    summary.pending = pending.length;

    /** @type {import('../state/schema.js').OpsState} */
    const ops = { ...state.ops, channelBroken };
    if (!channelBroken) delete ops.channelBroken;

    try {
      const inactivity = await checkInactivity({ now, log, ...(lastCommitDate === undefined ? {} : { lastCommitDate }) });
      summary.inactivityDays = inactivity.days;
      if (inactivity.cause !== null) causes.push(inactivity.cause);

      const availability = await computeAvailability({ repo, token: githubToken, fetch: githubFetch, now, log, ...(cronStart === undefined ? {} : { since: cronStart }) });
      summary.availability = availability.value;
      if (availability.cause !== null) causes.push(availability.cause);
      if (commitConflict) causes.push('commit-conflicto');

      const all = [...new Set(causes)].filter(isValidCause).sort();
      summary.causes = all;
      // Only validated keys reach a log line: a workflow command cannot be injected through the state.
      for (const cause of all) {
        if (NOTIFY_CAUSES.includes(/** @type {never} */ (cause)) || cause.startsWith('config-')) log(`::error::cuotear: aviso ${cause}`);
      }
      ops.lastCauses = all;
      if (availability.value !== null) ops.availability = { value: availability.value, at: stamp };
      await reconcileOpsIssues({
        causes: all,
        repo,
        token: githubToken,
        fetch: githubFetch,
        now,
        log,
        ...(runUrl === undefined ? {} : { runUrl }),
        ...(measuredStores === undefined ? {} : { measuredStores }),
      });
    } catch {
      // The notices are best effort: the alerts already sent stay recorded.
      log('::warning::cuotear: notify: the operational notices could not be computed; they are retried on the next run');
    }
    return { state: { ...state, pendingAlerts: pending, sentAlertIds: sent, ops }, summary };
  } catch {
    // A bug in this step must not fail the run (RNF-15); what was sent stays recorded, the rest waits.
    log('::warning::cuotear: notify: unexpected error; alerts stay pending for the next run');
    return keepWhatWentOut();
  }
}

/**
 * @param {NotifyOutcome['summary']} summary
 * @returns {string} markdown rows for `$GITHUB_STEP_SUMMARY`
 */
export function notifySummaryMarkdown(summary) {
  return [
    '### Notifications',
    '',
    `- Alerts: ${summary.sent} sent, ${summary.pending} pending, ${summary.discarded} discarded`,
    `- Availability (30 days): ${summary.availability === null ? 'unknown' : `${summary.availability.toFixed(1)} %`}`,
    `- Days since the last commit on main: ${summary.inactivityDays ?? 'unknown'}`,
    `- Operational notices: ${summary.causes.length === 0 ? 'none' : summary.causes.map((cause) => `\`${cause}\``).join(', ')}`,
    '',
  ].join('\n');
}
