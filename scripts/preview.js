import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { runPipeline } from '../src/pipeline/run-pipeline.js';
import { stores } from '../src/stores/index.js';
import { fakeFetch, HTML_HEADERS, JSON_HEADERS } from '../test/helpers/fake-http.js';
import { CATALOG_URL, oncityFixture, oncityFixtureWithCashPrice, PRODUCT_URL, ROBOTS_URL, workspace } from '../test/helpers/pipeline.js';

/**
 * Builds the static site from the recorded fixtures (no network, nothing
 * written outside a temporary workspace and the output directory) and
 * optionally serves it.
 *
 * `node scripts/preview.js [--out dist/preview] [--serve] [--port 4173]`
 *
 * Two runs are simulated, three days apart, so the history has a price drop
 * and the site shows a series with a change.
 */

const MEGATONE_URL = 'https://www.megatone.net/producto/televisor-tcl-75t6c-qled-75-4k-uhd-google-tv-dlg-120hz_MKT028PMTP/';
const ALLOW_ALL = 'User-agent: *\nAllow: /\n';
const MIME = /** @type {Record<string, string>} */ ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.png': 'image/png', '.ico': 'image/x-icon' });

/** @returns {number} pesos of the one-payment debit line of the fixture */
function fixtureCashPrice() {
  const products = /** @type {any[]} */ (JSON.parse(oncityFixture()));
  const line = products[0].items[0].sellers[0].commertialOffer.Installments.find((/** @type {any} */ item) => item.NumberOfInstallments === 1 && /d[eé]bito|debit/i.test(item.PaymentSystemName));
  return Number(line.Value);
}

/** @param {string} oncityBody */
const fetcher = (oncityBody) =>
  fakeFetch({
    [ROBOTS_URL]: { status: 200, body: ALLOW_ALL },
    [CATALOG_URL]: { status: 200, body: oncityBody, headers: JSON_HEADERS },
    'https://www.megatone.net/robots.txt': { status: 200, body: ALLOW_ALL },
    [MEGATONE_URL]: { status: 200, body: readFileSync(new URL('../test/fixtures/megatone/tcl-75t6c.html', import.meta.url), 'utf8'), headers: HTML_HEADERS },
  });

/** @param {string} outDir */
async function build(outDir) {
  const base = readFileSync(new URL('../config/cuotear.yaml', import.meta.url), 'utf8');
  const space = workspace(`${base}      megatone: ${MEGATONE_URL}\n`);
  const registry = ['oncity', 'megatone'].map((id) => /** @type {import('../src/stores/index.js').StoreRegistration} */ (stores.find((store) => store.id === id)));
  const finalNow = new Date();
  const earlier = new Date(finalNow.getTime() - 3 * 24 * 3600 * 1000);

  /** @param {string} body @param {Date} now @param {boolean} last */
  const run = async (body, now, last) => {
    const lines = /** @type {string[]} */ ([]);
    await runPipeline({
      configPath: space.configPath,
      statePath: space.statePath,
      dataDir: space.dataDir,
      outDir: last ? outDir : space.outDir,
      registry,
      http: { fetchImpl: fetcher(body).impl, sleep: async () => {}, minIntervalMs: 0, retryDelayMs: 0, now: () => now.getTime() },
      clock: () => now,
      log: (line) => lines.push(line),
    });
    return lines;
  };

  await run(oncityFixtureWithCashPrice(Math.round(fixtureCashPrice() * 1.1)), earlier, false);
  await run(oncityFixture(), finalNow, true);
  console.log(`preview: site built in ${outDir} (${PRODUCT_URL.split('/')[2]} and megatone fixtures, simulated price drop)`);
}

/** @param {string} root @param {number} port */
function serve(root, port) {
  const base = resolve(root);
  createServer((request, response) => {
    const path = normalize(decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/'));
    let file = join(base, path);
    if (!file.startsWith(base)) file = base;
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(response);
  }).listen(port, '127.0.0.1', () => console.log(`preview: http://127.0.0.1:${port}/  (es-AR)  and  /en/  (Ctrl+C to stop)`));
}

const { values } = parseArgs({ options: { out: { type: 'string', default: 'dist/preview' }, serve: { type: 'boolean', default: false }, port: { type: 'string', default: '4173' } } });
await build(values.out);
if (values.serve) serve(values.out, Number(values.port));
