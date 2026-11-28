import { lastOkPoint } from '../core/history.js';
import { CARDS } from '../stores/types.js';
import { externalHref, html } from './html.js';

/**
 * Presentation of one product: the verdict hero and one list of offers per store
 * (RF-17, RF-20, RF-21, RN-06, S-30). Every dynamic text goes through the
 * escaping `html` tag; downloaded text never reaches this module (only
 * numbers, enumerations and the product name of the configuration).
 *
 * @typedef {import('./build.js').SiteModel} SiteModel
 * @typedef {import('../pipeline/view.js').ProductView} ProductView
 * @typedef {import('../core/record.js').SeriesRecord} SeriesRecord
 *
 * @typedef {Object} RenderContext
 * @property {import('../i18n/index.js').Translator} t
 * @property {import('./format.js').Formatters} fmt
 * @property {SiteModel} model
 * @property {import('../i18n/index.js').Language} language language of the page being rendered
 */

const HOUR_MS = 3_600_000;

/**
 * Stale value (S-30): the last valid measurement is more than `staleHours` old.
 * @param {SeriesRecord} record
 * @param {SiteModel} model
 * @returns {boolean}
 */
export function isStale(record, model) {
  return record.lastValidAt !== undefined && model.builtAt.getTime() - Date.parse(record.lastValidAt) > model.staleHours * HOUR_MS;
}

/**
 * Cash condition generated from structured data (S-34).
 * @param {import('../core/history.js').HistoryPoint} point
 * @param {RenderContext} ctx
 * @returns {string}
 */
function conditionText(point, { t, fmt }) {
  const medio = point.medio ?? 'ninguno';
  if (medio === 'ninguno') return t('condition.ninguno');
  const suffix = point.desc !== null && point.desc !== undefined && point.desc > 0 ? t('condition.con_descuento', { pct: fmt.percent(point.desc) }) : t('condition.sin_descuento');
  return `${t(`condition.${medio}`)}, ${suffix}`;
}

/**
 * Verdict modifier of a product card (`v-cuotas`, `v-contado`, `v-none`).
 * @param {ProductView} view
 * @returns {'cuotas' | 'contado' | 'none'}
 */
export function verdictClass(view) {
  const { best, verdict } = view.comparison;
  if (best === null) return 'none';
  return verdict === 'cuotas' || verdict === 'contado' ? verdict : best.tipo;
}

/**
 * Verdict hero: badge, best option and the three key figures.
 * @param {ProductView} view
 * @param {RenderContext} ctx
 */
export function headline(view, { t, fmt, model }) {
  const { comparison } = view;
  const storeName = (/** @type {string} */ id) => model.storeNames[id] ?? id;
  const { best } = comparison;
  if (best === null) {
    return html`<div class="verdict"><p class="verdict-flags"><span class="badge badge-none">${t('verdict.sin_veredicto')}</span></p><p class="verdict-reason">${model.rate.r === null ? t('product.reason_rate') : t('product.reason_data')}</p></div>`;
  }
  const text = best.tipo === 'contado' ? t('product.best.contado', { store: storeName(best.store) }) : t('product.best.cuotas', { store: storeName(best.store), card: t(`card.${best.card}`) });
  const installments = best.tipo === 'contado' ? '' : html`<span class="note">${t('product.best.n', { n: best.n })}</span>`;
  const figures =
    comparison.pcStarCents !== null && comparison.vpStarCents !== null && comparison.difVpPct !== null
      ? html`<dl class="figures"><div><dt>${t('product.fig.cash')}</dt><dd>${fmt.money(comparison.pcStarCents)}</dd></div><div><dt>${t('product.fig.pv')}</dt><dd>${fmt.money(Math.round(comparison.vpStarCents))}</dd></div><div class="figure-key"><dt>${t('product.fig.dif')}</dt><dd>${fmt.signedPercent(comparison.difVpPct)}</dd></div></dl>`
      : '';
  return html`<div class="verdict"><p class="verdict-flags"><span class="badge badge-${best.tipo}">${t(`verdict.${comparison.verdict}`)}</span>${comparison.marginal ? html` <span class="tag">${t('verdict.marginal')}</span>` : ''}</p><p class="verdict-best"><strong>${text}</strong>${installments}</p>${figures}</div>`;
}

/**
 * Marker of a figure that is absent inside an offer that has data (RF-17).
 * @param {RenderContext} ctx
 */
function dash({ t }) {
  return html`<span aria-hidden="true">—</span><span class="sr-only">${t('cell.empty')}</span>`;
}

/**
 * One offer of a store. Without data it collapses to its name and a state; the
 * best offer is marked with text, not only with colour.
 * @param {{ name: string, record: SeriesRecord | undefined, point: import('../core/history.js').HistoryPoint | undefined, price: import('./html.js').SafeHtml, isBest: boolean, comparison?: import('../core/compare.js').OptionComparison | null, figures?: boolean, storeMeasured: string | undefined, ctx: RenderContext }} input
 */
function offer({ name, record, point, price, isBest, comparison = null, figures = false, storeMeasured, ctx }) {
  const { t, fmt, model } = ctx;
  if (record === undefined || point === undefined || (record.status !== 'valida' && record.status !== 'fallida')) {
    return html`<li class="offer is-empty"><p class="offer-head"><span class="offer-name">${name}</span> <span class="state">${record?.status === 'sin_stock' ? t('status.sin_stock') : t('status.sin_datos')}</span></p></li>`;
  }
  const measuredAt = record.lastValidAt ?? point.t;
  const stale = isStale(record, model);
  const flags = html`${isBest ? html`<strong class="best">${t('tag.best')}</strong> ` : ''}${comparison === null ? '' : html`<span class="badge badge-${comparison.verdict}">${t(`verdict.${comparison.verdict}`)}</span>${comparison.marginal ? html` <span class="tag">${t('verdict.marginal')}</span>` : ''}`}`;
  const vp = comparison === null || comparison.vpCents === null || comparison.difVpPct === null ? dash(ctx) : html`${fmt.money(Math.round(comparison.vpCents))} <span class="note">${fmt.signedPercent(comparison.difVpPct)}</span>`;
  const detail =
    figures === false
      ? ''
      : comparison === null
        ? html`<dl class="figures figures-sm"><div><dt>${t('col.dif')}</dt><dd>${dash(ctx)}</dd></div><div><dt>${t('col.vp')}</dt><dd>${dash(ctx)}</dd></div></dl>`
        : html`<dl class="figures figures-sm"><div><dt>${t('col.dif')}</dt><dd>${fmt.signedMoney(comparison.difCents)} <span class="note">${fmt.signedPercent(comparison.difPct)}</span></dd></div><div><dt>${t('col.vp')}</dt><dd>${vp}</dd></div></dl>`;
  return html`<li class="offer${isBest ? ' is-best' : ''}"><p class="offer-head"><span class="offer-name">${name}</span><span class="offer-flags">${flags}</span></p><div class="offer-body">${price}${measuredAt === storeMeasured ? '' : html`<p class="note">${t('cell.measured', { date: fmt.dateTime(measuredAt) })}</p>`}${record.status === 'fallida' ? html`<p><span class="tag tag-warn">${t('state.failed')}</span></p>` : ''}${stale ? html`<p><span class="tag tag-warn">${t('state.stale')}</span></p>` : ''}</div>${detail}</li>`;
}

/**
 * Offers of one store: the cash price and the interest-free option of each card.
 * @param {{ view: ProductView, store: string, ctx: RenderContext, detail: boolean, level?: 2 | 3 }} input `level` is the heading level of the store (h3 under a product h2 on the home, h2 under the h1 on the detail page)
 */
export function storeOffers({ view, store, ctx, detail, level = 3 }) {
  const { t, fmt, model } = ctx;
  const records = view.records.filter((record) => record.store === store);
  const storeComparison = view.comparison.stores.find((entry) => entry.store === store);
  const { best } = view.comparison;
  const name = model.storeNames[store] ?? store;
  const href = externalHref(view.urls[store] ?? '');
  const storeMeasured = records.map((record) => record.lastValidAt ?? '').filter((value) => value !== '').sort().at(-1);

  const contado = records.find((record) => record.serie === 'contado');
  const contadoPoint = contado === undefined ? undefined : lastOkPoint(view.points, store, 'contado');
  const contadoBest = best?.tipo === 'contado' && best.store === store;

  const items = [
    offer({
      name: t('option.contado'),
      record: contado,
      point: contadoPoint,
      price: contadoPoint === undefined ? html`` : html`<p class="offer-price"><strong class="price">${fmt.money(contadoPoint.valor ?? 0)}</strong></p><p class="note">${conditionText(contadoPoint, ctx)}</p>`,
      isBest: contadoBest,
      storeMeasured,
      ctx,
    }),
  ];

  for (const card of CARDS) {
    const record = records.find((entry) => entry.serie.startsWith(`${card}:`) && entry.status !== 'cerrada');
    const point = record === undefined ? undefined : lastOkPoint(view.points, store, record.serie);
    const entry = storeComparison?.cards.find((candidate) => candidate.card === card);
    const isBest = best?.tipo === 'cuotas' && best.store === store && best.card === card && point?.n === best.n;
    const price =
      point?.n === undefined || point.cuota === undefined || point.total === undefined
        ? html``
        : html`<p class="offer-price"><span class="offer-label">${t('cell.installments_label', { n: point.n })}</span> <strong class="price">${fmt.money(point.cuota)}</strong></p><p class="note">${t('cell.total', { total: fmt.money(point.total) })}</p>`;
    items.push(offer({ name: t(`card.${card}`), record, point, price, isBest, comparison: record?.eligible ? (entry?.comparison ?? null) : null, figures: detail, storeMeasured, ctx }));
  }

  const nameId = `store-${view.id}-${store}`;
  const heading = html`<span id="${nameId}">${name}</span>${href === null ? '' : html` <a class="store-link" href="${href}" rel="noopener noreferrer">${t('store.open', { store: name })}</a>`}`;
  return html`<section class="store" aria-labelledby="${nameId}">
${level === 2 ? html`<h2>${heading}</h2>` : html`<h3>${heading}</h3>`}
${storeMeasured === undefined ? '' : html`<p class="store-meta note">${t('cell.measured', { date: fmt.dateTime(storeMeasured) })}</p>`}
<ul class="offers" aria-label="${t('store.table', { store: name })}">${items}</ul>
</section>`;
}
