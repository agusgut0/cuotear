/** Display formatting with Intl (DRT 12, 14.4): amounts rounded to the peso, percentages with 2 decimals. */

export const TIME_ZONE = 'America/Argentina/Buenos_Aires';

/**
 * Intl locale of a UI language: English uses en-US conventions, while amounts
 * stay in Argentine pesos and are labelled `ARS` (never `$`, which is ambiguous).
 * @param {import('../i18n/index.js').Language} language
 * @returns {string}
 */
export const intlLocale = (language) => (language === 'en' ? 'en-US' : 'es-AR');

/**
 * @param {string} [locale] an Intl locale (see `intlLocale`)
 */
export function createFormatters(locale = 'es-AR') {
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  const signedMoney = new Intl.NumberFormat(locale, { style: 'currency', currency: 'ARS', maximumFractionDigits: 0, signDisplay: 'exceptZero' });
  const percent = new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signedPercent = new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' });
  const dateTime = new Intl.DateTimeFormat(locale, { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const date = new Intl.DateTimeFormat(locale, { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' });
  const shortDate = new Intl.DateTimeFormat(locale, { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit' });
  const time = new Intl.DateTimeFormat(locale, { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

  return {
    /** @param {number} cents */
    money: (cents) => money.format(cents / 100),
    /** @param {number} cents */
    signedMoney: (cents) => signedMoney.format(cents / 100),
    /** @param {number} value percent points (2.5 = 2.50 %) */
    percent: (value) => percent.format(value / 100),
    /** @param {number} value percent points */
    signedPercent: (value) => signedPercent.format(value / 100),
    /** @param {string | Date} value */
    dateTime: (value) => dateTime.format(new Date(value)),
    /** @param {string | Date} value */
    date: (value) => date.format(new Date(value)),
    /** @param {number} ms */
    shortDate: (ms) => shortDate.format(new Date(ms)),
    /** @param {string | Date} value */
    time: (value) => time.format(new Date(value)),
  };
}

/** @typedef {ReturnType<typeof createFormatters>} Formatters */
