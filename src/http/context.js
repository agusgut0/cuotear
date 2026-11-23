import { createFetchContext } from './client.js';

/** Non-store hosts the project talks to (DRT 5): BCRA, Telegram and the GitHub API. */
export const SERVICE_HOSTS = Object.freeze(['api.bcra.gob.ar', 'api.telegram.org', 'api.github.com']);

/**
 * Builds the FetchContext for a run: the allowlist is the union of the store
 * registry hosts and the service hosts; robots.txt applies to the stores only.
 * @param {readonly { hosts: string[] }[]} registry
 * @param {Omit<import('./client.js').ClientOptions, 'allowedHosts' | 'robotsHosts'>} [options]
 * @returns {import('./client.js').FetchContext}
 */
export function createStoreFetchContext(registry, options = {}) {
  const storeHosts = registry.flatMap((store) => store.hosts);
  return createFetchContext({ ...options, allowedHosts: [...storeHosts, ...SERVICE_HOSTS], robotsHosts: storeHosts });
}
