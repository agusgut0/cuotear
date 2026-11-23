/**
 * Response classification, inherited from the store-access spike (DRT 5).
 * Everything here only reads text; nothing downloaded is executed.
 *
 * @typedef {'json'|'html'|'blocked'|'captcha'|'not_found'|'http'} ResponseClass
 */

const CAPTCHA = /captcha|hcaptcha|turnstile|px-captcha|are you a robot|verify you are human/i;
const BLOCK_PAGE = /access denied|attention required|request unsuccessful|incapsula|errors\.edgesuite|just a moment/i;
const SMALL_PAGE_BYTES = 60_000;

/**
 * @param {{ status: number, contentType: string, text: string, bytes: number }} response
 * @returns {ResponseClass}
 */
export function classifyResponse({ status, contentType, text, bytes }) {
  if (status === 404 || status === 410) return 'not_found';
  const sample = text.slice(0, 200_000);
  const looksJson = /json/i.test(contentType) || /^\s*[[{]/.test(sample);
  if (looksJson && status < 400) return 'json';
  if (CAPTCHA.test(sample) && (status >= 400 || bytes < SMALL_PAGE_BYTES)) return 'captcha';
  if ([401, 403, 429, 451].includes(status)) return 'blocked';
  if (BLOCK_PAGE.test(sample) && bytes < SMALL_PAGE_BYTES) return 'blocked';
  if (status >= 400) return 'http';
  return 'html';
}
