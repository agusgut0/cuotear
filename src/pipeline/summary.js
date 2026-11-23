import { causeText } from './ops-causes.js';

/**
 * Run summary (DRT 18.2): printed to the log and, in GitHub Actions, appended
 * to `$GITHUB_STEP_SUMMARY`. It never contains downloaded text.
 *
 * @typedef {Object} RunSummary
 * @property {boolean} dryRun
 * @property {'repo'|'fallback'} configKind
 * @property {number} products
 * @property {import('../core/compare.js').MonthlyRate} rate
 * @property {0|1} s
 * @property {import('./measure.js').StoreReport[]} stores
 * @property {string[]} avisos operational causes detected in this run (RNF-15)
 * @property {number} pointsAdded
 * @property {number} pointsPurged
 * @property {number} seriesOpened
 * @property {number} seriesClosed
 * @property {number} filesWritten
 * @property {number} filesRemoved
 * @property {number} requests network requests, robots.txt included
 * @property {number} durationMs
 * @property {boolean} stateRebuilt
 */

/**
 * @param {number} ms
 * @returns {string}
 */
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

/**
 * @param {import('../core/compare.js').MonthlyRate} rate
 * @param {0|1} s
 * @returns {string}
 */
function rateText(rate, s) {
  return rate.r === null ? 'none (no verdict, nominal comparison only)' : `${(rate.r * 100).toFixed(3)} % monthly (${rate.origin}), first installment in month ${s}`;
}

/**
 * @param {import('./measure.js').StoreReport} report
 * @returns {string}
 */
function outcomesText(report) {
  const outcomes = Object.entries(report.outcomes).map(([name, count]) => `${name}=${count}`);
  const failures = Object.entries(report.failures).map(([kind, count]) => `${kind}=${count}`);
  return `${outcomes.join(' ')}${failures.length > 0 ? ` (failures: ${failures.join(' ')})` : ''}`;
}

/**
 * @param {RunSummary} summary
 * @returns {string[]}
 */
export function summaryLines(summary) {
  return [
    `[cuotear] run summary${summary.dryRun ? ' (dry run: no history written, no state saved)' : ''}`,
    `[cuotear] config: ${summary.configKind === 'repo' ? 'repository file' : 'last valid configuration (the repository file is invalid)'}, ${summary.products} product(s)`,
    `[cuotear] inflation: ${rateText(summary.rate, summary.s)}`,
    ...(summary.stateRebuilt ? ['[cuotear] state: rebuilt (failure counters restarted)'] : []),
    ...summary.avisos.map((cause) => `[cuotear] notice ${cause}: ${causeText(cause)}`),
    ...summary.stores.map((report) => `[cuotear] store ${report.store}: ${report.urls} URL(s), ${outcomesText(report)}, ${report.requests} request(s), ${report.ms} ms`),
    `[cuotear] history: +${summary.pointsAdded} point(s), -${summary.pointsPurged} purged, ${summary.seriesOpened} series opened, ${summary.seriesClosed} closed, ${summary.filesWritten} file(s) written, ${summary.filesRemoved} removed`,
    `[cuotear] requests: ${summary.requests} (robots.txt included), duration ${seconds(summary.durationMs)}`,
  ];
}

/**
 * @param {RunSummary} summary
 * @returns {string} GitHub-flavoured markdown
 */
export function summaryMarkdown(summary) {
  const rows = summary.stores.map((report) => `| ${report.store} | ${report.urls} | ${outcomesText(report)} | ${report.requests} | ${report.ms} |`);
  return [
    `## cuotear run${summary.dryRun ? ' (dry run)' : ''}`,
    '',
    `- Configuration: ${summary.configKind === 'repo' ? 'repository file' : '**last valid configuration** (the repository file is invalid)'}, ${summary.products} product(s)`,
    `- Inflation: ${rateText(summary.rate, summary.s)}`,
    ...(summary.stateRebuilt ? ['- State: rebuilt (failure counters restarted)'] : []),
    `- History: +${summary.pointsAdded} point(s), -${summary.pointsPurged} purged, ${summary.seriesOpened} series opened, ${summary.seriesClosed} closed, ${summary.filesWritten} file(s) written`,
    `- Requests: ${summary.requests} (robots.txt included), duration ${seconds(summary.durationMs)}`,
    '',
    '| Store | URLs | Outcomes | Requests | ms |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    ...(summary.avisos.length > 0 ? ['### Operational notices', '', '| Cause | Detail |', '| --- | --- |', ...summary.avisos.map((cause) => `| \`${cause}\` | ${causeText(cause)} |`), ''] : []),
  ].join('\n');
}
