# Test fixtures

Recorded or synthetic store responses used by the contract tests (`test/contract/`). Tests never touch the network.

## `oncity/`

- `tcl-75t6c.json`: **real** response of the On City catalog API for the TCL 75T6C, captured on 2026-11-22 with `npm run fixtures:capture -- oncity <product url> tcl-75t6c` (same HTTP layer as production: allowlist, robots.txt, 1 request/s).
  - **Trimmed:** the capture tool keeps only the fields the adapter uses plus a few identifying ones (`productId`, `productName`, `linkText`, `itemId`, seller id/name/default, `Price`, `ListPrice`, `AvailableQuantity`, `IsAvailable` and each installment line's payment-system name, number, value, total and interest rate). Descriptions, images, specifications, teasers, categories and the rest were dropped (about 10 KB remain). Values are untouched. The data is public catalog data; nothing sensitive is stored (no cookies, no headers).
- `tcl-75t6c.expected.json`: reviewed expected adapter output (`StoreResult` without `meta`). Checked by hand against the store figures of the spike: list 2.299.999, cash = debit line (Cabal Debito, Maestro, Visa Electron) at the same value (0 %), Visa 15x, Mastercard 18x, Naranja 12x, all with total 2.299.999.
- `synthetic-*.json` (and `synthetic-challenge.html`): **hand-made** edge cases generated from a minimal VTEX shape, each with a `.expected.json` written independently of the adapter: no stock / price 0, empty array (no offer), missing card, unknown and store-branded payment systems, two sellers (and tie-breaks), cash discounts and ties, interest and inconsistent totals, several items (`skuId`), prompt-injection text in store data, malformed JSON, wrong shape and a captcha/challenge page. They are not real captures.

## Refreshing

Refresh the real fixture when an adapter fails in production on `parse`, and whenever an adapter is added or changed. Review the generated `expected.json` skeleton by hand before committing (it carries a `_note` key that must be removed).
