import { html } from './html.js';

/**
 * Step chart as server-side SVG (DRT 14.3, RF-17, RNF-08, S-30).
 *
 * The history only records changes, so each value is held (a horizontal
 * line) until the next point, and the last value is held up to the last valid
 * measurement of the series, never beyond. A run is a stretch of consecutive
 * `ok` points; a point of any other state ends the run at its own time.
 * Series are told apart by stroke pattern and marker shape as well as by
 * color (WCAG 1.4.1), and a visible table repeats every point.
 *
 * @typedef {import('../core/history.js').HistoryPoint} HistoryPoint
 *
 * @typedef {Object} PlotRun
 * @property {{ t: number, v: number }[]} points time (ms) and value (centavos) of each `ok` point
 * @property {number} end time (ms) the last value is held until
 *
 * @typedef {Object} PlotSeries
 * @property {string} key `<store>/<serie>`
 * @property {string} label
 * @property {PlotRun[]} runs
 */

export const STYLE_COUNT = 4;
const WIDTH = 720;
const HEIGHT = 360;
const MARGIN = { top: 16, right: 20, bottom: 44, left: 92 };
const DAY_MS = 86_400_000;

/**
 * Value plotted for a point: the cash price, or the card total.
 * @param {HistoryPoint} point
 * @returns {number | undefined}
 */
const valueOf = (point) => (point.serie === 'contado' ? point.valor : point.total);

/**
 * @param {readonly HistoryPoint[]} points history of a product
 * @param {ReadonlyMap<string, string>} lastValidAt last valid measurement by `<store>/<serie>`
 * @param {(store: string, serie: string) => string} labelOf
 * @returns {PlotSeries[]} series with at least one `ok` point, in a stable order
 */
export function plotSeries(points, lastValidAt, labelOf) {
  /** @type {Map<string, HistoryPoint[]>} */
  const groups = new Map();
  for (const point of [...points].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0))) {
    const key = `${point.tienda}/${point.serie}`;
    groups.set(key, [...(groups.get(key) ?? []), point]);
  }

  /** @type {PlotSeries[]} */
  const series = [];
  for (const [key, group] of [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    /** @type {PlotRun[]} */
    const runs = [];
    /** @type {PlotRun | null} */
    let run = null;
    for (const [index, point] of group.entries()) {
      const value = valueOf(point);
      const time = Date.parse(point.t);
      if (point.estado === 'ok' && value !== undefined) {
        run ??= { points: [], end: time };
        run.points.push({ t: time, v: value });
        const next = group[index + 1];
        if (next !== undefined) run.end = Date.parse(next.t);
        else run.end = Math.max(time, Date.parse(lastValidAt.get(key) ?? point.t));
        if (next !== undefined && next.estado !== 'ok') {
          runs.push(run);
          run = null;
        }
      } else if (run !== null) {
        runs.push(run);
        run = null;
      }
    }
    if (run !== null) runs.push(run);
    const first = group[0];
    if (runs.length > 0 && first !== undefined) series.push({ key, label: labelOf(first.tienda, first.serie), runs });
  }
  return series;
}

/**
 * A chart needs at least one series with two points (RF-17).
 * @param {readonly PlotSeries[]} series
 * @returns {boolean}
 */
export const hasEnoughPoints = (series) => series.some((entry) => entry.runs.reduce((count, run) => count + run.points.length, 0) >= 2);

/** @param {number} value */
const fixed = (value) => value.toFixed(1);

/**
 * Marker of a point; the shape depends on the series style.
 * @param {number} style
 * @param {number} x
 * @param {number} y
 */
function marker(style, x, y) {
  const shape = style % STYLE_COUNT;
  const cls = `mk s${shape}`;
  if (shape === 0) return html`<circle class="${cls}" cx="${fixed(x)}" cy="${fixed(y)}" r="4" />`;
  if (shape === 1) return html`<rect class="${cls}" x="${fixed(x - 4)}" y="${fixed(y - 4)}" width="8" height="8" />`;
  if (shape === 2) return html`<polygon class="${cls}" points="${fixed(x)},${fixed(y - 5.5)} ${fixed(x - 5)},${fixed(y + 4)} ${fixed(x + 5)},${fixed(y + 4)}" />`;
  return html`<polygon class="${cls}" points="${fixed(x)},${fixed(y - 5.5)} ${fixed(x + 5.5)},${fixed(y)} ${fixed(x)},${fixed(y + 5.5)} ${fixed(x - 5.5)},${fixed(y)}" />`;
}

/**
 * Legend swatch: the same stroke and marker as the series.
 * @param {number} style
 */
function swatch(style) {
  return html`<svg class="swatch" viewBox="0 0 32 12" width="32" height="12" aria-hidden="true" focusable="false"><line class="line s${style % STYLE_COUNT}" x1="0" y1="6" x2="32" y2="6" />${marker(style, 16, 6)}</svg>`;
}

/**
 * @param {{
 *   series: readonly PlotSeries[],
 *   title: string,
 *   description: string,
 *   money: (cents: number) => string,
 *   shortDate: (ms: number) => string,
 * }} input
 * @returns {import('./html.js').SafeHtml} the `<svg>` followed by a textual legend (the caller wraps it in a horizontally
 * scrollable region: the SVG keeps a minimum width so its text stays legible, WCAG 1.4.4/1.4.10)
 */
export function renderChart({ series, title, description, money, shortDate }) {
  const values = series.flatMap((entry) => entry.runs.flatMap((run) => run.points.map((point) => point.v)));
  const times = series.flatMap((entry) => entry.runs.flatMap((run) => [...run.points.map((point) => point.t), run.end]));
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const padding = highest === lowest ? lowest * 0.02 : (highest - lowest) * 0.08;
  const yMin = lowest - padding;
  const yMax = highest + padding;
  const xMin = Math.min(...times);
  const xMax = Math.max(Math.max(...times), xMin + DAY_MS);

  const innerWidth = WIDTH - MARGIN.left - MARGIN.right;
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (/** @type {number} */ t) => MARGIN.left + ((t - xMin) / (xMax - xMin)) * innerWidth;
  const y = (/** @type {number} */ v) => MARGIN.top + (1 - (v - yMin) / (yMax - yMin)) * innerHeight;

  const yTicks = [0, 1, 2, 3].map((index) => yMin + ((yMax - yMin) * index) / 3);
  const xTicks = [xMin, xMin + (xMax - xMin) / 2, xMax];

  const lines = series.flatMap((entry, style) =>
    entry.runs.map((run) => {
      const [first, ...rest] = run.points;
      if (first === undefined) return '';
      const steps = rest.map((point) => `H${fixed(x(point.t))} V${fixed(y(point.v))}`).join(' ');
      const d = `M${fixed(x(first.t))} ${fixed(y(first.v))} ${steps} H${fixed(x(run.end))}`;
      return html`<path class="line s${style % STYLE_COUNT}" d="${d}" />`;
    }),
  );
  const markers = series.flatMap((entry, style) => entry.runs.flatMap((run) => run.points.map((point) => marker(style, x(point.t), y(point.v)))));

  return html`<svg class="chart" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="chart-title chart-desc">
<title id="chart-title">${title}</title>
<desc id="chart-desc">${description}</desc>
<g class="grid">${yTicks.map((tick) => html`<line x1="${MARGIN.left}" x2="${WIDTH - MARGIN.right}" y1="${fixed(y(tick))}" y2="${fixed(y(tick))}" />`)}</g>
<g class="axis">${yTicks.map((tick) => html`<text x="${MARGIN.left - 8}" y="${fixed(y(tick) + 4)}" text-anchor="end">${money(Math.round(tick))}</text>`)}${xTicks.map((tick, index) => html`<text x="${fixed(x(tick))}" y="${HEIGHT - 16}" text-anchor="${index === 0 ? 'start' : index === 2 ? 'end' : 'middle'}">${shortDate(tick)}</text>`)}</g>
<g>${lines}</g>
<g>${markers}</g>
</svg>
<ul class="legend">${series.map((entry, style) => html`<li>${swatch(style)}<span>${entry.label}</span></li>`)}</ul>`;
}
