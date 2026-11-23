import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { selectConfig } from '../pipeline/config-source.js';
import { notifySummaryMarkdown, runNotify } from '../notify/notify.js';
import { loadState, saveState, STATE_PATH } from '../state/store.js';
import { stores } from '../stores/index.js';

/**
 * `node src/cli/notify.js [--dry-run] [--config <file>] [--state <file>]`
 *
 * Step 12 of a run (DRT 11), after `run.js` and `commit.js`: sends the pending
 * alerts through Telegram, computes availability and inactivity, reconciles the
 * `cuotear-ops` issues and updates `pendingAlerts`, `sentAlertIds` and `ops` in
 * the state. Secrets come from the environment (`TELEGRAM_BOT_TOKEN`,
 * `TELEGRAM_CHAT_ID`, `GITHUB_TOKEN`), only in this step.
 *
 * Exit code 0 always: a failed notice never fails the run (RNF-15). An
 * unexpected internal error is logged as a warning and the state is untouched.
 * @param {string[]} argv
 * @returns {Promise<void>}
 */
async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { 'dry-run': { type: 'boolean', default: false }, config: { type: 'string' }, state: { type: 'string' } },
  });
  const statePath = values.state ?? STATE_PATH;
  const dryRun = values['dry-run'];
  const env = process.env;

  const loaded = loadState(statePath);
  const choice = selectConfig({ configPath: values.config ?? 'config/cuotear.yaml', state: loaded.state, registry: stores });
  const config = choice.kind === 'none' ? null : choice.config;
  const extraCauses = choice.kind === 'none' ? ['config-ausente'] : choice.kind === 'fallback' ? ['config-invalida'] : [];

  const repo = env.GITHUB_REPOSITORY ?? '';
  const [owner = '', name = ''] = repo.split('/');
  const siteUrl = env.CUOTEAR_SITE_URL ?? (owner === '' || name === '' ? undefined : `https://${owner.toLowerCase()}.github.io/${name}/`);
  const runId = env.GITHUB_RUN_ID ?? '';
  const cronStart = env.CUOTEAR_CRON_START === undefined ? undefined : new Date(env.CUOTEAR_CRON_START);

  const outcome = await runNotify({
    state: loaded.state,
    config,
    extraCauses,
    storeNames: Object.fromEntries(stores.map((store) => [store.id, store.displayName])),
    now: new Date(),
    dryRun,
    deps: {
      env,
      ...(env.GITHUB_TOKEN === undefined || env.GITHUB_TOKEN === '' ? {} : { githubToken: env.GITHUB_TOKEN }),
      repo,
      ...(repo === '' || !/^\d{1,20}$/.test(runId) ? {} : { runUrl: `https://github.com/${repo}/actions/runs/${runId}` }),
      ...(siteUrl === undefined ? {} : { siteUrl }),
      ...(cronStart === undefined || Number.isNaN(cronStart.getTime()) ? {} : { cronStart }),
      commitConflict: loaded.state.ops.commitConflict === true,
    },
  });

  // A lost state is not recreated here: with no run before it there is nothing to keep.
  if (!dryRun && !loaded.rebuilt) saveState(outcome.state, statePath);
  const summaryFile = env.GITHUB_STEP_SUMMARY;
  if (summaryFile !== undefined && summaryFile !== '') appendFileSync(summaryFile, notifySummaryMarkdown(outcome.summary));
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  // No stack and no message: they could carry request details.
  console.log(`::warning::cuotear: notify: unexpected internal error (${error instanceof Error ? error.name : 'Error'}); nothing was changed`);
}
