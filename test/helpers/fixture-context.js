/**
 * A FetchContext that serves canned results instead of using the network, for
 * contract tests and for deriving `expected.json` skeletons.
 *
 * @typedef {import('../../src/http/client.js').HttpResult} HttpResult
 */

/**
 * @param {string} body
 * @returns {HttpResult}
 */
export function jsonOk(body) {
  return { ok: true, kind: 'json', status: 200, body, contentType: 'application/json', ms: 1, requests: 1 };
}

/**
 * @param {string} body
 * @returns {HttpResult}
 */
export function htmlOk(body) {
  return { ok: true, kind: 'html', status: 200, body, contentType: 'text/html', ms: 1, requests: 1 };
}

/**
 * @param {import('../../src/http/client.js').FailureKind} kind
 * @param {number} [status]
 * @returns {HttpResult}
 */
export function failure(kind, status) {
  return { ok: false, kind, ...(status === undefined ? {} : { status }), detail: `${kind} (test)`, host: 'www.oncity.com', requests: 1 };
}

/**
 * @param {HttpResult | ((url: string) => HttpResult)} reply
 * @returns {{ ctx: import('../../src/http/client.js').FetchContext, urls: string[] }}
 */
export function fixtureContext(reply) {
  /** @type {string[]} */
  const urls = [];
  return {
    urls,
    ctx: {
      get: async (url) => {
        urls.push(url);
        return typeof reply === 'function' ? reply(url) : reply;
      },
      robotsSnapshot: () => ({}),
      requestCount: () => urls.length,
    },
  };
}
