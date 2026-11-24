import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { buildSite } from '../../src/site/build.js';
import { htmlProblems } from '../helpers/html-validator.js';
import { FAILED, okResult, simulate, siteModel } from '../helpers/site-model.js';

/**
 * WCAG 2.2 AA structure of the generated pages (RNF-08): scrollable regions
 * reachable by keyboard (2.1.1), heading order (1.3.1), names (4.1.2) and
 * empty cells with a text alternative.
 */

const T0 = '2026-11-22T12:00:00Z';
const at = (/** @type {number} */ hours) => new Date(Date.parse(T0) + hours * 3_600_000).toISOString();

const view = simulate({ id: 'tv', nombre: 'Smart TV', runs: [{ at: T0, result: okResult({ cash: 100_000_000 }) }, { at: at(6), result: okResult({ cash: 90_000_000 }) }] });
const dir = mkdtempSync(join(tmpdir(), 'cuotear-a11y-'));
buildSite(siteModel([view], { builtAt: new Date(at(7)) }), dir);
const read = (/** @type {string} */ path) => readFileSync(join(dir, path), 'utf8').replaceAll(' ', ' ');

const PAGES = ['index.html', 'p/tv/index.html', 'en/index.html', 'en/p/tv/index.html'];

/** @param {string} page @returns {string[]} */
const ids = (page) => [...page.matchAll(/\sid="([^"]+)"/g)].map((match) => String(match[1]));

describe('scrollable regions (2.1.1)', () => {
  for (const path of PAGES) {
    test(`${path}: every scroll container is a focusable named region (a named <section> has the region role, as html-validate prefers it to role="region") and ids are unique`, () => {
      const page = read(path);
      const scrollers = [...page.matchAll(/<section class="(?:table-wrap|chart-scroll)"[^>]*>/g)].map((match) => match[0]);
      assert.ok(scrollers.length >= 1);
      const all = ids(page);
      assert.equal(new Set(all).size, all.length, 'duplicate ids');
      for (const tag of scrollers) {
        assert.match(tag, /tabindex="0"/);
        const target = /aria-labelledby="([^"]+)"/.exec(tag)?.[1];
        assert.ok(target !== undefined && all.includes(target), `${tag}: unknown label id`);
      }
    });
  }

  test('the detail page has a scroller for the chart and the SVG keeps a minimum width', () => {
    assert.match(read('p/tv/index.html'), /<section class="chart-scroll" aria-labelledby="chart-title" tabindex="0"><svg class="chart"/);
    assert.match(readFileSync(new URL('../../src/site/site.css', import.meta.url), 'utf8'), /\.chart\s*{[^}]*min-width:\s*36rem/);
  });
});

describe('heading order and names (1.3.1, 4.1.2)', () => {
  /** @param {string} page @returns {number[]} */
  const levels = (page) => [...page.matchAll(/<h([1-6])[\s>]/g)].map((match) => Number(match[1]));

  test('the detail page goes h1, h2 (stores), h2 (history); the home goes h1, h2, h3', () => {
    for (const path of ['p/tv/index.html', 'en/p/tv/index.html']) {
      const found = levels(read(path));
      assert.deepEqual(found.filter((level) => level !== 2), [1]);
      assert.equal(found[0], 1);
    }
    assert.deepEqual(levels(read('index.html')), [1, 2, 3]);
  });

  test('the store section is named by a span with only the store name, not the heading link', () => {
    for (const path of PAGES) {
      const page = read(path);
      assert.match(page, /<section class="store" aria-labelledby="store-tv-oncity">/);
      assert.match(page, /<h[23]><span id="store-tv-oncity">[^<]+<\/span> <a class="store-link"/);
    }
  });
});

describe('time and empty cells', () => {
  test('no sr-only <time> repeats the raw ISO date; the visible time is the <time> element', () => {
    for (const path of PAGES) {
      const page = read(path);
      assert.doesNotMatch(page, /<time[^>]*class="sr-only"/);
      assert.match(page, /<p class="updated"><time datetime="2026-11-22T19:00:00\.000Z">[^<]+<\/time><\/p>/);
    }
  });

  test('empty cells are hidden from assistive tech and carry the text alternative, in both languages', () => {
    const noValue = simulate({ id: 'tv', nombre: 'Smart TV', runs: [{ at: T0, result: okResult() }, { at: at(6), result: FAILED }] });
    const other = mkdtempSync(join(tmpdir(), 'cuotear-a11y-'));
    buildSite(siteModel([noValue], { builtAt: new Date(at(7)) }), other);
    for (const [path, text] of [['p/tv/index.html', 'Sin comparación'], ['en/p/tv/index.html', 'Not compared']]) {
      const page = readFileSync(join(other, String(path)), 'utf8');
      assert.match(page, new RegExp(`<span aria-hidden="true">—</span><span class="sr-only">${text}</span>`));
      assert.doesNotMatch(page, /<td[^>]*>—<\/td>/);
    }
  });

  test('the history table empty value uses the same pattern', () => {
    const failing = simulate({ id: 'tv', nombre: 'Smart TV', runs: [{ at: T0, result: FAILED }] });
    const other = mkdtempSync(join(tmpdir(), 'cuotear-a11y-'));
    buildSite(siteModel([failing], { builtAt: new Date(at(1)) }), other);
    const page = readFileSync(join(other, 'p/tv/index.html'), 'utf8');
    assert.doesNotMatch(page, /<td class="num">—<\/td>/);
  });
});

describe('html-validate with the chart (RNF-08)', () => {
  test('both detail pages, with a chart of at least two points, have no findings', async () => {
    for (const path of ['p/tv/index.html', 'en/p/tv/index.html']) {
      const page = read(path);
      assert.match(page, /<svg class="chart"/);
      assert.deepEqual(await htmlProblems(page), []);
    }
  });
});
