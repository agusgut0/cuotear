**English** | [Español](README.es.md)

# cuotear

Serverless price monitor for Argentine online stores. Tracks up to 10 products and separates the **cash price** from the **interest-free installment price** by card (Visa, Mastercard, Naranja X).

First case: Smart TV TCL 75T6C.

## Status
🔍 **In analysis.** No application code yet.

## Roadmap
| Phase | Scope | Output |
|---|---|---|
| 0. Analysis | Requirements, stores, price sources | Functional spec (DAF) |
| 1. Design | Architecture, data model, scraping strategy, security | Technical spec (DRT), ADRs |
| 2. MVP | Scheduled scraper for TCL 75T6C, JSON history | GitHub Actions workflow |
| 3. Dashboard | Static site with history and cash vs. installments comparison | GitHub Pages (es-AR / en) |
| 4. Expansion | Up to 10 products, alerts | — |

## Planned stack
- GitHub Actions (scheduled jobs) — scraping and data updates
- Node.js — scraper and data processing
- JSON in the repository — price history
- GitHub Pages — static dashboard, UI in es-AR and en
- Cost: zero

## Adding a store
Details: DRT section 22 (specs are in Spanish) and ADR-0006. The core, comparison engine, site and alerts do not change.

1. **Review ToS and robots.txt first.** Read the store's terms and `robots.txt`; the product page or JSON endpoint you will request must not be disallowed. Record the result in `docs/tos-review.md` (the owner confirms it manually). Run an access spike from a GitHub runner (no secrets): a 403 or bot challenge means the store is not added, and blocks are never bypassed (see ADR-0014 for the deferred candidates).
2. **Write the adapter.** The contract is `StoreRegistration` in `src/stores/index.js`: `id`, `displayName`, `hosts`, `status` (`vigente` | `provisional`), `validateUrl(url)`, `captureUrls(url)` and `measure(ctx, url, options)`. `measure` must return a `StoreResult` (`src/stores/types.js`): only numbers (centavos), enumerations and adapter-generated messages, never text copied from the store (downloaded content is untrusted). Fetch only through the `FetchContext` (`ctx.get`), which enforces the allowlist, robots.txt and rate limit.
   - VTEX store: add a profile (`id`, `displayName`, `hosts`, `simulacion: false`, `status`) in `src/stores/vtex/profiles.js`.
   - Any other store: create `src/stores/<id>/index.js` exporting the registration (see `src/stores/megatone/index.js`, which reads the JSON-LD of the product page).
3. **Register it** in `src/stores/index.js`: add the VTEX profile to the `createVtexStore` list, or add the new registration to the `stores` array. Registering enables the id under `productos[].urls` in the config. Its `hosts` also enter the fetch allowlist and the robots.txt check automatically (`createStoreFetchContext` in `src/http/context.js`).
4. **Record fixtures and write contract tests.** Capture with `npm run fixtures:capture -- <store> <product url> <case-name>`. It makes real requests through the production `FetchContext`, so run it rarely and on purpose. It saves a trimmed `test/fixtures/<store>/<case>.json` (`.html` for Megatone-style stores; extend the `isHtml` check in `scripts/fixtures-capture.js` if your store also serves HTML) plus a `<case>.expected.json` skeleton. Verify every value in the skeleton by hand against the store, then remove its `_note` key. Add `test/contract/<store>.test.js` modeled on the existing ones, with the real fixture plus synthetic cases (no stock, no price, malformed body, injection text, bot challenge).
5. **Use it in the config.** Add the product URL under `productos[].urls.<id>` in `config/cuotear.yaml`, then run `npm run validate-config`.
6. **Check and document.** Run `npm test`, `npm run lint` and `npm run typecheck`. Update the DAF (RF-04 list of stores), the log and, if the decision is significant, an ADR.

To retire a store, remove it from the registry: its URLs become invalid in the config. Document it.

## License
[MIT](LICENSE) © Agustin Gutierrez
