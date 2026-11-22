import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/** @param {string} name @returns {Record<string, string>} */
const catalog = (name) => JSON.parse(readFileSync(new URL(`../../src/i18n/${name}.json`, import.meta.url), 'utf8'));

/** @param {string} text @returns {string[]} named placeholders such as {rate} */
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => String(match[1])).sort();

const es = catalog('es-AR');
const en = catalog('en');

test('es-AR and en have exactly the same keys (RNF-03)', () => {
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
});

test('every message is a non-empty string and has the same placeholders in both languages', () => {
  for (const [key, text] of Object.entries(es)) {
    assert.ok(text.trim() !== '' && (en[key] ?? '').trim() !== '', `${key} must not be empty`);
    assert.deepEqual(placeholders(en[key] ?? ''), placeholders(text), `placeholders differ for ${key}`);
  }
});

test('catalogs cover every verdict and every series status', () => {
  const keys = Object.keys(es);
  for (const verdict of ['contado', 'cuotas', 'sin_veredicto', 'marginal']) assert.ok(keys.includes(`verdict.${verdict}`), verdict);
  for (const status of ['valida', 'fallida', 'sin_datos', 'sin_stock', 'cerrada']) assert.ok(keys.includes(`status.${status}`), status);
});
