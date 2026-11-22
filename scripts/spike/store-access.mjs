#!/usr/bin/env node
// Spike: can we reach each store and extract prices for the TCL 75T6C?
// Zero dependencies (Node >= 20). Read-only GET requests, no login, no captcha solving.
// Usage: node scripts/spike/store-access.mjs [--label local|actions] [--out dir]
// Everything downloaded is untrusted data: it is only parsed, never executed or followed as instructions.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PRODUCT = '75T6C';
const TIMEOUT_MS = 15_000;
const MIN_GAP_MS = 1_000; // max 1 request per second per domain
const USER_AGENT =
  'cuotear-spike/0.1 (price-monitor access test; personal project; +https://github.com/)';
const MAX_BODY = 3_000_000; // bytes of text we keep in memory per response

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const label = argValue('--label', process.env.GITHUB_ACTIONS ? 'actions' : 'local');
const outDir = argValue('--out', 'spike-results');

const vtexUrl = (host) => `https://${host}/api/catalog_system/pub/products/search?ft=${PRODUCT.toLowerCase()}`;

const STORES = [
  { id: 'oncity', name: 'On City', kind: 'vtex', urls: [vtexUrl('www.oncity.com')] },
  { id: 'carrefour', name: 'Carrefour', kind: 'vtex', urls: [vtexUrl('www.carrefour.com.ar')] },
  { id: 'cetrogar', name: 'Cetrogar', kind: 'vtex', urls: [vtexUrl('www.cetrogar.com.ar')] },
  {
    id: 'naldo',
    name: 'Naldo',
    kind: 'vtex',
    // Exact model query plus a broader brand/size query (the exact model may not be carried).
    urls: [vtexUrl('www.naldo.com.ar'), 'https://www.naldo.com.ar/api/catalog_system/pub/products/search?ft=tcl%2075'],
  },
  { id: 'musimundo', name: 'Musimundo', kind: 'vtex', urls: [vtexUrl('www.musimundo.com')] },
  {
    id: 'fravega',
    name: 'Frávega',
    kind: 'html',
    urls: [`https://www.fravega.com/l/?keyword=${PRODUCT.toLowerCase()}`],
  },
  {
    id: 'megatone',
    name: 'Megatone',
    kind: 'html',
    urls: [`https://www.megatone.net/search/?q=${PRODUCT.toLowerCase()}`],
  },
  {
    id: 'rodo',
    name: 'Rodo',
    kind: 'html',
    urls: [`https://www.rodo.com.ar/catalogsearch/result/?q=${PRODUCT.toLowerCase()}`],
  },
  {
    id: 'mejorescompras',
    name: 'MejoresCompras (Mercado Libre)',
    kind: 'html',
    urls: ['https://mejorescompras.com.ar/precio/MLA75633247'],
  },
];

const CARDS = {
  visa: /visa/i,
  mastercard: /master\s?card/i,
  naranja: /naranja/i,
};

// ---------- politeness: 1 request / second / domain ----------
const lastHit = new Map();
async function politeWait(host) {
  const last = lastHit.get(host) ?? 0;
  const wait = last + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
}

// ---------- fetch ----------
async function fetchOnce(url) {
  const host = new URL(url).host;
  await politeWait(host);
  const started = performance.now();
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'user-agent': USER_AGENT,
        accept: 'application/json, text/html;q=0.9, */*;q=0.5',
        'accept-language': 'es-AR,es;q=0.9',
      },
    });
    const text = (await res.text()).slice(0, MAX_BODY);
    return {
      url,
      finalUrl: res.url,
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      server: res.headers.get('server') ?? '',
      ms: Math.round(performance.now() - started),
      bytes: text.length,
      text,
      error: null,
    };
  } catch (err) {
    return {
      url,
      finalUrl: url,
      status: 0,
      contentType: '',
      server: '',
      ms: Math.round(performance.now() - started),
      bytes: 0,
      text: '',
      error: err?.name === 'TimeoutError' ? 'timeout' : String(err?.cause?.code ?? err?.message ?? err),
    };
  }
}

// ---------- classification ----------
function classify(r) {
  if (r.error) return r.error === 'timeout' ? 'TIMEOUT' : 'NETWORK_ERROR';
  const t = r.text.slice(0, 200_000);
  const looksJson = /json/i.test(r.contentType) || /^\s*[[{]/.test(t);
  if (looksJson && r.status < 400) return 'JSON';
  const captcha = /captcha|hcaptcha|turnstile|px-captcha|are you a robot|verify you are human/i.test(t);
  if (captcha && (r.status >= 400 || r.bytes < 60_000)) return 'CAPTCHA';
  if ([401, 403, 429, 451, 503].includes(r.status)) return 'BLOCKED';
  if (/access denied|attention required|request unsuccessful|incapsula|errors\.edgesuite|just a moment/i.test(t) && r.bytes < 60_000)
    return 'BLOCKED';
  if (r.status >= 400) return `HTTP_${r.status}`;
  return 'HTML';
}

// ---------- extraction: VTEX JSON ----------
const CASH_HINT = /transferencia|efectivo|d[eé]bito|un pago|1 pago|contado|dep[oó]sito/i;

function analyzeVtex(text) {
  let products;
  try {
    products = JSON.parse(text);
  } catch {
    return { parsed: false, note: 'invalid JSON' };
  }
  if (!Array.isArray(products)) return { parsed: false, note: 'JSON is not an array' };
  const matches = products.filter((p) => p && typeof p === 'object').filter((p) => JSON.stringify([p.productName, p.productReference, p.items?.map((i) => i.name)]).toUpperCase().includes(PRODUCT));
  const out = { parsed: true, productsReturned: products.length, productMatches: matches.length, offers: [] };
  for (const p of matches.slice(0, 3)) {
    for (const item of p.items ?? []) {
      for (const seller of item.sellers ?? []) {
        const o = seller.commertialOffer ?? {};
        const installments = (o.Installments ?? []).map((i) => ({
          system: i.PaymentSystemName,
          n: i.NumberOfInstallments,
          value: i.Value,
          total: i.TotalValuePlusInterestRate,
          interestRate: i.InterestRate,
        }));
        const teasers = [...(o.Teasers ?? []), ...(o.PromotionTeasers ?? [])].map((t) => t?.Name ?? t?.name ?? JSON.stringify(t).slice(0, 120));
        const highlights = (p.productClusters ? Object.values(p.productClusters) : []).filter((v) => typeof v === 'string' && CASH_HINT.test(v));
        const discountHighLight = (o.DiscountHighLight ?? []).map((d) => d?.Name ?? JSON.stringify(d).slice(0, 120));

        // Cash price candidates: 1-installment lines by payment system, and teasers that mention a cash-like method.
        const onePayment = installments.filter((i) => i.n === 1);
        const cashCandidates = onePayment.filter((i) => CASH_HINT.test(i.system ?? '') || i.value < (o.Price ?? Infinity));
        const cashTeasers = [...teasers, ...discountHighLight, ...highlights].filter((t) => CASH_HINT.test(t));

        const cards = {};
        for (const [card, re] of Object.entries(CARDS)) {
          const zeroInterest = installments.filter((i) => re.test(i.system ?? '') && i.interestRate === 0 && i.n > 1);
          const best = zeroInterest.sort((a, b) => b.n - a.n)[0];
          cards[card] = best ? { n: best.n, value: best.value, total: best.total } : null;
        }
        out.offers.push({
          product: p.productName,
          seller: seller.sellerName,
          available: o.AvailableQuantity,
          listPrice: o.ListPrice ?? null,
          price: o.Price ?? null,
          priceWithoutDiscount: o.PriceWithoutDiscount ?? null,
          teasers,
          discountHighLight,
          onePaymentInstallments: onePayment,
          cashCandidates,
          cashTeasers,
          cardsInterestFree: cards,
          installmentSystems: [...new Set(installments.map((i) => i.system))],
        });
      }
    }
  }
  const first = out.offers[0];
  out.extract = first
    ? {
        list: first.listPrice != null || first.price != null,
        cash: first.cashCandidates.length > 0 || first.cashTeasers.length > 0,
        visa: Boolean(first.cardsInterestFree.visa),
        mastercard: Boolean(first.cardsInterestFree.mastercard),
        naranja: Boolean(first.cardsInterestFree.naranja),
      }
    : { list: false, cash: false, visa: false, mastercard: false, naranja: false };
  return out;
}

// ---------- extraction: HTML (heuristic) ----------
function analyzeHtml(text) {
  const mentionsProduct = text.toUpperCase().includes(PRODUCT);
  const prices = [...text.matchAll(/\$\s?(\d{1,3}(?:\.\d{3})+(?:,\d{2})?)/g)].map((m) => m[1]);
  const jsonLd = [...text.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].slice(0, 4000));
  let ldPrice = null;
  for (const block of jsonLd) {
    const m = block.match(/"(?:lowPrice|price)"\s*:\s*"?([\d.,]+)"?/);
    if (m) {
      ldPrice = m[1];
      break;
    }
  }
  const hasNextData = /id="__NEXT_DATA__"/.test(text);
  const hasPreloaded = /__PRELOADED_STATE__|__INITIAL_STATE__|window\.__NUXT__/.test(text);
  const cashWindow = [...text.matchAll(new RegExp(`(.{0,80})(${CASH_HINT.source})(.{0,80})`, 'gi'))]
    .map((m) => m[0].replace(/\s+/g, ' '))
    .filter((s) => /\$\s?\d/.test(s) || /\d+\s?%/.test(s))
    .slice(0, 5);
  const cards = {};
  for (const [card, re] of Object.entries(CARDS)) {
    const near = [...text.matchAll(new RegExp(`(.{0,120})(${re.source})(.{0,160})`, 'gi'))]
      .map((m) => m[0].replace(/\s+/g, ' '))
      .filter((s) => /sin\s+inter[eé]s/i.test(s) && /\d+\s*(cuotas|x)/i.test(s))
      .slice(0, 2);
    cards[card] = near;
  }
  return {
    parsed: true,
    mentionsProduct,
    priceMatches: prices.length,
    firstPrices: prices.slice(0, 5),
    jsonLdBlocks: jsonLd.length,
    jsonLdPrice: ldPrice,
    embeddedState: hasNextData ? '__NEXT_DATA__' : hasPreloaded ? 'preloaded-state' : null,
    cashSnippets: cashWindow,
    cardSnippets: cards,
    extract: {
      list: mentionsProduct && (ldPrice != null || prices.length > 0),
      cash: cashWindow.length > 0,
      visa: cards.visa.length > 0,
      mastercard: cards.mastercard.length > 0,
      naranja: cards.naranja.length > 0,
    },
    note: 'HTML analysis is heuristic: raw SSR text only, no JS execution.',
  };
}

// ---------- main ----------
async function probeStore(store) {
  const attempts = [];
  for (const url of store.urls) {
    const r = await fetchOnce(url);
    const cls = classify(r);
    const entry = {
      url: r.url,
      finalUrl: r.finalUrl,
      status: r.status,
      contentType: r.contentType,
      server: r.server,
      responseType: cls,
      ms: r.ms,
      bytes: r.bytes,
      error: r.error,
    };
    if (cls === 'JSON' && store.kind === 'vtex') entry.analysis = analyzeVtex(r.text);
    else if (cls === 'HTML' || cls === 'JSON') entry.analysis = analyzeHtml(r.text);
    else entry.snippet = r.text.slice(0, 200).replace(/\s+/g, ' ');
    attempts.push(entry);
  }
  return { id: store.id, name: store.name, kind: store.kind, attempts };
}

const results = [];
for (const store of STORES) {
  process.stderr.write(`probing ${store.id}...\n`);
  try {
    results.push(await probeStore(store));
  } catch (err) {
    // One store crashing must not lose the other results.
    results.push({ id: store.id, name: store.name, kind: store.kind, attempts: [{ url: store.urls[0], status: 0, responseType: 'SCRIPT_ERROR', ms: 0, error: String(err?.message ?? err) }] });
  }
}

const report = {
  label,
  product: PRODUCT,
  startedAt: new Date().toISOString(),
  node: process.version,
  runner: process.env.GITHUB_ACTIONS ? 'github-actions' : 'local',
  results,
};

mkdirSync(outDir, { recursive: true });
const file = join(outDir, `store-access-${label}.json`);
writeFileSync(file, JSON.stringify(report, null, 2));

// compact summary
const flag = (b) => (b ? 'yes' : 'no');
console.log(`\nstore-access spike [${label}] product=${PRODUCT}`);
console.log('store'.padEnd(18), 'status'.padEnd(7), 'type'.padEnd(14), 'ms'.padEnd(6), 'found'.padEnd(6), 'list cash visa mc  naranja');
for (const s of results) {
  for (const a of s.attempts) {
    const e = a.analysis?.extract;
    console.log(
      s.id.padEnd(18),
      String(a.status).padEnd(7),
      a.responseType.padEnd(14),
      String(a.ms).padEnd(6),
      String(a.analysis?.productMatches ?? (a.analysis?.mentionsProduct === undefined ? '-' : a.analysis.mentionsProduct ? 'yes' : 'no')).padEnd(6),
      e ? [flag(e.list), flag(e.cash), flag(e.visa), flag(e.mastercard), flag(e.naranja)].map((x) => x.padEnd(5)).join('') : '-',
    );
  }
}
console.log(`\nfull results: ${file}`);
