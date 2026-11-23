import { computeAvailability } from './availability.js';
import { checkInactivity } from './inactivity.js';
import { reconcileOpsIssues } from './ops-issues.js';
import { isAlert, readSecrets, sendAlerts } from './telegram.js';
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
 * - An id is marked as sent only after Telegram accepted the message.
 * - `canal: ninguno`: nothing is sent, nothing is kept and no notice is raised.
 * - `dryRun`: no message, no issue, the state is returned untouched.
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

/**
 * @param {import('../state/schema.js').RunState} state
 * @param {Date} now
 * @param {(line: string) => void} log
 * @returns {{ sentIds: Set<string>, sent: import('../state/schema.js').RunState['sentAlertIds'], pending: import('../core/alerts.js').Alert[], discarded: number }}
 */
function prepareAlerts(state, now, log) {
  const sent = state.sentAlertIds.filter((entry) => now.getTime() - Date.parse(entry.at) <= SENT_RETENTION_MS);
  const sentIds = new Set(sent.map((entry) => entry.id));
  /** @type {import('../core/alerts.js').Alert[]} */
  const pending = [];
  const seen = new Set(sentIds);
  let discarded = 0;
  for (const candidate of state.pendingAlerts) {
    if (!isAlert(candidate)) {
      log('[cuotear] notify: a pending alert is malformed; dropped');
      discarded += 1;
      continue;
    }
    if (seen.has(candidate.id)) continue;
    const age = now.getTime() - Date.parse(candidate.detectedAt);
    if (!(age <= PENDING_MAX_AGE_MS)) {
      log(`[cuotear] notify: alert ${candidate.id.slice(0, 12)} for ${candidate.productId} is older than 48 h and was not delivered; discarded`);
      discarded += 1;
      continue;
    }
    seen.add(candidate.id);
    pending.push(candidate);
  }
  return { sentIds, sent, pending, discarded };
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
  } = deps;
  const summary = { sent: 0, pending: 0, discarded: 0, causes: /** @type {string[]} */ ([]), availability: /** @type {number | null} */ (null), inactivityDays: /** @type {number | null} */ (null) };

  try {
    if (dryRun) {
      log(`[cuotear] notify: dry run, nothing is sent and no issue is touched (${state.pendingAlerts.length} alert(s) waiting)`);
      return { state, summary: { ...summary, pending: state.pendingAlerts.length, causes: [...state.ops.lastCauses, ...extraCauses] } };
    }

    const prepared = prepareAlerts(state, now, log);
    summary.discarded = prepared.discarded;
    const channel = config?.alertas?.canal ?? 'telegram';
    let { pending } = prepared;
    let { sent } = prepared;
    let channelBroken = state.ops.channelBroken === true;
    /** @type {string[]} */
    // The run step owns `lastCauses`; the causes this step adds are recomputed, never inherited (an idempotent re-run).
    const causes = [...state.ops.lastCauses.filter((cause) => !NOTIFY_OWNED.has(cause)), ...extraCauses];

    if (config === null || channel === 'ninguno') {
      // No channel (or no configuration): there is nobody to notify and no notice for it.
      if (channel === 'ninguno') pending = [];
    } else {
      const secrets = readSecrets(env);
      if (secrets === null) {
        log('[cuotear] notify: the Telegram secrets are missing or malformed; no alert is sent');
        causes.push('secretos-canal');
      } else if (pending.length > 0) {
        const result = await sendAlerts({
          alerts: pending,
          secrets,
          context: { config, language: config.alertas?.idioma ?? 'es-AR', storeNames, allowedHosts, ...(siteUrl === undefined ? {} : { siteUrl }) },
          fetch: telegramFetch,
          log,
          ...(sleep === undefined ? {} : { sleep }),
          ...(clock === undefined ? {} : { now: clock }),
        });
        const at = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
        sent = [...sent, ...result.sent.map((id) => ({ id, at }))];
        const left = new Set(result.pending);
        // Alerts dropped by the renderer (product removed) are in neither list: they are gone.
        pending = pending.filter((alert) => left.has(alert.id));
        if (result.unauthorized) channelBroken = true;
        else if (result.sent.length > 0) channelBroken = false;
        summary.sent = result.sent.length;
      }
      if (channelBroken) causes.push('secretos-canal');
    }
    summary.pending = pending.length;

    const inactivity = await checkInactivity({ now, log, ...(lastCommitDate === undefined ? {} : { lastCommitDate }) });
    summary.inactivityDays = inactivity.days;
    if (inactivity.cause !== null) causes.push(inactivity.cause);

    const availability = await computeAvailability({ repo, token: githubToken, fetch: githubFetch, now, log, ...(cronStart === undefined ? {} : { since: cronStart }) });
    summary.availability = availability.value;
    if (availability.cause !== null) causes.push(availability.cause);
    if (commitConflict) causes.push('commit-conflicto');

    const all = [...new Set(causes)].sort();
    summary.causes = all;
    for (const cause of all) {
      if (NOTIFY_CAUSES.includes(/** @type {never} */ (cause)) || cause.startsWith('config-')) log(`::error::cuotear: aviso ${cause}`);
    }
    await reconcileOpsIssues({
      causes: all,
      repo,
      token: githubToken,
      fetch: githubFetch,
      now,
      log,
      ...(runUrl === undefined ? {} : { runUrl }),
      ...(state.ops.measuredStores === undefined ? {} : { measuredStores: state.ops.measuredStores }),
    });

    /** @type {import('../state/schema.js').OpsState} */
    const ops = { ...state.ops, lastCauses: all, channelBroken, ...(availability.value === null ? {} : { availability: { value: availability.value, at: now.toISOString().replace(/\.\d{3}Z$/, 'Z') } }) };
    if (!channelBroken) delete ops.channelBroken;
    return { state: { ...state, pendingAlerts: pending, sentAlertIds: sent, ops }, summary };
  } catch {
    // A bug in this step must not fail the run (RNF-15); the state is kept as it was.
    log('::warning::cuotear: notify: unexpected error; alerts stay pending for the next run');
    return { state, summary };
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
