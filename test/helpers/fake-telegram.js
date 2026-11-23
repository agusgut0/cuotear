/**
 * Scripted fake of `fetch` for the Telegram Bot API: no network. Replies are
 * served in order (the last one repeats); every call is recorded with its
 * parsed JSON body, so tests can check the text that would have been sent.
 *
 * @typedef {{ status?: number, json?: unknown, throws?: Error }} TelegramReply
 * @typedef {{ url: string, method: string, body: { chat_id?: string, text: string, parse_mode?: string, link_preview_options?: { is_disabled?: boolean } }, at: number }} TelegramCall
 */

export const TOKEN = '123456789:AAFakeTokenFakeTokenFakeTokenFake123';
export const CHAT_ID = '-1001234567890';
export const TELEGRAM_ENV = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT_ID };

/** @type {TelegramReply} */
export const OK = { status: 200, json: { ok: true, result: { message_id: 1 } } };

/**
 * @param {TelegramReply[]} [replies]
 * @param {() => number} [now]
 * @returns {{ fetch: typeof fetch, calls: TelegramCall[] }}
 */
export function fakeTelegram(replies = [OK], now = () => 0) {
  /** @type {TelegramCall[]} */
  const calls = [];
  /** @type {typeof fetch} */
  const impl = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', body: JSON.parse(String(init?.body ?? '{}')), at: now() });
    const reply = /** @type {TelegramReply} */ (replies[Math.min(calls.length - 1, replies.length - 1)]);
    if (reply.throws !== undefined) throw reply.throws;
    return new Response(JSON.stringify(reply.json ?? {}), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: impl, calls };
}
