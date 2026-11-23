import { lastOkPoint } from '../core/history.js';
import { CARDS } from '../stores/types.js';
import { externalHref, html } from './html.js';

/**
 * Presentation of one product: the verdict headline and one table per store
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
 * @param {ProductView} view
 * @param {RenderContext} ctx
 */
export function headline(view, { t, fmt, model }) {
  const { comparison } = view;
  const storeName = (/** @type {string} */ id) => model.storeNames[id] ?? id;
  const { best } = comparison;
  if (best === null) {
    return html`<p class="headline"><span class="badge badge-none">${t('verdict.sin_veredicto')}</span> ${model.rate.r === null ? t('product.reason_rate') : t('product.reason_data')}</p>`;
  }
  const text = best.tipo === 'contado' ? t('product.headline.contado', { store: storeName(best.store) }) : t('product.headline.cuotas', { store: storeName(best.store), card: t(`card.${best.card}`), n: best.n });
  const detail =
    comparison.pcStarCents !== null && comparison.vpStarCents !== null && comparison.difVpPct !== null
      ? t('product.compare', { pc: fmt.money(comparison.pcStarCents), vp: fmt.money(Math.round(comparison.vpStarCents)), dif: fmt.signedPercent(comparison.difVpPct) })
      : '';
  return html`<p class="headline"><span class="badge badge-${best.tipo}">${t(`verdict.${comparison.verdict}`)}</span> ${comparison.marginal ? html`<span class="tag">${t('verdict.marginal')}</span> ` : ''}<strong>${text}</strong><br /><span class="note">${detail}</span></p>`;
}

/**
 * Cell of a series that has no usable number: never an invented value (RF-17).
 * @param {SeriesRecord | undefined} record
 * @param {RenderContext} ctx
 */
function noNumber(record, { t }) {
  return html`<span class="state">${record?.status === 'sin_stock' ? t('status.sin_stock') : t('status.sin_datos')}</span>`;
}

/**
 * @param {{ record: SeriesRecord | undefined, point: import('../core/history.js').HistoryPoint | undefined, value: import('./html.js').SafeHtml, ctx: RenderContext }} input
 */
function priceCell({ record, point, value, ctx }) {
  const { t, fmt, model } = ctx;
  if (record === undefined || point === undefined || (record.status !== 'valida' && record.status !== 'fallida')) return noNumber(record, ctx);
  const stale = isStale(record, model);
  return html`${value}<span class="note">${t('cell.measured', { date: fmt.dateTime(record.lastValidAt ?? point.t) })}</span>${record.status === 'fallida' ? html`<span class="tag tag-warn">${t('state.failed')}</span>` : ''}${stale ? html`<span class="tag tag-warn">${t('state.stale')}</span>` : ''}`;
}

/**
 * @param {import('../core/compare.js').OptionComparison | null | undefined} comparison
 * @param {RenderContext} ctx
 */
function verdictCell(comparison, { t }) {
  if (comparison === null || comparison === undefined) return html`<span aria-hidden="true">—</span><span class="sr-only">${t('cell.empty')}</span>`;
  return html`<span class="badge badge-${comparison.verdict}">${t(`verdict.${comparison.verdict}`)}</span>${comparison.marginal ? html` <span class="tag">${t('verdict.marginal')}</span>` : ''}`;
}

/**
 * @param {import('../core/compare.js').OptionComparison | null | undefined} comparison
 * @param {RenderContext} ctx
 */
function differenceCells(comparison, { t, fmt }) {
  if (comparison === null || comparison === undefined) {
    const empty = html`<span aria-hidden="true">—</span><span class="sr-only">${t('cell.empty')}</span>`;
    return html`<td class="num">${empty}</td><td class="num">${empty}</td>`;
  }
  const vp = comparison.vpCents === null || comparison.difVpPct === null ? html`—` : html`${fmt.money(Math.round(comparison.vpCents))}<span class="note">${fmt.signedPercent(comparison.difVpPct)}</span>`;
  return html`<td class="num">${fmt.signedMoney(comparison.difCents)}<span class="note">${fmt.signedPercent(comparison.difPct)}</span></td><td class="num">${vp}</td>`;
}

/**
 * Table of one store: the cash price and the interest-free option of each card.
 * @param {{ view: ProductView, store: string, ctx: RenderContext, detail: boolean }} input
 */
export function storeTable({ view, store, ctx, detail }) {
  const { t, fmt, model } = ctx;
  const records = view.records.filter((record) => record.store === store);
  const storeComparison = view.comparison.stores.find((entry) => entry.store === store);
  const { best } = view.comparison;
  const name = model.storeNames[store] ?? store;
  const href = externalHref(view.urls[store] ?? '');

  const contado = records.find((record) => record.serie === 'contado');
  const contadoPoint = contado === undefined ? undefined : lastOkPoint(view.points, store, 'contado');
  const contadoBest = best?.tipo === 'contado' && best.store === store;

  /** @type {import('./html.js').SafeHtml[]} */
  const rows = [
    html`<tr${contadoBest ? html` class="is-best"` : ''}><th scope="row">${t('option.contado')}</th><td>${priceCell({
      record: contado,
      point: contadoPoint,
      value: contadoPoint === undefined ? html`` : html`<strong class="price">${fmt.money(contadoPoint.valor ?? 0)}</strong><span class="note">${conditionText(contadoPoint, ctx)}</span>`,
      ctx,
    })}</td><td>${contadoBest ? html`<strong class="best">${t('tag.best')}</strong>` : html`<span aria-hidden="true">—</span><span class="sr-only">${t('cell.empty')}</span>`}</td>${detail ? html`<td class="num"><span aria-hidden="true">—</span><span class="sr-only">${t('cell.empty')}</span></td><td class="num"><span aria-hidden="true">—</span><span class="sr-only">${t('cell.empty')}</span></td>` : ''}</tr>`,
  ];

  for (const card of CARDS) {
    const record = records.find((entry) => entry.serie.startsWith(`${card}:`) && entry.status !== 'cerrada');
    const point = record === undefined ? undefined : lastOkPoint(view.points, store, record.serie);
    const offer = storeComparison?.cards.find((entry) => entry.card === card);
    const isBest = best?.tipo === 'cuotas' && best.store === store && best.card === card && point?.n === best.n;
    const value =
      point?.n === undefined || point.cuota === undefined || point.total === undefined
        ? html``
        : html`<strong class="price">${t('cell.installments', { n: point.n, cuota: fmt.money(point.cuota) })}</strong><span class="note">${t('cell.total', { total: fmt.money(point.total) })}</span>`;
    const comparison = record?.eligible ? offer?.comparison : null;
    rows.push(
      html`<tr${isBest ? html` class="is-best"` : ''}><th scope="row">${t(`card.${card}`)}</th><td>${priceCell({ record, point, value, ctx })}</td><td>${isBest ? html`<strong class="best">${t('tag.best')}</strong> ` : ''}${verdictCell(comparison, ctx)}</td>${detail ? differenceCells(comparison, ctx) : ''}</tr>`,
    );
  }

  return html`<section class="store" aria-labelledby="store-${view.id}-${store}">
<h3 id="store-${view.id}-${store}">${name}${href === null ? '' : html` <a class="store-link" href="${href}" rel="noopener noreferrer">${t('store.open', { store: name })}</a>`}</h3>
<div class="table-wrap"><table>
<caption class="sr-only">${name}</caption>
<thead><tr><th scope="col">${t('col.option')}</th><th scope="col">${t('col.price')}</th><th scope="col">${t('col.verdict')}</th>${detail ? html`<th scope="col" class="num">${t('col.dif')}</th><th scope="col" class="num">${t('col.vp')}</th>` : ''}</tr></thead>
<tbody>${rows}</tbody>
</table></div>
</section>`;
}
