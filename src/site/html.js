/**
 * Auto-escaping HTML templates (DRT 14.2, RN-01).
 *
 * `html` is a tagged template that escapes every interpolated value. The
 * only way to put markup into a template is to interpolate the result of
 * another `html` template (a `SafeHtml`); there is no function that wraps a
 * string as trusted markup, so downloaded or configured text can never be
 * inserted raw. Attribute values must always be written inside quotes in the
 * template (the quote characters are escaped).
 */

const ESCAPES = /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' });

/** Markup produced by `html`; the constructor is private to this module. */
export class SafeHtml {
  #markup;

  /**
   * @param {string} markup
   * @param {symbol} token
   */
  constructor(markup, token) {
    if (token !== PRIVATE) throw new TypeError('SafeHtml can only be created by the html template tag');
    this.#markup = markup;
  }

  toString() {
    return this.#markup;
  }
}

const PRIVATE = Symbol('safe-html');

/**
 * @param {string} text
 * @returns {string}
 */
export const escapeHtml = (text) => text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

/**
 * @typedef {SafeHtml | string | number | boolean | null | undefined | readonly Interpolation[]} Interpolation
 */

/**
 * @param {Interpolation} value
 * @returns {string}
 */
function render(value) {
  if (value instanceof SafeHtml) return value.toString();
  if (Array.isArray(value)) return value.map(render).join('');
  if (value === null || value === undefined || value === false || value === true) return '';
  return escapeHtml(String(value));
}

/**
 * @param {TemplateStringsArray} strings
 * @param {Interpolation[]} values
 * @returns {SafeHtml}
 */
export function html(strings, ...values) {
  let markup = strings[0] ?? '';
  values.forEach((value, index) => {
    markup += render(value) + (strings[index + 1] ?? '');
  });
  return new SafeHtml(markup, PRIVATE);
}

/**
 * Only https links leave the site (DRT 14.2); anything else is dropped.
 * @param {string} url
 * @returns {string | null}
 */
export function externalHref(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}
