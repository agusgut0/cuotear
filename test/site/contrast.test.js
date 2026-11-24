import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

/**
 * WCAG 2.2 contrast of the design tokens (RNF-08): 4.5:1 for text (1.4.3) and
 * 3:1 for graphics and focus indicators (1.4.11), in the light and the dark scheme.
 */

const css = readFileSync(new URL('../../src/site/site.css', import.meta.url), 'utf8');

/** @param {string} block @returns {Record<string, string>} */
const tokens = (block) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/g)].map((match) => [String(match[1]), String(match[2])]));

const light = tokens(css.slice(0, css.indexOf('@media (prefers-color-scheme: dark)')));
const dark = { ...light, ...tokens(css.slice(css.indexOf('@media (prefers-color-scheme: dark)'), css.indexOf('*,')) ) };

/** @param {string} hex */
function luminance(hex) {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

/** @type {[string, string, number][]} foreground token, background token, minimum ratio */
const PAIRS = [
  ['text', 'bg', 4.5],
  ['text', 'surface', 4.5],
  ['text', 'best-bg', 4.5],
  ['muted', 'bg', 4.5],
  ['muted', 'surface', 4.5],
  ['muted', 'best-bg', 4.5],
  ['accent', 'bg', 4.5],
  ['accent', 'surface', 4.5],
  ['accent', 'best-bg', 4.5],
  ['good', 'bg', 4.5],
  ['good', 'surface', 4.5],
  ['good', 'best-bg', 4.5],
  ['warn', 'bg', 4.5],
  ['warn', 'surface', 4.5],
  ['warn', 'best-bg', 4.5],
  ['bad', 'surface', 4.5],
  ['bad', 'best-bg', 4.5],
  ['bad', 'bg', 4.5],
  ['border', 'bg', 3],
  ['accent', 'bg', 3],
  ['c0', 'bg', 3],
  ['c1', 'bg', 3],
  ['c2', 'bg', 3],
  ['c3', 'bg', 3],
  ['c0', 'surface', 3],
  ['c1', 'surface', 3],
  ['c2', 'surface', 3],
  ['c3', 'surface', 3],
];

for (const [scheme, palette] of /** @type {const} */ ([['light', light], ['dark', dark]])) {
  describe(`${scheme} scheme`, () => {
    for (const [foreground, background, minimum] of PAIRS) {
      test(`${foreground} on ${background} is at least ${minimum}:1`, () => {
        const ratio = contrast(palette[foreground] ?? '#000000', palette[background] ?? '#ffffff');
        assert.ok(ratio >= minimum, `${scheme}: ${foreground} ${palette[foreground]} on ${background} ${palette[background]} = ${ratio.toFixed(2)}`);
      });
    }
  });
}

test('the stylesheet supports reduced motion, a dark scheme and a visible focus ring', () => {
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /:focus-visible\s*{[^}]*outline:\s*3px/);
});
