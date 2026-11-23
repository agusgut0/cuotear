/**
 * Scripted fake of `fetch` for the GitHub REST API: no network. Handlers are
 * matched by `METHOD path-prefix` in order; every call is recorded.
 *
 * @typedef {{ status?: number, json?: unknown, throws?: Error }} Reply
 * @typedef {{ method: string, url: string, path: string, headers: Record<string, string>, body: any }} Call
 */

/**
 * @param {Record<string, Reply | ((call: Call) => Reply)>} routes key: `METHOD /path-prefix`
 * @returns {{ fetch: typeof fetch, calls: Call[] }}
 */
export function fakeGithub(routes) {
  /** @type {Call[]} */
  const calls = [];
  /** @type {typeof fetch} */
  const fakeFetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const path = url.replace('https://api.github.com', '');
    /** @type {Call} */
    const call = {
      method,
      url,
      path,
      headers: /** @type {Record<string, string>} */ (init?.headers ?? {}),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const key = Object.keys(routes).find((candidate) => `${method} ${path}`.startsWith(candidate));
    const route = key === undefined ? { status: 404, json: {} } : routes[key];
    const reply = typeof route === 'function' ? route(call) : route;
    if (reply?.throws !== undefined) throw reply.throws;
    const status = reply?.status ?? 200;
    return new Response(JSON.stringify(reply?.json ?? {}), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: fakeFetch, calls };
}
