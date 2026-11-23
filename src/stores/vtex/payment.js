/**
 * Payment-system classification for VTEX installment lines (DRT 6.2, RN-09, RN-14).
 * Names come from the store and are untrusted: they are only compared, never echoed.
 *
 * @typedef {import('../types.js').Card} Card
 * @typedef {import('../types.js').Medio} Medio
 */

/**
 * Lowercase, no accents, single spaces.
 * @param {string} name
 * @returns {string}
 */
export function normalizeName(name) {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Exact (normalized) payment-system names accepted per card. Store or bank
 * branded cards ("Tarjeta Carrefour Mastercard", "On City Credito",
 * "Patagonia 365") are deliberately absent (RN-14).
 * @type {Readonly<Record<Card, readonly string[]>>}
 */
export const CARD_NAMES = Object.freeze({
  visa: ['visa'],
  mastercard: ['mastercard', 'master card'],
  naranja: ['naranja', 'tarjeta naranja', 'naranja x'],
});

/**
 * @param {string} normalized
 * @returns {Card | null}
 */
export function cardOf(normalized) {
  for (const [card, names] of Object.entries(CARD_NAMES)) {
    if (names.includes(normalized)) return /** @type {Card} */ (card);
  }
  return null;
}

/** Tie-break preference among cash media at the same value. */
export const CASH_PREFERENCE = /** @type {readonly Medio[]} */ (['transferencia', 'efectivo', 'debito']);

/**
 * Classifies a one-payment line as a cash candidate. Credit cards, wallets and
 * store or bank brands are not candidates; Maestro and Visa Electron are debit.
 * @param {string} normalized
 * @returns {Medio | null}
 */
export function cashMedioOf(normalized) {
  if (normalized.includes('transferencia')) return 'transferencia';
  if (normalized.includes('efectivo')) return 'efectivo';
  if (normalized.includes('debito') || normalized.includes('debit') || normalized === 'maestro' || normalized === 'visa electron') return 'debito';
  return null;
}
