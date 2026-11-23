import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeFetch, JSON_HEADERS } from './fake-http.js';

/**
 * Helpers for tests that run the whole pipeline in a temporary directory with
 * a fake fetch: nothing touches the repository or the network.
 */

export const PRODUCT_URL = 'https://www.oncity.com/smart-tv-qled-google-tcl-75--uhd-4k-3840-x-2160-75t6c-158450/p';
export const CATALOG_URL = `https://www.oncity.com/api/catalog_system/pub/products/search/${PRODUCT_URL.split('/').at(-2)}/p`;
export const ROBOTS_URL = 'https://www.oncity.com/robots.txt';

/** @returns {string} the On City catalog fixture (real capture of the TCL 75T6C) */
export const oncityFixture = () => readFileSync(new URL('../fixtures/oncity/tcl-75t6c.json', import.meta.url), 'utf8');

/**
 * The fixture with a cheaper one-payment debit line: only the cash series changes.
 * @param {number} price pesos
 * @returns {string}
 */
export function oncityFixtureWithCashPrice(price) {
  const products = /** @type {any[]} */ (JSON.parse(oncityFixture()));
  for (const line of products[0].items[0].sellers[0].commertialOffer.Installments) {
    if (line.NumberOfInstallments === 1 && /d[eé]bito|debit/i.test(line.PaymentSystemName)) {
      line.Value = price;
      line.TotalValuePlusInterestRate = price;
    }
  }
  return JSON.stringify(products);
}

/**
 * @param {string} [configText] defaults to the repository configuration
 * @returns {{ dir: string, configPath: string, statePath: string, dataDir: string, outDir: string }}
 */
export function workspace(configText = readFileSync(new URL('../../config/cuotear.yaml', import.meta.url), 'utf8')) {
  const dir = mkdtempSync(join(tmpdir(), 'cuotear-'));
  const configPath = join(dir, 'cuotear.yaml');
  writeFileSync(configPath, configText);
  return { dir, configPath, statePath: join(dir, 'state', 'state.json'), dataDir: join(dir, 'history'), outDir: join(dir, 'site') };
}

/**
 * Fake On City: robots.txt allows everything and the catalog serves `catalog`.
 * @param {{ catalog?: string, status?: number }} [reply]
 */
export function oncityFetch({ catalog = oncityFixture(), status = 200 } = {}) {
  return fakeFetch({
    [ROBOTS_URL]: { status: 200, body: 'User-agent: *\nAllow: /\n' },
    [CATALOG_URL]: status === 200 ? { status, body: catalog, headers: JSON_HEADERS } : { status, body: 'Forbidden' },
  });
}

/**
 * Options of `runPipeline` for a workspace, with a fast fake HTTP layer.
 * @param {ReturnType<typeof workspace>} space
 * @param {ReturnType<typeof oncityFetch>} fetcher
 * @param {{ now?: Date, lines?: string[] }} [extra]
 * @returns {import('../../src/pipeline/run-pipeline.js').RunOptions}
 */
export function runOptions(space, fetcher, { now = new Date('2026-11-22T12:17:41Z'), lines = [] } = {}) {
  return {
    configPath: space.configPath,
    statePath: space.statePath,
    dataDir: space.dataDir,
    outDir: space.outDir,
    http: { fetchImpl: fetcher.impl, sleep: async () => {}, minIntervalMs: 0, retryDelayMs: 0 },
    clock: () => now,
    log: (line) => lines.push(line),
  };
}
