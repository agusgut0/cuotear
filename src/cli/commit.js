import { execFile } from 'node:child_process';
import { commitHistory } from '../git/commit-history.js';

/**
 * `node src/cli/commit.js`: commits and pushes `data/history/` when it changed.
 * The branch comes from GITHUB_REF_NAME (default `main`). When GITHUB_TOKEN is
 * set it authenticates the network commands through `http.extraheader` for
 * this process only (the checkout keeps no credentials, DRT 8.3). The token is
 * never printed. Exit code 0 even when the push cannot be done (a warning is
 * emitted); non-zero only when git itself fails unexpectedly.
 */

const token = process.env.GITHUB_TOKEN;
const authArgs = token === undefined || token === '' ? [] : ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`];

/** @type {import('../git/commit-history.js').GitRunner} */
const git = (args) =>
  new Promise((resolve) => {
    const network = ['push', 'fetch'].includes(args[0] ?? '');
    execFile('git', [...(network ? authArgs : []), ...args], { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
      resolve({ code, stdout, stderr: network ? '' : stderr });
    });
  });

try {
  await commitHistory({ git, branch: process.env.GITHUB_REF_NAME ?? 'main' });
} catch (error) {
  console.error(`::error::cuotear: unexpected git error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
