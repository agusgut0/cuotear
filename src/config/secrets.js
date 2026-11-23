const SECRET_KEY = /token|password|passwd|secret|api[_-]?key|chat[_-]?id|smtp/i;
const BOT_TOKEN = /^\d{6,}:[A-Za-z0-9_-]{30,}$/;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/**
 * @param {string} key
 * @returns {boolean} true when the key name looks like a secret holder
 */
export function isSecretKey(key) {
  return SECRET_KEY.test(key);
}

/**
 * @param {string} value
 * @returns {boolean} true when the string looks like a bot token or an email address
 */
export function looksLikeSecret(value) {
  return BOT_TOKEN.test(value) || EMAIL.test(value);
}
