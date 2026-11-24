/**
 * Operational causes detected in a run (DRT 13.6, RNF-15). Pure: it only
 * reads the per-store reports and returns the cause keys. Turning them into
 * GitHub issues is a later phase (`src/notify/ops-issues.js`).
 */

export const ALL_STORES_FAIL = 'todas-tiendas-fallan';
export const ROBOTS_PREFIX = 'robots:';

/**
 * @param {readonly import('./measure.js').StoreReport[]} reports
 * @returns {string[]} sorted, unique cause keys
 */
export function computeCauses(reports) {
  const causes = new Set();
  for (const report of reports) {
    if ((report.failures.robots ?? 0) > 0) causes.add(`${ROBOTS_PREFIX}${report.store}`);
  }
  const measured = reports.reduce((sum, report) => sum + report.urls, 0);
  const failedUrls = reports.reduce((sum, report) => sum + (report.outcomes.falla ?? 0), 0);
  if (measured > 0 && failedUrls === measured) causes.add(ALL_STORES_FAIL);
  return [...causes].sort();
}

/**
 * Fixed, neutral text per cause: never downloaded content.
 * @param {string} cause
 * @returns {string}
 */
export function causeText(cause) {
  if (cause === ALL_STORES_FAIL) return 'every measured URL failed; the site keeps the previous data';
  if (cause.startsWith(ROBOTS_PREFIX)) return 'robots.txt forbids, or could not be read for, a configured URL of this store; no product request was made';
  const fixed = /** @type {Record<string, string>} */ ({
    'secretos-canal': 'the alert channel secrets are missing or invalid (or Telegram rejected the token); no alert is sent',
    'config-invalida': 'the repository configuration is invalid; the last valid configuration is used',
    'config-ausente': 'there is no valid configuration; nothing is measured or published',
    'commit-conflicto': 'the history commit could not be pushed; the next run recomputes it',
    'historial-45mb': 'the history is at 45 MB or more; the limit is soft up to 100 MB',
    'historial-100mb': 'the history is above 100 MB; new points are no longer persisted until it shrinks',
    inactividad: 'the repository has no commits for more than 45 days; scheduled runs may be suspended',
    disponibilidad: 'the availability of the scheduled runs in the last 30 days is below 95 %',
  });
  return fixed[cause] ?? 'operational notice';
}
