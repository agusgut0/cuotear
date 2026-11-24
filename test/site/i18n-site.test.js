import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSite } from '../../src/site/build.js';
import { htmlProblems } from '../helpers/html-validator.js';
import { okResult, simulate, siteModel } from '../helpers/site-model.js';

const T0 = '2026-11-22T12:00:00Z';
const at = (/** @type {number} */ hours) => new Date(Date.parse(T0) + hours * 3_600_000).toISOString();

/** @param {import('../../src/site/build.js').SiteModel} model */
function build(model) {
  const dir = mkdtempSync(join(tmpdir(), 'cuotear-i18n-'));
  buildSite(model, dir);
  return { dir, read: (/** @type {string} */ path) => readFileSync(join(dir, path), 'utf8').replaceAll(' ', ' ') };
}

const view = simulate({ id: 'tv', nombre: 'Smart TV', runs: [{ at: T0, result: okResult({ cash: 100_000_000 }) }, { at: at(6), result: okResult({ cash: 90_000_000 }) }] });
const site = build(siteModel([view], { builtAt: new Date('2026-11-22T21:05:00Z') }));
const PAGES = ['index.html', 'p/tv/index.html', '404.html'];

/**
 * Resolves the href of the first element matching `pattern` against the page it is on.
 * @param {string} page path of the page inside the site
 * @param {RegExp} pattern with one capture group: the href
 * @returns {string} path of the target inside the site
 */
function follow(page, pattern) {
  const href = pattern.exec(site.read(page))?.[1];
  assert.ok(href !== undefined, `${page}: link not found`);
  const { pathname } = new URL(href, `http://site.test/${page}`);
  return pathname.slice(1).replace(/(^|\/)$/, '$1index.html');
}

describe('English tree (DRT 14.1, 14.4)', () => {
  test('the home, the detail page and the 404 exist under en/ next to the es-AR ones', () => {
    for (const page of PAGES) {
      assert.ok(site.read(page).length > 0, page);
      assert.ok(site.read(`en/${page}`).length > 0, `en/${page}`);
    }
  });

  test('<html lang> matches the language of the tree', () => {
    for (const page of PAGES) {
      assert.match(site.read(page), /<html lang="es-AR">/);
      assert.match(site.read(`en/${page}`), /<html lang="en">/);
    }
  });

  test('English pages carry English texts and no Spanish ones', () => {
    const home = site.read('en/index.html');
    assert.match(home, /Cash and installment prices/);
    assert.match(home, /Skip to content/);
    assert.match(home, /Installments are cheaper at On City/);
    assert.match(home, /12 interest-free installments of/);
    assert.match(home, /Single payment by bank transfer, no extra discount/);
    assert.doesNotMatch(home, /Conviene|Contado|Saltar al contenido|cuotas sin interés/);
    assert.match(site.read('en/404.html'), /Page not found/);
    assert.match(site.read('en/p/tv/index.html'), /Price history/);
  });

  test('numbers and dates follow en-US while amounts stay in pesos and are labelled ARS', () => {
    const home = site.read('en/index.html');
    assert.match(home, /ARS 900,000/);
    assert.doesNotMatch(home, /\$ 900/);
    assert.match(home, /Updated at 18:05 on 11\/22\/2026 \(Argentina time\)/);
    assert.match(home, /All amounts are in Argentine pesos \(ARS\)/);
    assert.match(site.read('index.html'), /Actualizado a las 18:05 del 22\/11\/2026/);
    assert.match(site.read('index.html'), /\$ 900\.000/);
  });

  test('the chart and the history table are translated too', () => {
    const page = site.read('en/p/tv/index.html');
    assert.match(page, /<title id="chart-title">Price evolution of Smart TV<\/title>/);
    assert.match(page, /<desc id="chart-desc">On City · Cash: minimum ARS 900,000, maximum ARS 1,000,000, latest ARS 900,000\./);
    assert.match(page, /<caption id="history-table-caption">History of Smart TV: chart data<\/caption>/);
    assert.match(page, /<td>Price recorded<\/td>/);
  });
});

describe('language switcher and alternates', () => {
  test('every page links to its equivalent in the other language and the link round-trips', () => {
    for (const page of PAGES) {
      const toEnglish = follow(page, /<a lang="en" hreflang="en" href="([^"]+)">English<\/a>/);
      assert.equal(toEnglish, `en/${page}`);
      const back = follow(toEnglish, /<a lang="es-AR" hreflang="es-AR" href="([^"]+)">Español<\/a>/);
      assert.equal(back, page);
    }
  });

  test('the current language is marked, not linked, and the switcher is labelled in the page language', () => {
    assert.match(site.read('index.html'), /<nav class="lang" aria-label="Idioma"><span lang="es-AR" aria-current="true">Español<\/span>/);
    assert.match(site.read('en/index.html'), /<nav class="lang" aria-label="Language"><a lang="es-AR"/);
    assert.match(site.read('en/index.html'), /<span lang="en" aria-current="true">English<\/span>/);
  });

  test('hreflang alternates point to both languages and x-default to es-AR', () => {
    const detail = site.read('p/tv/index.html');
    assert.match(detail, /<link rel="alternate" hreflang="es-AR" href="\.\/" \/>/);
    assert.match(detail, /<link rel="alternate" hreflang="en" href="\.\.\/\.\.\/en\/p\/tv\/" \/>/);
    assert.match(detail, /<link rel="alternate" hreflang="x-default" href="\.\/" \/>/);
    const english = site.read('en/p/tv/index.html');
    assert.match(english, /<link rel="alternate" hreflang="es-AR" href="\.\.\/\.\.\/\.\.\/p\/tv\/" \/>/);
    assert.match(english, /<link rel="alternate" hreflang="en" href="\.\/" \/>/);
    assert.match(english, /<link rel="alternate" hreflang="x-default" href="\.\.\/\.\.\/\.\.\/p\/tv\/" \/>/);
  });

  test('assets, brand and breadcrumb links resolve inside the right tree', () => {
    assert.equal(follow('en/p/tv/index.html', /<link rel="stylesheet" href="([^"]+)"/), 'assets/site.css');
    assert.equal(follow('en/index.html', /<link rel="stylesheet" href="([^"]+)"/), 'assets/site.css');
    assert.equal(follow('en/p/tv/index.html', /<p class="brand"><a href="([^"]+)"/), 'en/index.html');
    assert.equal(follow('en/p/tv/index.html', /<nav aria-label="Breadcrumb"><a href="([^"]+)"/), 'en/index.html');
    assert.equal(follow('en/index.html', /<h2 id="product-tv"><a href="([^"]+)"/), 'en/p/tv/index.html');
    assert.equal(follow('p/tv/index.html', /<p class="brand"><a href="([^"]+)"/), 'index.html');
  });
});

describe('escaping in both languages (RN-01)', () => {
  const hostile = simulate({ id: 'tv', nombre: `<script>alert(1)</script>" onmouseover="alert(2)`, urls: { oncity: 'javascript:alert(3)' }, runs: [{ at: T0, result: okResult() }, { at: at(6), result: okResult({ cash: 90_000_000 }) }] });
  const pages = build(siteModel([hostile], { storeNames: { oncity: '<img src=x onerror=alert(4)>' }, builtAt: new Date(at(7)) }));

  test('no raw markup reaches the English pages either', () => {
    for (const page of ['en/index.html', 'en/p/tv/index.html']) {
      const text = pages.read(page);
      assert.doesNotMatch(text, /<script/i);
      assert.doesNotMatch(text, /<img src=x/);
      assert.doesNotMatch(text, /" onmouseover="/);
      assert.doesNotMatch(text, /javascript:/);
      assert.match(text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot; onmouseover=&quot;alert\(2\)/);
      assert.match(text, /&lt;img src=x onerror=alert4?\(?4?\)?&gt;|&lt;img src=x onerror=alert\(4\)&gt;/);
    }
  });

  test('the English pages are valid HTML', async () => {
    const short = build(siteModel([simulate({ id: 'tv', nombre: '<b>"x"</b>', runs: [{ at: T0, result: okResult() }, { at: at(6), result: okResult({ cash: 90_000_000 }) }] })], { usingFallbackConfig: true }));
    for (const page of ['en/index.html', 'en/p/tv/index.html', 'en/404.html']) assert.deepEqual(await htmlProblems(short.read(page)), [], page);
  });
});

describe('the rate line follows the origin of the rate', () => {
  /** @param {import('../../src/core/compare.js').MonthlyRate} rate */
  const footerOf = (rate) => build(siteModel([view], { rate })).read('en/index.html');

  test('manual and backup have their own source label', () => {
    assert.match(footerOf({ r: 0.025, origin: 'manual' }), /Monthly inflation 2\.50% \(Manual value\)/);
    assert.match(footerOf({ r: 0.025, origin: 'backup' }), /\(Manual fallback value\)/);
  });

  test('an origin without a message in the catalog falls back to the manual label instead of failing', () => {
    assert.match(footerOf({ r: 0.025, origin: /** @type {never} */ ('unknown-origin') }), /\(Manual value\)/);
  });
});

describe('no user-visible text is hardcoded in the site and alert code (RNF-03)', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');
  const files = [...readdirSync(join(root, 'site')).filter((name) => name.endsWith('.js')).map((name) => join(root, 'site', name)), join(root, 'notify', 'telegram.js')];

  test('no accented Spanish text or Spanish words in the string literals', () => {
    for (const file of files) {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      assert.doesNotMatch(code, /[áéíóúñ¿¡]/i, relative(root, file));
      assert.doesNotMatch(code, /['"`][^'"`\n]*\b(Precio|Tienda|Conviene|Contado|Volver|Ver )\b[^'"`\n]*['"`]/, relative(root, file));
    }
  });
});
