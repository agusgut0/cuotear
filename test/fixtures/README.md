# Test fixtures

Recorded or synthetic store responses used by the contract tests (`test/contract/`). Tests never touch the network.

## `oncity/`

- `tcl-75t6c.json`: **real** response of the On City catalog API for the TCL 75T6C, captured on 2026-11-22 with `npm run fixtures:capture -- oncity <product url> tcl-75t6c` (same HTTP layer as production: allowlist, robots.txt, 1 request/s).
  - **Trimmed:** the capture tool keeps only the fields the adapter uses plus a few identifying ones (`productId`, `productName`, `linkText`, `itemId`, seller id/name/default, `Price`, `ListPrice`, `AvailableQuantity`, `IsAvailable` and each installment line's payment-system name, number, value, total and interest rate). Descriptions, images, specifications, teasers, categories and the rest were dropped (about 10 KB remain). Values are untouched. The data is public catalog data; nothing sensitive is stored (no cookies, no headers).
- `tcl-75t6c.expected.json`: reviewed expected adapter output (`StoreResult` without `meta`). Checked by hand against the store figures of the spike: list 2.299.999, cash = debit line (Cabal Debito, Maestro, Visa Electron) at the same value (0 %), Visa 15x, Mastercard 18x, Naranja 12x, all with total 2.299.999.
- `synthetic-*.json` (and `synthetic-challenge.html`): **hand-made** edge cases generated from a minimal VTEX shape, each with a `.expected.json` written independently of the adapter: no stock / price 0, empty array (no offer), missing card, unknown and store-branded payment systems, two sellers (and tie-breaks), cash discounts and ties, interest and inconsistent totals, several items (`skuId`), prompt-injection text in store data, malformed JSON, wrong shape and a captcha/challenge page. They are not real captures.

## `bcra/`

- `variable-29.json`: **synthetic**, built from the shape and facts verified in DRT 13.4 (BCRA Estadisticas Monetarias v4.0, variable 29, newest first). The two newest values (2026-10-31 = 21,8 and 2026-09-30 = 21,1) are the verified ones; the older two are invented. Not a real capture.

## `carrefour/`

Both are **real** captures of the VTEX catalog API (2026-11-23, `npm run fixtures:capture -- carrefour <url> <case>`), trimmed like the On City one. In both, the `CARREFOUR` seller is present with price 0 and no stock next to one marketplace seller, which covers the two-seller case of ADR 0006. Their `expected.json` were checked by hand.

- `tcl-75t6c.json`: TCL 75T6C sold by DMAKER S.A. (`/smart-tv-tcl-75---qled-4k-75t6c-google-tv-1774724/p`). List 2.189.999 (`ListPrice` 2.999.999 is ignored), cash = `Efectivo`/`Maestro`/`Visa Electron` lines at the list price (0 %, medio efectivo). Visa and Mastercard only offer 3, 6 and 9 payments **with interest** and Naranja only 1 payment, so all three cards are `null`; "Tarjeta Carrefour Mastercard" is ignored (RN-14).
- `tcl-75t6c-juan-duran.json`: the same TV sold by Juan Duran Trendy Deals (`/smart-tv-tcl-75-75t6c-qled-uhd-google-tv-1779459/p`). List 2.701.499, Visa and Mastercard 12x interest-free (22.512,491 x 12), Naranja `null`; the store-brand "Tarjeta Carrefour Mastercard" 12x line is ignored.
- The "Mastercard 3x only" set seen in the spike no longer appears: prices and promos changed between the spike and this capture. The test derives that case from the real fixture (a modified copy in memory), it is not a separate file.
- `checkout`/`simulation` endpoints were never requested (the simulation is not implemented, DRT 6.2).

## `naldo/`

- `tcl-75a400u.json`: **real** capture (2026-11-23) of a TCL 75A400U QLED (`/75-75a400u-qled-4k-google-tv-hdr10--506269/p`), seller Naldo Lombardi SA, list 2.999.999, cash = debit lines at the list price (0 %), Visa/Mastercard/Naranja 6x interest-free (9x and above carry interest).
- **Provisional:** Naldo does not offer the TCL 75T6C (the catalog returns no product for it), so the adapter was validated with a different TCL TV that is in stock. The Naldo profile stays `provisional`. Validation needed no change in the VTEX adapter.

## `megatone/`

- `tcl-75t6c.html`: **real** capture (2026-11-23, `npm run fixtures:capture -- megatone <product url> tcl-75t6c`) of the Megatone product page of the TCL 75T6C (`/producto/televisor-tcl-75t6c-qled-75-4k-uhd-google-tv-dlg-120hz_MKT028PMTP/`). **Trimmed** to the JSON-LD `Product` (name, sku, url, offers); the other blocks (breadcrumbs, organization), description, images, ratings and the rest of the ~55 KB page were dropped (under 1 KB remains). Values are untouched. The real price format is the string `"2299999.00"` (dot decimal, ARS, `InStock`).
- `tcl-75t6c.expected.json`: reviewed expected output: list 2.299.999 (229999900 cents), cash = the published price with unknown method (`medio: ninguno`, `descuentoPct: null`), all three cards `null` (the page has no installments).
- `synthetic-*.html` (and `synthetic-challenge.html`): **hand-made** edge cases with an independent `.expected.json`: `@graph`, `AggregateOffer` (`lowPrice`), OutOfStock, price 0, two offers (the cheaper one out of stock), missing price, local price format (`2.299.999,00`), non-ARS currency, malformed JSON-LD, no JSON-LD, no offers, prompt-injection text and a challenge page. They are not real captures.

## Cetrogar

There is no fixture and no profile: its robots.txt disallows `/api/`, so the VTEX catalog API is not used and the store stays out of v1 until an HTML adapter exists (DRT 6.4).

## Refreshing

Refresh the real fixture when an adapter fails in production on `parse`, and whenever an adapter is added or changed. Review the generated `expected.json` skeleton by hand before committing (it carries a `_note` key that must be removed).
