import { cardOfSerie } from '../core/series.js';
import { hasEnoughPoints, plotSeries, renderChart } from './chart.js';
import { html } from './html.js';
import { headline, storeTable } from './views.js';

/**
 * Page templates (DRT 14): plain semantic HTML, no JavaScript, one
 * stylesheet. Asset paths are relative so the site works under a Pages
 * project path (`/<repo>/`).
 *
 * @typedef {import('./views.js').RenderContext} RenderContext
 * @typedef {import('../pipeline/view.js').ProductView} ProductView
 */

const CSP = "default-src 'none'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'";

const LANGUAGES = /** @type {const} */ (['es-AR', 'en']);

/**
 * Where a page lives, relative to the root of its language tree: '' (home),
 * 'p/<id>/' (detail) or '404.html'. Asset path, home link and the equivalent
 * page in the other language are derived from it, so every link stays
 * relative and works under a Pages project path.
 * @param {string} path
 * @returns {{ up: string, self: string }}
 */
function locate(path) {
  const depth = path.endsWith('/') ? path.split('/').length - 1 : 0;
  return { up: '../'.repeat(depth), self: path.endsWith('.html') ? path : './' };
}

/**
 * Source label of the inflation rate: the catalog key follows the origin of
 * the rate (`rem-stale` -> `rate.origin.rem_stale`). An origin without a
 * message in the catalogs falls back to the manual one.
 * @param {RenderContext} ctx
 * @returns {string}
 */
function rateSource({ t, model }) {
  try {
    return t(`rate.origin.${model.rate.origin.replaceAll('-', '_')}`);
  } catch {
    return t('rate.origin.manual');
  }
}

/**
 * @param {{ ctx: RenderContext, title: string, description: string, path: string, body: import('./html.js').SafeHtml }} input
 * @returns {string}
 */
function layout({ ctx, title, description, path, body }) {
  const { t, fmt, model, language } = ctx;
  const { up, self } = locate(path);
  // The English tree sits one level below the site root (/en/...); es-AR is the root.
  const root = (language === 'en' ? '../' : '') + up;
  const hrefOf = (/** @type {import('../i18n/index.js').Language} */ target) => (target === language ? self : target === 'en' ? `${up}en/${path}` : `../${up}${path}`);
  const builtAt = model.builtAt.toISOString();
  const { annualPct, fecha } = model.rate;
  const rateParams = { rate: fmt.percent(model.rate.r === null ? 0 : model.rate.r * 100), source: rateSource(ctx), s: model.s };
  // `fecha` is a calendar day: noon UTC keeps it on the same day in the site time zone.
  const rate = model.rate.r === null
    ? t('rate.none')
    : annualPct !== undefined && fecha !== undefined
      ? t('rate.summary_rem', { ...rateParams, annual: fmt.percent(annualPct), date: fmt.date(`${fecha}T12:00:00Z`) })
      : t('rate.summary', rateParams);
  const lastValid = model.products.flatMap((view) => view.records.map((record) => record.lastValidAt ?? '')).filter((value) => value !== '').sort().at(-1);
  const failing = model.failingStores.map((id) => model.storeNames[id] ?? id).join(', ');

  return `<!doctype html>\n${html`<html lang="${language}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="${CSP}" />
<meta name="color-scheme" content="light dark" />
<meta name="description" content="${description}" />
<title>${title}</title>
${LANGUAGES.map((code) => html`<link rel="alternate" hreflang="${code}" href="${hrefOf(code)}" />\n`)}<link rel="alternate" hreflang="x-default" href="${hrefOf('es-AR')}" />
<link rel="icon" href="data:," />
<link rel="stylesheet" href="${root}assets/site.css" />
</head>
<body>
<a class="skip" href="#contenido">${t('site.skip')}</a>
<header class="site-header">
<p class="brand"><a href="${up === '' ? './' : up}">${t('site.name')}</a></p>
<p class="updated"><time datetime="${builtAt}">${t('site.updated', { time: fmt.time(model.builtAt), date: fmt.date(model.builtAt) })}</time></p>
<nav class="lang" aria-label="${t('nav.language')}">${LANGUAGES.map((code) => (code === language ? html`<span lang="${code}" aria-current="true">${t(`lang.${code}`)}</span>` : html`<a lang="${code}" hreflang="${code}" href="${hrefOf(code)}">${t(`lang.${code}`)}</a>`))}</nav>
</header>
<main id="contenido" tabindex="-1">
${model.usingFallbackConfig ? html`<p class="notice" role="note">${t('site.fallback_config')}</p>` : ''}
${body}
</main>
<footer class="site-footer">
<p>${lastValid === undefined ? t('footer.no_measurement') : t('footer.fresh', { date: fmt.dateTime(lastValid) })}</p>
<p>${failing === '' ? t('footer.stores_ok') : t('footer.stores_failing', { stores: failing })}</p>
<p>${t('footer.last_run', { date: fmt.dateTime(model.builtAt) })}</p>
<p>${rate}</p>
${model.availability === null || model.availability === undefined ? '' : html`<p>${t('footer.availability', { value: fmt.percent(model.availability) })}</p>`}
<p>${model.openNotices === undefined || model.openNotices === 0 ? t('footer.notices_none') : t('footer.notices_open', { count: model.openNotices })}</p>
<p>${t('footer.currency')}</p>
<p>${t('footer.disclaimer')}</p>
</footer>
</body>
</html>
`}`;
}

/**
 * @param {RenderContext} ctx
 * @returns {string}
 */
export function homePage(ctx) {
  const { t, model } = ctx;
  const body =
    model.products.length === 0
      ? html`<h1>${t('home.empty.title')}</h1><p>${t('home.empty.text', { file: 'config/cuotear.yaml' })}</p>`
      : html`<h1>${t('home.title')}</h1><p class="lead">${t('site.tagline')}</p>${model.products.map(
          (view) => html`<article class="product" aria-labelledby="product-${view.id}">
<h2 id="product-${view.id}"><a href="p/${view.id}/">${view.nombre}</a></h2>
${headline(view, ctx)}
${Object.keys(view.urls).map((store) => storeTable({ view, store, ctx, detail: false }))}
<p><a href="p/${view.id}/">${t('product.details')}<span class="sr-only">: ${view.nombre}</span></a></p>
</article>`,
        )}`;
  return layout({ ctx, title: `${t('site.name')} — ${t('home.title')}`, description: t('site.tagline'), path: '', body });
}

/**
 * @param {string} serie
 * @param {RenderContext} ctx
 * @returns {string}
 */
function serieLabel(serie, { t }) {
  const card = cardOfSerie(serie);
  if (card === null) return t('option.contado');
  return t('series.card', { card: t(`card.${card}`), n: serie.slice(serie.indexOf(':') + 1) });
}

/**
 * @param {ProductView} view
 * @param {RenderContext} ctx
 */
function historySection(view, ctx) {
  const { t, fmt, model } = ctx;
  const label = (/** @type {string} */ store, /** @type {string} */ serie) => `${model.storeNames[store] ?? store} · ${serieLabel(serie, ctx)}`;
  const lastValidAt = new Map(view.records.flatMap((record) => (record.lastValidAt === undefined ? [] : [[`${record.store}/${record.serie}`, record.lastValidAt]])));
  const series = plotSeries(view.points, lastValidAt, label);

  const chart = hasEnoughPoints(series)
    ? html`<figure><section class="chart-scroll" aria-labelledby="chart-title" tabindex="0">${renderChart({
        series,
        title: t('chart.title', { product: view.nombre }),
        description: series
          .map((entry) => {
            const values = entry.runs.flatMap((run) => run.points.map((point) => point.v));
            return t('chart.desc_series', { label: entry.label, min: fmt.money(Math.min(...values)), max: fmt.money(Math.max(...values)), last: fmt.money(values.at(-1) ?? 0) });
          })
          .join(' '),
        money: fmt.money,
        shortDate: fmt.shortDate,
      })}</section><figcaption>${t('chart.caption')}</figcaption></figure>`
    : html`<p class="notice" role="note">${t('chart.insufficient')}</p>`;

  const rows = [...view.points].sort((a, b) => (a.t < b.t ? 1 : a.t > b.t ? -1 : a.serie < b.serie ? -1 : 1));
  const table =
    rows.length === 0
      ? html`<p>${t('table.empty')}</p>`
      : html`<section class="table-wrap" aria-labelledby="history-table-caption" tabindex="0"><table>
<caption id="history-table-caption">${t('table.caption', { product: view.nombre })}</caption>
<thead><tr><th scope="col">${t('table.date')}</th><th scope="col">${t('table.store')}</th><th scope="col">${t('table.series')}</th><th scope="col" class="num">${t('table.value')}</th><th scope="col">${t('table.state')}</th></tr></thead>
<tbody>${rows.map((point) => {
          const value = point.estado === 'ok' ? (point.serie === 'contado' ? point.valor : point.total) : undefined;
          return html`<tr><th scope="row"><time datetime="${point.t}">${fmt.dateTime(point.t)}</time></th><td>${model.storeNames[point.tienda] ?? point.tienda}</td><td>${serieLabel(point.serie, ctx)}</td><td class="num">${value === undefined ? html`<span aria-hidden="true">—</span><span class="sr-only">${t('cell.empty')}</span>` : fmt.money(value)}</td><td>${t(`point.${point.estado}`)}</td></tr>`;
        })}</tbody>
</table></section>`;

  return html`<section aria-labelledby="history-title"><h2 id="history-title">${t('detail.history')}</h2>${chart}${table}</section>`;
}

/**
 * @param {ProductView} view
 * @param {RenderContext} ctx
 * @returns {string}
 */
export function detailPage(view, ctx) {
  const { t } = ctx;
  const body = html`<nav aria-label="${t('nav.breadcrumb')}"><a href="../../">${t('product.back')}</a></nav>
<h1>${view.nombre}</h1>
${headline(view, ctx)}
${Object.keys(view.urls).map((store) => storeTable({ view, store, ctx, detail: true, level: 2 }))}
${historySection(view, ctx)}`;
  return layout({ ctx, title: `${view.nombre} — ${t('site.name')}`, description: t('site.tagline'), path: `p/${view.id}/`, body });
}

/**
 * @param {RenderContext} ctx
 * @returns {string}
 */
export function notFoundPage(ctx) {
  const { t } = ctx;
  return layout({ ctx, title: `${t('notfound.title')} — ${t('site.name')}`, description: t('site.tagline'), path: '404.html', body: html`<h1>${t('notfound.title')}</h1><p>${t('notfound.text')}</p>` });
}
