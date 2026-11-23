import { createTranslator } from '../i18n/index.js';
import { createFormatters } from '../site/format.js';
import { cardOfSerie, CONTADO } from '../core/series.js';

/**
 * Alert channel: Telegram Bot API over direct HTTP (DRT 13.5, ADR-0008).
 *
 * - Every variable text goes through `escapeTelegramHtml`; the only tags are
 *   `<b>`, `<i>` and `<a href>`, and a link is emitted only when it is `https`
 *   and its host is allowed. Nothing downloaded from a store reaches a
 *   message (RN-01): only configuration text, store names from the code,
 *   numbers and catalog sentences.
 * - The alerts of a run are grouped in messages of at most 3,800 characters,
 *   split only between alerts, sent in order and one at a time, at least
 *   1.1 s apart; a 429 is honoured once (`retry_after` up to 30 s).
 * - The token travels in the URL path, so no log line ever contains the URL,
 *   the request body or an error message: only fixed texts and a status code.
 *
 * @typedef {typeof fetch} FetchFn
 * @typedef {import('../core/alerts.js').Alert} Alert
 *
 * @typedef {Object} Secrets
 * @property {string} token
 * @property {string} chatId
 *
 * @typedef {'ok' | 'unauthorized' | 'pending'} SendStatus
 *
 * @typedef {Object} RenderContext
 * @property {import('../config/types.js').Config} config
 * @property {'es-AR' | 'en'} language
 * @property {Record<string, string>} storeNames store id -> display name (trusted, from the code)
 * @property {ReadonlySet<string>} allowedHosts hosts a store link may point to
 * @property {string} [siteUrl] public URL of the site (https); without it the detail link is omitted
 */

export const API_ORIGIN = 'https://api.telegram.org';
export const MAX_MESSAGE_CHARS = 3800;
export const MIN_INTERVAL_MS = 1100;
export const MAX_RETRY_AFTER_S = 30;
export const REQUEST_TIMEOUT_MS = 15_000;
/** Messages sent in one run at most; the rest of the alerts stay pending (a flood cannot hold the run). */
export const MAX_MESSAGES_PER_RUN = 10;
/** An alert id is a sha256 hex digest; the pattern is wider only to stay safe to log and to store. */
export const ALERT_ID_PATTERN = /^[A-Za-z0-9:_-]{1,100}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const MAX_NAME_CHARS = 120;
const TOKEN_PATTERN = /^\d{3,20}:[A-Za-z0-9_-]{20,100}$/;
const CHAT_PATTERN = /^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/;
const PRODUCT_ID = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/**
 * Escapes text for Telegram's HTML parse mode (and for `href` attributes).
 * @param {unknown} text
 * @returns {string}
 */
export const escapeTelegramHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The channel secrets from an injected environment, or null when one is
 * missing or malformed (a malformed token must never reach the URL path).
 * @param {Record<string, string | undefined>} env
 * @returns {Secrets | null}
 */
export function readSecrets(env) {
  const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? '';
  const chatId = env.TELEGRAM_CHAT_ID?.trim() ?? '';
  return TOKEN_PATTERN.test(token) && CHAT_PATTERN.test(chatId) ? { token, chatId } : null;
}

/**
 * @param {unknown} value
 * @param {ReadonlySet<string> | null} allowedHosts null: any host is accepted (the site URL, which comes from the environment)
 * @returns {string | null} a normalized https URL, or null
 */
export function safeHref(value, allowedHosts) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
    if (allowedHosts !== null && !allowedHosts.has(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * @param {string} name
 * @returns {string} bounded before escaping, so a cut can never split an entity
 */
const boundedName = (name) => (name.length > MAX_NAME_CHARS ? `${name.slice(0, MAX_NAME_CHARS)}…` : name);

/**
 * @param {string} url
 * @param {string} label already translated, unescaped
 * @returns {string}
 */
const link = (url, label) => `<a href="${escapeTelegramHtml(url)}">${escapeTelegramHtml(label)}</a>`;

/**
 * @param {string} serie `contado` or `<card>:<n>`
 * @param {import('../i18n/index.js').Translator} t
 * @returns {string}
 */
function serieText(serie, t) {
  const card = cardOfSerie(serie);
  if (card === null) return t('alert.series.type_contado');
  return t('alert.series.type_card', { card: t(`card.${card}`), n: serie.slice(serie.indexOf(':') + 1) });
}

const MEDIOS = new Set(['transferencia', 'debito', 'efectivo', 'promo_un_pago', 'ninguno']);

/**
 * Cash condition from the structured `medio`/`desc` (S-34).
 * @param {{ medio?: string, desc?: number | null }} alert
 * @param {import('../i18n/index.js').Translator} t
 * @param {import('../site/format.js').Formatters} fmt
 * @returns {string | null}
 */
function conditionText({ medio, desc }, t, fmt) {
  if (medio === undefined || !MEDIOS.has(medio)) return null;
  if (medio === 'ninguno') return t('condition.ninguno');
  const suffix = typeof desc === 'number' && desc > 0 ? t('condition.con_descuento', { pct: fmt.percent(desc) }) : t('condition.sin_descuento');
  return `${t(`condition.${medio}`)}, ${suffix}`;
}

/**
 * @param {readonly string[]} rules
 * @param {import('../i18n/index.js').Translator} t
 * @returns {string}
 */
const rulesText = (rules, t) => t('alert.rules', { rules: rules.map((rule) => t(`alert.rule.${rule}`)).join(', ') });

/**
 * @param {{ tipo: string, tienda: string, serie: string }} ref
 * @param {import('../i18n/index.js').Translator} t
 * @param {RenderContext} ctx
 * @returns {string}
 */
function optionText({ tipo, tienda, serie }, t, ctx) {
  const store = ctx.storeNames[tienda] ?? tienda;
  const card = cardOfSerie(serie);
  if (tipo === 'contado' || card === null) return t('alert.best.option_contado', { store });
  return t('alert.best.option_card', { card: t(`card.${card}`), n: serie.slice(serie.indexOf(':') + 1), store });
}

const isCents = (/** @type {unknown} */ value) => typeof value === 'number' && Number.isSafeInteger(value);
const isText = (/** @type {unknown} */ value, max = 200) => typeof value === 'string' && value.length > 0 && value.length <= max;

/**
 * Structural check of an alert read back from the state (untrusted: a cache
 * can be altered). Only well-formed alerts are rendered.
 * @param {unknown} value
 * @returns {value is Alert}
 */
export function isAlert(value) {
  if (typeof value !== 'object' || value === null) return false;
  const alert = /** @type {Record<string, unknown>} */ (value);
  if (typeof alert.id !== 'string' || !ALERT_ID_PATTERN.test(alert.id) || typeof alert.detectedAt !== 'string' || !TIMESTAMP.test(alert.detectedAt) || Number.isNaN(Date.parse(alert.detectedAt)) || !isText(alert.productId, 40) || !PRODUCT_ID.test(String(alert.productId))) return false;
  if (!Array.isArray(alert.rules) || alert.rules.length === 0 || !alert.rules.every((rule) => typeof rule === 'string' && /^[a-z_]{3,30}$/.test(rule))) return false;
  if (alert.kind === 'serie') return isText(alert.tienda, 40) && isText(alert.serie, 40) && isCents(alert.prevCents) && isCents(alert.currentCents) && typeof alert.dropPct === 'number' && typeof alert.verify === 'boolean';
  if (alert.kind === 'cambio_mejor_opcion') {
    const ref = (/** @type {unknown} */ option) => typeof option === 'object' && option !== null && isText(/** @type {any} */ (option).tienda, 40) && isText(/** @type {any} */ (option).serie, 40) && ['contado', 'cuotas'].includes(/** @type {any} */ (option).tipo) && isCents(/** @type {any} */ (option).valueCents);
    return ref(alert.previous) && ref(alert.current);
  }
  if (alert.kind === 'mejor_vp') return isCents(alert.prevCents) && isCents(alert.currentCents) && isCents(alert.realCents) && isCents(alert.objetivoCents);
  return false;
}

/**
 * HTML block of one alert, or null when its product is no longer in the configuration.
 * @param {Alert} alert
 * @param {RenderContext} ctx
 * @returns {string | null}
 */
export function renderAlert(alert, ctx) {
  const product = ctx.config.productos.find((entry) => entry.id === alert.productId);
  if (product === undefined) return null;
  const t = createTranslator(ctx.language);
  const fmt = createFormatters(ctx.language === 'en' ? 'en-US' : 'es-AR');
  const e = escapeTelegramHtml;
  const name = boundedName(product.nombre);
  const siteLink = ctx.siteUrl === undefined ? null : safeHref(`${ctx.siteUrl.replace(/\/?$/, '/')}p/${alert.productId}/`, null);
  const detail = siteLink === null ? [] : [link(siteLink, t('alert.link.site'))];
  /** @param {string} store */
  const storeLink = (store) => {
    const href = safeHref(product.urls[store], ctx.allowedHosts);
    return href === null ? [] : [link(href, t('alert.link.store', { store: ctx.storeNames[store] ?? store }))];
  };

  /** @type {string[]} */
  const lines = [];
  if (alert.kind === 'serie') {
    const storeName = ctx.storeNames[alert.tienda] ?? alert.tienda;
    lines.push(`<b>${e(t('alert.series.title', { product: name, store: storeName }))}</b>`);
    lines.push(e(serieText(alert.serie, t)));
    const condition = alert.serie === CONTADO ? conditionText(alert, t, fmt) : null;
    if (condition !== null) lines.push(e(t('alert.series.condition', { condition })));
    const dif = alert.currentCents - alert.prevCents;
    lines.push(`<b>${e(t('alert.series.change', { prev: fmt.money(alert.prevCents), current: fmt.money(alert.currentCents), dif: fmt.signedMoney(dif), pct: fmt.signedPercent((dif * 100) / alert.prevCents) }))}</b>`);
    if (typeof alert.objetivoCents === 'number') lines.push(e(t('alert.series.target', { target: fmt.money(alert.objetivoCents) })));
    lines.push(`<i>${e(rulesText(alert.rules, t))}</i>`);
    if (alert.verify) lines.push(`<b>${e(t('alert.verify'))}</b>`);
    lines.push([...storeLink(alert.tienda), ...detail].join(' · '));
  } else if (alert.kind === 'cambio_mejor_opcion') {
    lines.push(`<b>${e(t('alert.best.title', { product: name }))}</b>`);
    lines.push(e(t('alert.best.previous', { option: optionText(alert.previous, t, ctx), value: fmt.money(alert.previous.valueCents) })));
    lines.push(e(t('alert.best.current', { option: optionText(alert.current, t, ctx), value: fmt.money(alert.current.valueCents) })));
    lines.push(`<i>${e(rulesText(alert.rules, t))}</i>`);
    lines.push([...storeLink(alert.current.tienda), ...detail].join(' · '));
  } else {
    lines.push(`<b>${e(t('alert.vp.title', { product: name }))}</b>`);
    lines.push(e(t('alert.vp.change', { prev: fmt.money(alert.prevCents), current: fmt.money(alert.currentCents), real: fmt.money(alert.realCents), target: fmt.money(alert.objetivoCents) })));
    lines.push(`<i>${e(rulesText(alert.rules, t))}</i>`);
    lines.push(detail.join(''));
  }
  return lines.filter((line) => line !== '').join('\n');
}

/**
 * Groups alert blocks into messages of at most `limit` characters, splitting
 * only between blocks (never inside a tag). A block that alone exceeds the
 * limit gets a message of its own (blocks are bounded by construction).
 * @param {readonly string[]} blocks
 * @param {number} [limit]
 * @returns {string[][]} the blocks of each message, in order
 */
export function splitBlocks(blocks, limit = MAX_MESSAGE_CHARS) {
  /** @type {string[][]} */
  const messages = [];
  let current = /** @type {string[]} */ ([]);
  let size = 0;
  for (const block of blocks) {
    const extra = current.length === 0 ? block.length : block.length + 2; // plus the blank line between alerts
    if (current.length > 0 && size + extra > limit) {
      messages.push(current);
      current = [block];
      size = block.length;
      continue;
    }
    current.push(block);
    size += extra;
  }
  if (current.length > 0) messages.push(current);
  return messages;
}

/**
 * @param {{ secrets: Secrets, fetch: FetchFn, sleep: (ms: number) => Promise<void>, now: () => number, log: (line: string) => void }} input
 * @returns {(text: string) => Promise<SendStatus>} sends one message, honouring the pace and one 429
 */
function createSender({ secrets, fetch: fetchFn, sleep, now, log }) {
  let lastAt = Number.NEGATIVE_INFINITY;

  /**
   * @param {string} text
   * @returns {Promise<{ status: number, retryAfter?: number }>}
   */
  const post = async (text) => {
    try {
      const response = await fetchFn(`${API_ORIGIN}/bot${secrets.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: secrets.chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }),
        // The bot token is in the URL path: a redirect must never carry it somewhere else.
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      /** @type {unknown} */
      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      const retryAfter = /** @type {{ parameters?: { retry_after?: unknown } } | null} */ (data)?.parameters?.retry_after;
      const accepted = response.ok && /** @type {{ ok?: unknown } | null} */ (data)?.ok === true;
      return { status: accepted ? 200 : response.ok ? 502 : response.status, ...(typeof retryAfter === 'number' ? { retryAfter } : {}) };
    } catch {
      // No error message: it could echo the request URL (and with it the token).
      return { status: 0 };
    }
  };

  return async (text) => {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const wait = lastAt + MIN_INTERVAL_MS - now();
      if (wait > 0) await sleep(wait);
      const reply = await post(text);
      lastAt = now();
      if (reply.status === 200) return 'ok';
      if (reply.status === 401) {
        log('::error::cuotear: telegram: the bot token was rejected (401); nothing was sent');
        return 'unauthorized';
      }
      if (reply.status === 429 && attempt === 1 && reply.retryAfter !== undefined && reply.retryAfter > 0 && reply.retryAfter <= MAX_RETRY_AFTER_S) {
        log(`[cuotear] telegram: rate limited, waiting ${reply.retryAfter} s before one retry`);
        await sleep(reply.retryAfter * 1000);
        continue;
      }
      log(`[cuotear] telegram: a message was not accepted (status ${reply.status}); its alerts stay pending`);
      return 'pending';
    }
    return 'pending';
  };
}

/**
 * @typedef {Object} SendResult
 * @property {string[]} sent ids of the alerts Telegram accepted
 * @property {string[]} pending ids not sent (kept for the next run)
 * @property {boolean} unauthorized Telegram answered 401: nothing more is sent
 */

/**
 * Renders and sends the alerts of a run, in order and serially. After the first
 * message that is not accepted the rest stay pending (order is kept).
 * @param {{
 *   alerts: readonly Alert[],
 *   secrets: Secrets,
 *   context: RenderContext,
 *   fetch?: FetchFn,
 *   sleep?: (ms: number) => Promise<void>,
 *   now?: () => number,
 *   log?: (line: string) => void,
 *   maxMessages?: number,
 *   onSent?: (ids: readonly string[]) => void,
 * }} input
 * @returns {Promise<SendResult>} `onSent` is called right after each accepted message, so a caller never loses what went out
 */
export async function sendAlerts({ alerts, secrets, context, fetch: fetchFn = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => Date.now(), log = console.log, maxMessages = MAX_MESSAGES_PER_RUN, onSent }) {
  /** @type {SendResult} */
  const result = { sent: [], pending: [], unauthorized: false };
  /** @type {{ id: string, block: string }[]} */
  const entries = [];
  for (const alert of alerts) {
    const block = renderAlert(alert, context);
    if (block === null) {
      log('[cuotear] telegram: an alert refers to a product that is no longer configured; dropped');
      continue;
    }
    entries.push({ id: alert.id, block });
  }

  const send = createSender({ secrets, fetch: fetchFn, sleep, now, log });
  const groups = splitBlocks(entries.map((entry) => entry.block));
  let offset = 0;
  let stopped = false;
  for (const [index, group] of groups.entries()) {
    const ids = entries.slice(offset, offset + group.length).map((entry) => entry.id);
    offset += group.length;
    if (!stopped && index >= maxMessages) {
      log(`[cuotear] telegram: the limit of ${maxMessages} message(s) per run was reached; the remaining alerts stay pending`);
      stopped = true;
    }
    if (stopped) {
      result.pending.push(...ids);
      continue;
    }
    const status = await send(group.join('\n\n'));
    if (status === 'ok') {
      result.sent.push(...ids);
      onSent?.(ids);
      log(`[cuotear] telegram: message ${index + 1}/${groups.length} sent (${ids.length} alert(s))`);
      continue;
    }
    stopped = true;
    result.pending.push(...ids);
    if (status === 'unauthorized') result.unauthorized = true;
  }
  return result;
}
