/**
 * Minimal GitHub REST client shared by the notify modules (DRT 13.6, 18.3).
 * Only `https://api.github.com` is ever contacted. The token goes in the
 * Authorization header and nowhere else: it is never part of a URL, an error
 * message or a log line. Failures never throw; they return `ok: false`.
 *
 * @typedef {typeof fetch} FetchFn
 * @typedef {{ ok: boolean, status: number, data: unknown }} ApiResult
 */

export const API_BASE = 'https://api.github.com';
export const REQUEST_TIMEOUT_MS = 10_000;
// owner/name; a segment made only of dots ("." or "..") is refused.
const REPO_PATTERN = /^(?!\.{1,2}\/)[A-Za-z0-9_.-]{1,100}\/(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/;

/**
 * @param {unknown} repo
 * @returns {repo is string}
 */
export const isValidRepo = (repo) => typeof repo === 'string' && REPO_PATTERN.test(repo);

/**
 * @param {{ fetch: FetchFn, token: string, timeoutMs?: number }} input
 * @returns {(method: string, path: string, body?: unknown) => Promise<ApiResult>}
 */
export function createApi({ fetch: fetchFn, token, timeoutMs = REQUEST_TIMEOUT_MS }) {
  return async (method, path, body) => {
    try {
      const response = await fetchFn(`${API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'cuotear',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      /** @type {unknown} */
      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      return { ok: response.ok, status: response.status, data };
    } catch (error) {
      // Only the error name: a message could echo request details.
      const name = error instanceof Error ? error.name : 'Error';
      return { ok: false, status: 0, data: { error: name } };
    }
  };
}
