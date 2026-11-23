import { readFileSync } from 'node:fs';

const DEFAULT_REPO_URL = 'https://github.com/agusgut0/cuotear';

/**
 * Builds the identifiable User-Agent (DRT 5, RNF-07):
 * `cuotear/<version> (personal price monitor; +<repo url>)`. No browser
 * impersonation.
 * @param {{ env?: Record<string, string|undefined>, version?: string }} [options]
 * @returns {string}
 */
export function buildUserAgent({ env = process.env, version } = {}) {
  const resolved = version ?? /** @type {{ version: string }} */ (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))).version;
  const server = env.GITHUB_SERVER_URL;
  const repository = env.GITHUB_REPOSITORY;
  const repoUrl = server && repository && /^https:\/\/[\w.-]+$/.test(server) && /^[\w.-]+\/[\w.-]+$/.test(repository) ? `${server}/${repository}` : DEFAULT_REPO_URL;
  return `cuotear/${resolved} (personal price monitor; +${repoUrl})`;
}
