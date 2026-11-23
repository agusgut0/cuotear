import { execFile } from 'node:child_process';
import { commitHistory } from '../git/commit-history.js';
import { loadState, saveState } from '../state/store.js';

/**
 * `node src/cli/commit.js`: commits and pushes `data/history/` when it changed.
 * The branch comes from GITHUB_REF_NAME (default `main`). When GITHUB_TOKEN is
 * set it authenticates the network commands through `http.extraheader`, set via
 * GIT_CONFIG_* environment variables (never argv), for this process only (the checkout keeps no credentials, DRT 8.3). The token is
 * never printed. Exit code 0 even when the push cannot be done (a warning is
 * emitted); non-zero only when git itself fails unexpectedly.
 */

const token = process.env.GITHUB_TOKEN;
const encoded = token === undefined || token === '' ? '' : Buffer.from(`x-access-token:${token}`).toString('base64');
if (encoded !== '') console.log(`::add-mask::${encoded}`);
// The credential travels in git's environment config, not in argv (visible to other processes).
const authEnv = encoded === ''
  ? {}
  : { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${encoded}` };

/** @type {import('../git/commit-history.js').GitRunner} */
const git = (args) =>
  new Promise((resolve) => {
    const network = ['push', 'fetch'].includes(args[0] ?? '');
    execFile('git', args, { maxBuffer: 10 * 1024 * 1024, env: network ? { ...process.env, ...authEnv } : process.env }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
      resolve({ code, stdout, stderr: network ? '' : stderr });
    });
  });

try {
  const outcome = await commitHistory({ git, branch: process.env.GITHUB_REF_NAME ?? 'main' });
  // Tells the notify step (cause `commit-conflicto`, DRT 11 step 11) through the run state.
  const loaded = loadState();
  if (!loaded.rebuilt) saveState({ ...loaded.state, ops: { ...loaded.state.ops, commitConflict: outcome.status === 'unpushed' } });
} catch (error) {
  console.error(`::error::cuotear: unexpected git error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
