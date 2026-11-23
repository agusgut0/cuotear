/**
 * History commit (DRT 8.3, 10, 11 step 10): stages ONLY `data/history/`,
 * makes at most one commit per run and only when the history changed, and
 * pushes with up to three fetch + rebase + push attempts. A conflict or an
 * exhausted retry is never an error of the run: it ends with a warning (the
 * next run recomputes the same change from the repository history). The
 * operational notice for this cause arrives with DRT F4.
 *
 * Git is reached through an injected runner so the logic is testable without
 * a repository.
 *
 * @typedef {{ code: number, stdout: string, stderr: string }} CommandResult
 * @typedef {(args: string[]) => Promise<CommandResult>} GitRunner
 * @typedef {{ status: 'no_changes' } | { status: 'committed', pushed: true, attempts: number } | { status: 'unpushed', reason: 'conflict' | 'push_failed' }} CommitOutcome
 */

export const HISTORY_PATHSPEC = 'data/history';
export const BOT_NAME = 'github-actions[bot]';
export const BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';
export const MAX_ATTEMPTS = 3;
export const RETRY_WAIT_MS = 5000;

/**
 * @param {Date} now
 * @returns {string} `2026-11-22 12:17 UTC`
 */
const stamp = (now) => `${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/**
 * @param {GitRunner} git
 * @param {string[]} args
 * @returns {Promise<string>} stdout; throws when git fails
 */
async function mustRun(git, args) {
  const result = await git(args);
  if (result.code !== 0) throw new Error(`git ${args[0]} failed with code ${result.code}`);
  return result.stdout;
}

/**
 * Added lines in the staged history diff: zero means only deletions (a purge).
 * @param {string} numstat
 * @returns {number}
 */
function addedLines(numstat) {
  return numstat
    .split('\n')
    .map((line) => Number.parseInt(line.split('\t')[0] ?? '', 10))
    .filter(Number.isFinite)
    .reduce((sum, count) => sum + count, 0);
}

/**
 * @param {{
 *   git: GitRunner,
 *   branch: string,
 *   now?: Date,
 *   sleep?: (ms: number) => Promise<void>,
 *   log?: (line: string) => void,
 * }} input
 * @returns {Promise<CommitOutcome>}
 */
export async function commitHistory({ git, branch, now = new Date(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), log = console.log }) {
  const status = await mustRun(git, ['status', '--porcelain', '--', HISTORY_PATHSPEC]);
  if (status.trim() === '') {
    log('[cuotear] commit: the history did not change; no commit');
    return { status: 'no_changes' };
  }

  await mustRun(git, ['add', '--', HISTORY_PATHSPEC]);
  const purgeOnly = addedLines(await mustRun(git, ['diff', '--cached', '--numstat', '--', HISTORY_PATHSPEC])) === 0;
  const message = `chore(data): ${purgeOnly ? 'purge price history' : 'record price changes'} (${stamp(now)})`;
  await mustRun(git, ['-c', `user.name=${BOT_NAME}`, '-c', `user.email=${BOT_EMAIL}`, 'commit', '-m', message]);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const pushed = await git(['push', 'origin', `HEAD:${branch}`]);
    if (pushed.code === 0) {
      log(`[cuotear] commit: ${message} (pushed, attempt ${attempt})`);
      return { status: 'committed', pushed: true, attempts: attempt };
    }
    if (attempt === MAX_ATTEMPTS) break;

    await sleep(RETRY_WAIT_MS);
    if ((await git(['fetch', 'origin', branch])).code !== 0) continue;
    if ((await git(['rebase', `origin/${branch}`])).code !== 0) {
      await git(['rebase', '--abort']);
      log(`::warning::cuotear: the history commit conflicts with ${branch} (data/history was edited by hand?); it was not pushed and the next run will recompute it`);
      return { status: 'unpushed', reason: 'conflict' };
    }
  }

  log(`::warning::cuotear: the history commit could not be pushed after ${MAX_ATTEMPTS} attempts; the next run will recompute it`);
  return { status: 'unpushed', reason: 'push_failed' };
}
