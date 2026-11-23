import { readFileSync } from 'node:fs';

/**
 * Message catalogs (DRT 14.4, RNF-03): flat keys with named placeholders
 * (`{name}`). A missing key or placeholder is a bug and throws, so tests that
 * render pages cover the catalogs.
 *
 * @typedef {'es-AR'|'en'} Language
 * @typedef {(key: string, params?: Record<string, string|number>) => string} Translator
 */

/** @type {Map<Language, Record<string, string>>} */
const cache = new Map();

/**
 * @param {Language} language
 * @returns {Record<string, string>}
 */
function catalog(language) {
  let found = cache.get(language);
  if (found === undefined) {
    found = JSON.parse(readFileSync(new URL(`./${language}.json`, import.meta.url), 'utf8'));
    cache.set(language, /** @type {Record<string, string>} */ (found));
  }
  return /** @type {Record<string, string>} */ (found);
}

/**
 * @param {Language} language
 * @returns {Translator}
 */
export function createTranslator(language) {
  const messages = catalog(language);
  return (key, params = {}) => {
    const message = messages[key];
    if (message === undefined) throw new Error(`missing i18n key: ${key}`);
    return message.replace(/\{(\w+)\}/g, (_, name) => {
      const value = params[name];
      if (value === undefined) throw new Error(`missing i18n parameter {${name}} for ${key}`);
      return String(value);
    });
  };
}
