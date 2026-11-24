import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { plotSeries } from '../../src/site/chart.js';
import { buildSite } from '../../src/site/build.js';
import { htmlProblems } from '../helpers/html-validator.js';
import { FAILED, okResult, simulate, siteModel } from '../helpers/site-model.js';

const T0 = '2026-11-22T12:00:00Z';
const at = (/** @type {number} */ hours) => new Date(Date.parse(T0) + hours * 3_600_000).toISOString();

/**
 * @param {import('../../src/site/build.js').SiteModel} model
 * @returns {{ home: string, detail: (id: string) => string, notFound: string, dir: string }}
 */
function build(model) {
  const dir = mkdtempSync(join(tmpdir(), 'cuotear-site-'));
  buildSite(model, dir);
  const read = (/** @type {string[]} */ ...parts) => readFileSync(join(dir, ...parts), 'utf8').replaceAll(' ', ' ');
  return { dir, home: read('index.html'), detail: (id) => read('p', id, 'index.html'), notFound: read('404.html') };
}

const twoPrices = () =>
  simulate({
    id: 'tv',
    nombre: 'Smart TV',
    runs: [
      { at: T0, result: okResult({ cash: 100_000_000 }) },
      { at: at(6), result: okResult({ cash: 90_000_000 }) },
    ],
  });

describe('escaping of untrusted text (RN-01)', () => {
  const hostileName = `<script>alert(1)</script>" onmouseover="alert(2)`;
  const view = simulate({ id: 'tv', nombre: hostileName, urls: { oncity: 'javascript:alert(3)' }, runs: [{ at: T0, result: okResult() }, { at: at(6), result: okResult({ cash: 90_000_000 }) }] });
  const pages = build(siteModel([view], { storeNames: { oncity: '<img src=x onerror=alert(4)>' }, builtAt: new Date(at(7)) }));

  test('no raw hostile markup reaches any page', () => {
    for (const page of [pages.home, pages.detail('tv')]) {
      assert.doesNotMatch(page, /<script/i);
      assert.doesNotMatch(page, /<img src=x/);
      assert.doesNotMatch(page, /" onmouseover="/);
      assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot; onmouseover=&quot;alert\(2\)/);
      assert.match(page, /&lt;img src=x onerror=alert\(4\)&gt;/);
    }
  });

  test('a non-https store URL produces no link', () => {
    assert.doesNotMatch(pages.home, /javascript:/);
    assert.doesNotMatch(pages.home, /store-link/);
  });

  test('the product id is validated before it becomes a path', () => {
    const bad = { ...view, id: '../escape' };
    assert.throws(() => buildSite(siteModel([bad]), mkdtempSync(join(tmpdir(), 'cuotear-site-'))), RangeError);
  });

  test('the generated pages contain no scripts, forms or inputs and declare the CSP (RF-17)', () => {
    for (const page of [pages.home, pages.detail('tv'), pages.notFound]) {
      assert.doesNotMatch(page, /<(script|form|input|textarea|button)\b/i);
      assert.match(page, /http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;self&#39;; img-src &#39;self&#39; data:/);
      assert.match(page, /<html lang="es-AR">/);
      assert.match(page, /<a class="skip" href="#contenido">/);
    }
  });
});

describe('home page', () => {
  test('lists the product with the cash price and condition, the card option, the verdict and the best option', () => {
    const { home } = build(siteModel([twoPrices()], { builtAt: new Date(at(7)) }));
    assert.match(home, /\$ 900\.000/);
    assert.match(home, /Pago único por transferencia bancaria, sin descuento adicional/);
    assert.match(home, /12 cuotas sin interés de \$ 75\.000/);
    assert.match(home, /Total \$ 900\.000/);
    assert.match(home, /badge-cuotas">Conviene cuotas/);
    assert.match(home, /<tr class="is-best">/);
    assert.match(home, /Mejor opción/);
  });

  test('a marginal difference carries the "diferencia marginal" tag', () => {
    const view = simulate({ id: 'tv', runs: [{ at: T0, result: okResult({ tarjetas: { visa: { n: 2, cuotaCents: 50_500_000, totalCents: 101_000_000 }, mastercard: null, naranja: null } }) }], r: 0.01 });
    const { home } = build(siteModel([view], { builtAt: new Date(at(1)) }));
    assert.match(home, /Diferencia marginal/);
  });

  test('"actualizado a las" is generated in Argentina time (RNF-06)', () => {
    const { home } = build(siteModel([twoPrices()], { builtAt: new Date('2026-11-22T21:05:00Z') }));
    assert.match(home, /Actualizado a las 18:05 del 22\/11\/2026 \(hora de Argentina\)/);
  });

  test('empty configuration shows instructions instead of products (RF-17)', () => {
    const { home } = build(siteModel([]));
    assert.match(home, /Todavía no hay productos/);
    assert.match(home, /config\/cuotear\.yaml/);
    assert.doesNotMatch(home, /<article/);
  });

  test('without an inflation rate there is no verdict, only the nominal comparison', () => {
    const view = simulate({ id: 'tv', runs: [{ at: T0, result: okResult() }], r: null });
    const { home } = build(siteModel([view], { rate: { r: null, origin: 'none' }, builtAt: new Date(at(1)) }));
    assert.match(home, /Sin veredicto/);
    assert.match(home, /Falta la tasa de inflación/);
  });

  test('the fallback configuration is announced (RF-19)', () => {
    const { home, notFound } = build(siteModel([twoPrices()], { usingFallbackConfig: true }));
    assert.match(home, /no es la del repositorio/);
    assert.match(notFound, /no es la del repositorio/);
  });
});

describe('series states (RF-17, S-30, RN-06)', () => {
  test('a value measured 13 h ago is out of date; 11 h ago it is not', () => {
    const view = simulate({ id: 'tv', runs: [{ at: T0, result: okResult() }] });
    assert.match(build(siteModel([view], { builtAt: new Date(at(13)) })).home, /Desactualizado/);
    assert.doesNotMatch(build(siteModel([view], { builtAt: new Date(at(11)) })).home, /Desactualizado/);
  });

  test('exactly 12 h is not yet out of date', () => {
    const view = simulate({ id: 'tv', runs: [{ at: T0, result: okResult() }] });
    assert.doesNotMatch(build(siteModel([view], { builtAt: new Date(at(12)) })).home, /Desactualizado/);
  });

  test('a failed measurement keeps the last valid value with a mark', () => {
    const view = simulate({ id: 'tv', runs: [{ at: T0, result: okResult() }, { at: at(6), result: FAILED }] });
    const { home } = build(siteModel([view], { builtAt: new Date(at(7)) }));
    assert.match(home, /Medición fallida/);
    assert.match(home, /\$ 1\.000\.000/);
  });

  test('"sin datos" after N failures shows no number and no verdict', () => {
    const runs = [{ at: T0, result: okResult() }, ...[1, 2, 3, 4].map((i) => ({ at: at(6 * i), result: FAILED }))];
    const { home } = build(siteModel([simulate({ id: 'tv', runs })], { builtAt: new Date(at(25)) }));
    assert.match(home, /Sin datos/);
    assert.doesNotMatch(home, /\$ 1\.000\.000/);
    assert.match(home, /Sin veredicto/);
  });

  test('out of stock is shown as "sin stock" with no price', () => {
    const view = simulate({ id: 'tv', runs: [{ at: T0, result: okResult() }, { at: at(6), result: { outcome: 'sin_stock', meta: { requests: 1, ms: 1 } } }] });
    const { home } = build(siteModel([view], { builtAt: new Date(at(7)) }));
    assert.match(home, /Sin stock/);
    assert.doesNotMatch(home, /\$ 1\.000\.000/);
  });

  test('a store never measured shows "sin datos" for every option', () => {
    const view = simulate({ id: 'tv', runs: [{ at: T0, result: FAILED }] });
    const { home } = build(siteModel([view], { builtAt: new Date(at(1)) }));
    assert.equal(home.match(/class="state">Sin datos/g)?.length, 4);
  });
});

describe('detail page: chart and table (RF-17, RNF-08)', () => {
  const view = twoPrices();
  const page = build(siteModel([view], { builtAt: new Date(at(7)) })).detail('tv');

  test('the chart is an accessible SVG with a title, a description and a legend', () => {
    assert.match(page, /<svg class="chart"[^>]*role="img" aria-labelledby="chart-title chart-desc"/);
    assert.match(page, /<title id="chart-title">Evolución de precios de Smart TV<\/title>/);
    assert.match(page, /<desc id="chart-desc">On City · Contado: mínimo \$ 900\.000, máximo \$ 1\.000\.000, último \$ 900\.000\./);
    assert.match(page, /<ul class="legend">/);
  });

  test('every plotted marker has a row in the visible table', () => {
    const chart = page.match(/<svg class="chart"[\s\S]*?<\/svg>/)?.[0] ?? '';
    const markers = chart.match(/class="mk s\d"/g)?.length ?? 0;
    const tableRows = [...page.matchAll(/<tr><th scope="row"><time[^>]*>[^<]*<\/time><\/th><td>[^<]*<\/td><td>[^<]*<\/td><td class="num">([^<]*)<\/td><td>Precio registrado<\/td><\/tr>/g)];
    assert.equal(markers, 4);
    assert.equal(tableRows.length, markers);
    assert.deepEqual(tableRows.map((row) => row[1]).sort(), ['$ 1.000.000', '$ 1.000.000', '$ 900.000', '$ 900.000']);
  });

  test('the table has a caption and scoped headers', () => {
    assert.match(page, /<caption id="history-table-caption">Historial de Smart TV: datos del gráfico<\/caption>/);
    assert.match(page, /<th scope="col">Fecha<\/th>/);
  });

  test('the detail adds nominal difference and present value (RF-21)', () => {
    assert.match(page, /Diferencia nominal/);
    assert.match(page, /Valor presente/);
  });

  test('a series with fewer than two points shows a message instead of the chart', () => {
    const single = simulate({ id: 'tv', runs: [{ at: T0, result: okResult() }] });
    const html = build(siteModel([single])).detail('tv');
    assert.match(html, /Todavía no hay suficiente historial para graficar/);
    assert.doesNotMatch(html, /<svg class="chart"/);
    assert.match(html, /Precio registrado/);
  });

  test('empty history: message and empty table text, no chart', () => {
    const empty = simulate({ id: 'tv', runs: [{ at: T0, result: FAILED }] });
    const html = build(siteModel([empty])).detail('tv');
    assert.match(html, /Todavía no hay suficiente historial/);
    assert.match(html, /Todavía no hay datos de historial/);
  });
});

describe('plotSeries: the step line ends at the last valid measurement (RF-17, S-30)', () => {
  /** @param {string} t @param {number} valor @returns {import('../../src/core/history.js').HistoryPoint} */
  const point = (t, valor) => ({ t, tienda: 'oncity', serie: 'contado', estado: 'ok', valor });

  test('points on 1/3 and 10/3 with the last valid measurement on 20/3 reach 20/3 and no further', () => {
    const series = plotSeries([point('2026-03-01T12:00:00Z', 100), point('2026-03-10T12:00:00Z', 90)], new Map([['oncity/contado', '2026-03-20T12:00:00Z']]), () => 'x');
    assert.equal(series.length, 1);
    const [run] = series[0]?.runs ?? [];
    assert.equal(run?.end, Date.parse('2026-03-20T12:00:00Z'));
    assert.deepEqual(run?.points.map((p) => p.v), [100, 90]);
  });

  test('a non-ok point ends the run at its own time', () => {
    /** @type {import('../../src/core/history.js').HistoryPoint} */
    const stockout = { t: '2026-03-05T12:00:00Z', tienda: 'oncity', serie: 'contado', estado: 'sin_stock' };
    const series = plotSeries([point('2026-03-01T12:00:00Z', 100), stockout, point('2026-03-10T12:00:00Z', 90)], new Map(), () => 'x');
    assert.deepEqual(series[0]?.runs.map((run) => run.end), [Date.parse('2026-03-05T12:00:00Z'), Date.parse('2026-03-10T12:00:00Z')]);
  });

  test('a series with no ok point is not plotted', () => {
    assert.deepEqual(plotSeries([{ t: '2026-03-05T12:00:00Z', tienda: 'oncity', serie: 'contado', estado: 'sin_stock' }], new Map(), () => 'x'), []);
  });
});

describe('html-validate on the generated pages (RNF-08, static check)', () => {
  test('home, detail, empty and 404 pages have no errors', async () => {
    const hostile = simulate({ id: 'tv', nombre: '<b>"x"</b>', runs: [{ at: T0, result: okResult() }, { at: at(6), result: okResult({ cash: 90_000_000 }) }] });
    const pages = [
      ...[build(siteModel([hostile], { usingFallbackConfig: true })), build(siteModel([]))].flatMap((site) => [site.home, site.notFound]),
      build(siteModel([hostile])).detail('tv'),
    ];
    for (const page of pages) {
      assert.deepEqual(await htmlProblems(page), []);
    }
  });
});
