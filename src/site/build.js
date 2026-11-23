import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createTranslator } from '../i18n/index.js';
import { createFormatters } from './format.js';
import { detailPage, homePage, notFoundPage } from './pages.js';

/**
 * Static site generator (DRT 14.1, ADR-0011). es-AR only for now; the English
 * pages under `en/` arrive with the English catalog review (DRT F5).
 *
 * @typedef {Object} SiteModel
 * @property {Date} builtAt build time; "actualizado a las..." is generated from it (RNF-06)
 * @property {readonly import('../pipeline/view.js').ProductView[]} products
 * @property {import('../core/compare.js').MonthlyRate} rate
 * @property {0|1} s
 * @property {number} staleHours a value older than this is marked stale (S-30)
 * @property {number} marginalPct
 * @property {boolean} usingFallbackConfig the repository configuration is invalid (RF-19)
 * @property {Record<string, string>} storeNames store id -> display name (trusted, from the code)
 * @property {readonly string[]} failingStores stores with failed URLs in this run
 * @property {number | null} [availability] percent of the scheduled runs that succeeded in 30 days (DRT 18.3); null or absent when unknown
 * @property {number} [openNotices] open operational notices (DRT 18.4); the count only, never the technical detail
 */

const PRODUCT_ID = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/**
 * @param {string} file
 * @param {string} content
 */
function write(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/**
 * Replaces the contents of `outDir` with the site.
 * @param {SiteModel} model
 * @param {string} outDir
 */
export function buildSite(model, outDir) {
  const ctx = { t: createTranslator('es-AR'), fmt: createFormatters('es-AR'), model };
  for (const view of model.products) {
    if (!PRODUCT_ID.test(view.id)) throw new RangeError(`invalid product id: ${view.id}`);
  }

  rmSync(outDir, { recursive: true, force: true });
  write(join(outDir, 'index.html'), homePage(ctx));
  for (const view of model.products) write(join(outDir, 'p', view.id, 'index.html'), detailPage(view, ctx));
  write(join(outDir, '404.html'), notFoundPage(ctx));
  write(join(outDir, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  mkdirSync(join(outDir, 'assets'), { recursive: true });
  copyFileSync(new URL('./site.css', import.meta.url), join(outDir, 'assets', 'site.css'));
}
