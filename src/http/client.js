import { classifyResponse } from './classify.js';
import { DISALLOW_ALL, isAllowed, parseRobots } from './robots.js';
import { buildUserAgent } from './user-agent.js';

/**
 * Single HTTP client of the project (DRT 5, RNF-07, RNF-12, ADR-0007).
 *
 * Controls: exact host allowlist (https only, no IP literals, no ports),
 * robots.txt (RFC 9309) checked at run time before EVERY request, at least
 * `minIntervalMs` between requests to the same host, a timeout per request, a
 * response size cap, manual redirects limited to the same allowed host, and a
 * single retry for temporary errors. There is no evasion: blocks and
 * challenges are classified and never retried.
 *
 * Everything downloaded is untrusted data. The client returns text and never
 * evaluates, follows links in, or stores it.
 *
 * @typedef {'json'|'html'} OkKind
 * @typedef {'blocked'|'captcha'|'not_found'|'http'|'timeout'|'network'|'too_large'|'robots'|'redirect'} FailureKind
 * @typedef {{ ok: true, kind: OkKind, status: number, body: string, contentType: string, ms: number, requests: number }} HttpOk
 * @typedef {{ ok: false, kind: FailureKind, status?: number, detail: string, host: string, requests: number }} HttpFailure
 * @typedef {HttpOk | HttpFailure} HttpResult
 *
 * @typedef {{ fetchedAt: string, status: number, rules: import('./robots.js').RobotsRule[] }} RobotsEntry
 *
 * @typedef {Object} FetchContext
 * @property {(url: string, options?: { accept?: string }) => Promise<HttpResult>} get
 * @property {() => Record<string, RobotsEntry>} robotsSnapshot robots.txt copies to persist in the run state
 * @property {() => number} requestCount network requests made so far, robots.txt included
 *
 * @typedef {Object} ClientOptions
 * @property {string[]} allowedHosts exact lowercase hosts
 * @property {string[]} [robotsHosts] hosts under robots.txt control (default: all allowed hosts)
 * @property {typeof fetch} [fetchImpl]
 * @property {() => number} [now] clock in ms
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {string} [userAgent]
 * @property {Record<string, RobotsEntry>} [robots] persisted robots.txt copies
 * @property {number} [minIntervalMs]
 * @property {number} [timeoutMs]
 * @property {number} [maxBytes]
 * @property {number} [retryDelayMs]
 * @property {number} [maxRedirects]
 * @property {(message: string) => void} [log]
 */

export const DEFAULTS = Object.freeze({
  minIntervalMs: 1000,
  timeoutMs: 30_000,
  maxBytes: 3 * 1024 * 1024,
  retryDelayMs: 5000,
  maxRedirects: 3,
  robotsTtlMs: 24 * 3600 * 1000,
  robotsStaleMs: 7 * 24 * 3600 * 1000,
  maxRetryAfterMs: 30_000,
});

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Thrown for a URL that must not be requested at all (a bug: URLs are validated in the configuration). */
export class HostNotAllowedError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'HostNotAllowedError';
  }
}

/** @param {number} ms */
const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @typedef {{ type: 'response', status: number, headers: Headers, text: string, bytes: number }
 *   | { type: 'error', kind: 'timeout'|'network'|'too_large' }
 *   | { type: 'refused', failure: Omit<HttpFailure, 'ok' | 'requests'> }} RawResult
 */

/**
 * @param {ClientOptions} options
 * @returns {FetchContext}
 */
export function createFetchContext(options) {
  const allowed = new Set(options.allowedHosts.map((host) => host.toLowerCase()));
  const robotsHosts = new Set((options.robotsHosts ?? options.allowedHosts).map((host) => host.toLowerCase()));
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;
  const log = options.log ?? (() => {});
  const userAgent = options.userAgent ?? buildUserAgent();
  const minIntervalMs = options.minIntervalMs ?? DEFAULTS.minIntervalMs;
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
  const retryDelayMs = options.retryDelayMs ?? DEFAULTS.retryDelayMs;
  const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;

  let requests = 0;
  /** @type {Map<string, number>} */
  const lastStart = new Map();
  /** @type {Map<string, Promise<void>>} */
  const queueTail = new Map();
  /** @type {Map<string, RobotsEntry>} */
  const robotsStore = new Map(Object.entries(options.robots ?? {}).filter(([, entry]) => isRobotsEntry(entry)));
  /** @type {Map<string, Promise<readonly import('./robots.js').RobotsRule[]>>} */
  const robotsRun = new Map();

  /**
   * Serializes requests per host and spaces their starts by `minIntervalMs`.
   * @param {string} host
   */
  async function throttle(host) {
    const previous = queueTail.get(host) ?? Promise.resolve();
    /** @type {() => void} */
    let release = () => {};
    queueTail.set(
      host,
      previous.then(
        () =>
          new Promise((resolve) => {
            release = () => resolve(undefined);
          }),
      ),
    );
    await previous;
    try {
      const last = lastStart.get(host);
      if (last !== undefined) {
        const wait = last + minIntervalMs - now();
        if (wait > 0) await sleep(wait);
      }
      lastStart.set(host, now());
    } finally {
      release();
    }
  }

  /**
   * Validates a URL against the allowlist. Throws without touching the network.
   * @param {string} raw
   * @returns {URL}
   */
  function checkTarget(raw) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new HostNotAllowedError('invalid URL');
    }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:') throw new HostNotAllowedError(`only https is allowed (${host})`);
    if (url.username !== '' || url.password !== '' || url.port !== '') throw new HostNotAllowedError(`credentials and ports are not allowed (${host})`);
    if (/^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) throw new HostNotAllowedError('IP literals are not allowed');
    if (!allowed.has(host)) throw new HostNotAllowedError(`host not in the allowlist: ${host}`);
    return url;
  }

  /**
   * One network request, with timeout and body cap. Never throws.
   * @param {URL} url
   * @param {string} accept
   * @returns {Promise<RawResult>}
   */
  async function fetchOnce(url, accept) {
    await throttle(url.hostname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    requests += 1;
    try {
      const response = await fetchImpl(url.href, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'user-agent': userAgent, accept, 'accept-language': 'es-AR' },
        signal: controller.signal,
      });
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel().catch(() => {});
        return { type: 'error', kind: 'too_large' };
      }
      const body = await readCapped(response, maxBytes);
      if (body === null) return { type: 'error', kind: 'too_large' };
      return { type: 'response', status: response.status, headers: response.headers, text: body.text, bytes: body.bytes };
    } catch {
      return { type: 'error', kind: controller.signal.aborted ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Follows same-host redirects manually; each hop is checked against robots.txt.
   * @param {URL} first
   * @param {string} accept
   * @param {boolean} enforceRobots
   * @returns {Promise<RawResult>}
   */
  async function requestFollowing(first, accept, enforceRobots) {
    let url = first;
    for (let hop = 0; ; hop += 1) {
      if (enforceRobots) {
        const refusal = await robotsRefusal(url);
        if (refusal) return { type: 'refused', failure: refusal };
      }
      const raw = await fetchOnce(url, accept);
      if (raw.type !== 'response' || !REDIRECTS.has(raw.status)) return raw;

      const location = raw.headers.get('location');
      /** @type {URL | null} */
      let next = null;
      try {
        if (location !== null) next = checkTarget(new URL(location, url).href);
      } catch {
        next = null;
      }
      if (next === null || next.hostname !== first.hostname || hop >= maxRedirects) {
        return { type: 'refused', failure: { kind: 'redirect', detail: 'redirect to a disallowed target or too many redirects', host: first.hostname } };
      }
      url = next;
    }
  }

  /**
   * @param {RawResult} raw
   * @returns {number | null} ms to wait before the retry, or null when no retry applies
   */
  function retryDelay(raw) {
    if (raw.type === 'error') return raw.kind === 'too_large' ? null : retryDelayMs;
    if (raw.type === 'refused') return null;
    if (raw.status === 429) {
      const seconds = Number(raw.headers.get('retry-after'));
      return raw.headers.has('retry-after') && Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, DEFAULTS.maxRetryAfterMs) : retryDelayMs;
    }
    if (raw.status >= 500) {
      const kind = classifyResponse({ status: raw.status, contentType: raw.headers.get('content-type') ?? '', text: raw.text, bytes: raw.bytes });
      return kind === 'blocked' || kind === 'captcha' ? null : retryDelayMs;
    }
    return null;
  }

  /**
   * Request with the single retry for temporary errors (DRT 5, R-01). Blocks
   * (401/403/451, challenges) are never retried.
   * @param {URL} url
   * @param {string} accept
   * @param {boolean} enforceRobots
   * @returns {Promise<RawResult>}
   */
  async function requestWithRetry(url, accept, enforceRobots) {
    const first = await requestFollowing(url, accept, enforceRobots);
    const delay = retryDelay(first);
    if (delay === null) return first;
    await sleep(delay);
    return requestFollowing(url, accept, enforceRobots);
  }

  /**
   * Returns a failure when robots.txt forbids the URL (no request is made).
   * @param {URL} url
   * @returns {Promise<Omit<HttpFailure, 'ok' | 'requests'> | null>}
   */
  async function robotsRefusal(url) {
    const host = url.hostname;
    if (!robotsHosts.has(host) || url.pathname === '/robots.txt') return null;
    const rules = await robotsRules(host);
    if (isAllowed(rules, url.pathname + url.search)) return null;
    return { kind: 'robots', detail: `robots.txt of ${host} disallows ${url.pathname}`, host };
  }

  /**
   * robots.txt rules for a host: one download per host per run, and at most one per 24 h across runs (DRT 5.1).
   * @param {string} host
   * @returns {Promise<readonly import('./robots.js').RobotsRule[]>}
   */
  function robotsRules(host) {
    let pending = robotsRun.get(host);
    if (!pending) {
      pending = loadRobots(host);
      robotsRun.set(host, pending);
    }
    return pending;
  }

  /**
   * @param {string} host
   * @returns {Promise<readonly import('./robots.js').RobotsRule[]>}
   */
  async function loadRobots(host) {
    const cached = robotsStore.get(host);
    const age = cached ? now() - Date.parse(cached.fetchedAt) : Infinity;
    if (cached && age >= 0 && age < DEFAULTS.robotsTtlMs) return cached.rules;

    const raw = await requestWithRetry(new URL(`https://${host}/robots.txt`), 'text/plain', false);
    if (raw.type === 'response' && raw.status >= 200 && raw.status < 300) {
      const rules = parseRobots(raw.text);
      robotsStore.set(host, { fetchedAt: new Date(now()).toISOString(), status: raw.status, rules });
      return rules;
    }
    if (raw.type === 'response' && raw.status >= 400 && raw.status < 500 && raw.status !== 429) {
      robotsStore.set(host, { fetchedAt: new Date(now()).toISOString(), status: raw.status, rules: [] });
      return [];
    }
    // Server error, unreachable, too large or rate limited: use a copy of at most 7 days, else forbid everything this run.
    if (cached && age >= 0 && age <= DEFAULTS.robotsStaleMs) {
      log(`robots.txt of ${host} is unavailable; using the cached copy`);
      return cached.rules;
    }
    log(`robots.txt of ${host} is unavailable and there is no usable copy; treating everything as disallowed`);
    return DISALLOW_ALL;
  }

  return {
    requestCount: () => requests,
    robotsSnapshot: () => Object.fromEntries(robotsStore),
    async get(rawUrl, { accept = 'application/json, text/html;q=0.8' } = {}) {
      const url = checkTarget(rawUrl);
      const host = url.hostname;
      const startedRequests = requests;
      const started = now();
      const raw = await requestWithRetry(url, accept, true);
      const used = requests - startedRequests;
      /**
       * @param {Omit<HttpFailure, 'ok' | 'requests' | 'host'>} failure
       * @returns {HttpFailure}
       */
      const fail = (failure) => ({ ok: false, host, requests: used, ...failure });

      if (raw.type === 'refused') return { ok: false, ...raw.failure, requests: used };
      if (raw.type === 'error') {
        return fail({ kind: raw.kind, detail: raw.kind === 'too_large' ? `response over ${maxBytes} bytes` : `request failed (${raw.kind})` });
      }

      const contentType = raw.headers.get('content-type') ?? '';
      const kind = classifyResponse({ status: raw.status, contentType, text: raw.text, bytes: raw.bytes });
      if (kind === 'json' || kind === 'html') {
        if (raw.status < 200 || raw.status >= 300) return fail({ kind: 'http', status: raw.status, detail: `unexpected HTTP ${raw.status}` });
        return { ok: true, kind, status: raw.status, body: raw.text, contentType, ms: now() - started, requests: used };
      }
      return fail({ kind, status: raw.status, detail: kind === 'http' ? `HTTP ${raw.status}` : `${kind} (HTTP ${raw.status})` });
    },
  };
}

/**
 * Reads a response body as UTF-8 text without exceeding `maxBytes`.
 * @param {Response} response
 * @param {number} maxBytes
 * @returns {Promise<{ text: string, bytes: number } | null>} null when the body is too large
 */
async function readCapped(response, maxBytes) {
  if (response.body === null) return { text: '', bytes: 0 };
  const reader = response.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder('utf-8').decode(joined), bytes: total };
}

/**
 * @param {unknown} entry
 * @returns {boolean}
 */
function isRobotsEntry(entry) {
  if (typeof entry !== 'object' || entry === null) return false;
  const { fetchedAt, status, rules } = /** @type {Record<string, unknown>} */ (entry);
  return (
    typeof fetchedAt === 'string' &&
    Number.isFinite(Date.parse(fetchedAt)) &&
    typeof status === 'number' &&
    Array.isArray(rules) &&
    rules.every((rule) => typeof rule === 'object' && rule !== null && typeof rule.allow === 'boolean' && typeof rule.pattern === 'string')
  );
}
