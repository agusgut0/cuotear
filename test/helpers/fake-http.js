/**
 * Test doubles for the HTTP layer: a scripted fake fetch and a fake clock.
 * No test touches the network.
 */

/**
 * @typedef {{ status?: number, body?: string, headers?: Record<string, string>, delayUntilAbort?: boolean, throws?: boolean }} FakeReply
 * @typedef {{ url: string, headers: Record<string, string>, at: number }} FakeCall
 */

/**
 * Fake clock: `sleep` advances time instantly.
 * @param {number} [start]
 */
export function fakeClock(start = Date.parse('2026-11-22T12:00:00Z')) {
  let current = start;
  return {
    now: () => current,
    /** @param {number} ms */
    sleep: async (ms) => {
      current += ms;
    },
    /** @param {number} ms */
    advance: (ms) => {
      current += ms;
    },
  };
}

/**
 * Scripted fetch. `routes` maps a URL to one reply or to a list of replies served in order (the last repeats).
 * @param {Record<string, FakeReply | FakeReply[]>} routes
 * @param {() => number} [now]
 */
export function fakeFetch(routes, now = () => 0) {
  /** @type {FakeCall[]} */
  const calls = [];
  /** @type {Map<string, number>} */
  const served = new Map();

  /** @type {typeof fetch} */
  const impl = async (input, init) => {
    const url = String(input);
    const headers = /** @type {Record<string, string>} */ (init?.headers ?? {});
    calls.push({ url, headers, at: now() });
    const entry = routes[url];
    if (entry === undefined) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    const list = Array.isArray(entry) ? entry : [entry];
    const index = Math.min(served.get(url) ?? 0, list.length - 1);
    served.set(url, (served.get(url) ?? 0) + 1);
    const reply = /** @type {FakeReply} */ (list[index]);
    if (reply.throws) throw new TypeError('fetch failed');
    if (reply.delayUntilAbort) {
      await new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    return new Response(reply.body ?? '', { status: reply.status ?? 200, headers: reply.headers ?? { 'content-type': 'text/plain' } });
  };
  return { impl, calls };
}

export const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
export const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8' };
