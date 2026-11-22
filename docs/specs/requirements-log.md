# Requirements log — cuotear

Status: confirmed | assumed | open | superseded (kept for history; never deleted, see Round 7)

## Round 1

| ID | Requirement | Source | Status |
|----|-------------|--------|--------|
| RF-01 | Notify the user when a product's price (cash or installments) drops (threshold / previous minimum — exact rule TBD). | User answer 1a | confirmed (rule details open; Round 7: rules now defined by RF-22) |
| RF-02 | Monitor up to 10 products (CLAUDE.md). | CLAUDE.md | confirmed (lowered to 5 by RN-02 in round 3; **reinstated at 10 in Round 7**) |
| RF-03 | Distinguish cash price (contado) from interest-free installment price per card: Visa, Mastercard, Naranja X. | CLAUDE.md | confirmed (Round 7: cash price redefined, RF-20) |
| RF-04 | v1 stores: Mercado Libre (via MejoresCompras), Frávega, On City, Musimundo, Cetrogar, Carrefour, Megatone, Rodo, Naldo. | User answer 2 | confirmed (Round 7: Mercado Libre via MejoresCompras is best-effort) |
| RF-05 | Store sources must be extensible: the developer (not the end user) can add new store/search pages over time. | User answer 2 | confirmed |
| RF-06 | A simple web UI where the user adds the products to monitor. | User answer 3 | superseded (Round 7): products now live in a repo config file (RF-19); the UI is read-only (RF-17). Mechanism question (RNF-02) no longer applies. |
| RF-07 | Prices are checked every 6 hours (4 runs/day). | User answer 4a | confirmed |
| RNF-01 | Serverless, zero cost: GitHub Actions + GitHub Pages. | CLAUDE.md | confirmed |
| RNF-02 | A web UI that writes data (RF-06) needs a free external backend (e.g. Cloudflare Workers / Supabase) alongside GitHub Pages; zero-cost limit still applies (free tiers only). Provider TBD in DRT. | User answer 5 (1c) | superseded (Round 7): no writes from the UI, no external backend. |
| RNF-03 | UI languages: es-AR (default) and en. | CLAUDE.md | confirmed |
| RN-01 | Content downloaded from stores is untrusted data. | CLAUDE.md | confirmed |
| RF-08 | Multi-user: the owner is the real user, but the app must be usable by several users (e.g. a recruiter evaluating the project), each with their own products. | User answer 2 | superseded (Round 7): v1 is single-user; multi-user moved to v2 (adds accounts, isolation and global caps with no value for the sole real user). |
| RF-09 | Alert channel: email. | User answer 3 | superseded (Round 7) by RF-23 (Telegram or email from GitHub Actions, single recipient). |
| RF-10 | Alert trigger: any price drop versus the previous measurement (per price type: cash / per card installments). | User answer 4 | superseded (Round 7) by RF-22 (configurable rules); "any strict drop" stays as the default when no rule is set. |
| A-02 | Price history stored as files in the repo. | Assumption | confirmed (Round 7): no database/backend, history lives in repo files (RF-24). |
| Q-01 | MejoresCompras (https://mejorescompras.com.ar/) is the source used for Mercado Libre prices. | User answer | confirmed (scraping method/ToS to review; Round 7: best-effort source); **superseded in Round 10**: MejoresCompras returns 403 to GitHub-hosted runners, so it is not a v1 source (S-35) |
| RF-11 | Authentication via Google or GitHub OAuth; the verified email is used for alerts. | User answer 1a (round 3) | superseded (Round 7): no login/accounts in v1; moved to v2. |
| RN-02 | Limit of 5 products per user (lowered from the 10 in CLAUDE.md). | User answer 2a (round 3) | superseded (Round 7): no per-user model; limit is back to 10 products (RF-02). |
| RN-03 | Global cap of 50 unique product URLs; identical products are shared across users (scraped once). | User answer 2a (round 3) | superseded (Round 7): there is a single user, so no global cap or cross-user sharing. |
| RF-12 | Adding a product: the user pastes a product URL AND chooses which stores to compare it against. Domain must be in the allowlist. | User answer 3b (round 3) | superseded (Round 7): URLs per store are written in the config file (RF-19); the domain allowlist is enforced by schema validation (RF-04). |
| RNF-04 | Privacy: store only email + products; user can delete account and all data from the web; price history kept 12 months. Subject to Ley 25.326. | User answer 4a (round 3) | superseded (Round 7): no personal data, no accounts (RNF-14); Ley 25.326 moved to v2. The 12-month history retention is kept as an assumption in RNF-13. |
| RF-13 | Cross-store matching: the user pastes one URL; the system searches the product by name/model in the other chosen stores and the user confirms the matches. | User answer 1b (round 4) | superseded (Round 7): automatic search/matching moved to v2 (complex, error-prone); the owner pastes each store URL manually. |
| RN-04 | The 5-product limit counts products, not URLs; one product can have several store URLs. | User answer 2a (round 4) | superseded (Round 7): the 5 limit is gone; the idea "limit counts products, not URLs" is absorbed into RF-02 (limit 10). |
| RN-05 | "Cash" price = the published price without financing (list price). Transfer/cash/debit discounts are out of scope for v1. | User answer 3a (round 4) | superseded (Round 7) by RN-10/RF-20: list price is NOT the cash price; cash discounts by payment method are in scope. |
| RF-14 | Per card (Visa, Mastercard, Naranja X) store: total price, maximum number of interest-free installments, and installment value. If the store offers nothing for that card, show "no data". | User answer 4a (round 4) | confirmed |
| RF-15 | Store failure (down, blocked, HTML changed): keep the last price, mark the measurement as "failed", retry on the next run, send no alert; after N consecutive failures show "no data". | User answer 1a (round 5) | confirmed (N is an assumption, proposed 4) |
| RN-06 | Out of stock / discontinued / zero price: record status "out of stock", not treated as a price drop, no alert; when stock returns compare against the last valid price. | User answer 2a (round 5) | confirmed |
| RF-16 | Alert emails sent through a free-tier email provider (Resend or Brevo class); final choice made in the DRT. | User answer 3a (round 5) | superseded (Round 7) by RF-23 (Telegram or email via GitHub Actions secrets). |
| RNF-05 | Abuse protection: per-user limits (5 products, daily cap on searches), allowlist of store domains only, daily cap on emails. | User answer 4a (round 5) | superseded (Round 7): no third-party users to abuse; no search feature in v1. Domain allowlist survives via RF-04/RF-19. |
| DEC-01 | From round 6 on, the user delegated all remaining DAF/DRT decisions to Claude; no more questions. Everything below is an **Assumption** chosen by Claude. | User instruction | confirmed |
| RF-17 | UI screens: sign-in, product list (current cash and per-card installment prices per store, best price highlighted), add-product flow (paste URL, choose stores, confirm matches), product detail with price history chart, alert/account settings with delete account. | Assumption (Claude) | assumed (Round 7: modified to a read-only static site; sign-in, add flow and account screens removed) |
| RF-18 | Alert emails are in the user's language (es-AR default, en), one email per run per user grouping all drops, with product, store, price type, old price, new price and link. | Assumption (Claude) | superseded (Round 7) by RF-23 (single grouped message per run, no per-user language). |
| RNF-06 | Prices stored in ARS with the timestamp of each measurement; the UI shows data freshness ("updated at"). | Assumption (Claude) | assumed |
| RNF-07 | Respect store ToS/robots as far as feasible: polite request rate, identifiable User-Agent, no bypass of anti-bot protections; stores that forbid it are dropped. | Assumption (Claude) | assumed |
| RNF-08 | Accessibility target WCAG 2.2 AA; Baseline Widely available browsers (CLAUDE.md). | Assumption (Claude) | assumed |
| RNF-09 | The user can unsubscribe from alerts per product or entirely, via a link in every email. | Assumption (Claude) | superseded (Round 7): no third-party recipients; alerts are configured in the config file (RF-22/RF-23). |
| RN-07 | A product is considered the "same" across stores only after the user confirms the match (RF-13); an unconfirmed match is never monitored. | Assumption (Claude) | superseded (Round 7): no automatic matching in v1 (see RF-13). |
| RN-08 | Prices are compared only within the same store and price type (cash, or card + installment count); a drop is any strictly lower value than the previous valid measurement. | Assumption (Claude) | assumed (kept in Round 7) |
| Q-02 | (closed) | Delegated to Claude | assumed |

## Round 7 – scope revision

Source: direct instruction from the user (authoritative; overrides earlier rounds where they conflict). The DAF was revised to v0.2 accordingly. Items marked "Assumption (Claude)" were decided by the analyst without asking, per the instruction not to ask questions.

### 7.1 Scope: single user, config in repo, read-only site

| ID | Requirement | Source | Status |
|----|-------------|--------|--------|
| RF-02 | Limit goes back to **10 products**; the limit counts products, not URLs (absorbs RN-04). Assumption (Claude): at most one URL per store per product. | User, Round 7 item 1 | confirmed (reinstates RF-02 from Round 1) |
| RF-19 | v1 is for a single user (the repo owner). Products and per-store URLs live in a repo configuration file validated with a schema. No login, no database, no personal data. Assumption (Claude): last valid config is kept if a change fails validation; secrets are rejected in the file. | User, Round 7 item 1 | confirmed (file format and schema open for DRT) |
| RF-17 | UI is a read-only static site on GitHub Pages (list with best option and verdict, detail with chart). | User, Round 7 item 1 | confirmed (modifies Round 3-5 assumption) |
| RF-24 | Price history is stored as files in the repo; retention/size policy: Assumption (Claude): 12 months, append a point only on change, one commit per run only if there are changes, soft limit 50 MB (warn at 45 MB). | User, Round 7 item 7 (policy assumed) | confirmed (policy assumed) |
| RNF-14 | No personal data in repo, history or site; recipient identifiers live only in GitHub Actions secrets. | User, Round 7 item 1 | confirmed |
| V2-01 | Moved to v2 / out of scope, with justification in DAF section 3: multi-user, accounts/OAuth, web add-product form and external backend, automatic search and cross-store matching, account deletion and unsubscribe links, per-user abuse limits, Ley 25.326 compliance. | User, Round 7 item 1 | confirmed (v2) |

Superseded by this round (rows above marked in place): RF-06, RF-08, RF-09, RF-10, RF-11, RF-12, RF-13, RF-16, RF-18, RN-02, RN-03, RN-04, RN-05, RN-07, RNF-02, RNF-04, RNF-05, RNF-09.

### 7.2 Price model

| ID | Requirement | Source | Status |
|----|-------------|--------|--------|
| RN-10 | Cash price (precio de contado) = best single-payment price (transfer, debit, cash, or one-payment promo) recorded WITH its condition. The list price is NOT the cash price (supersedes RN-05) and is stored separately. Assumption (Claude): if the store has no single-payment discount, cash = list price with condition "no payment-method discount"; a discount that cannot be parsed makes the cash measurement "failed" rather than falling back to list price. | User, Round 7 item 2 | confirmed |
| RF-20 | Per store: record cash price + condition + list price. | User, Round 7 item 2 | confirmed |
| RF-14 | Per card (Visa, Mastercard, Naranja X): number of interest-free installments, installment value, total. Assumption (Claude): if several options exist, take the one with the most interest-free installments; total must match n x value within n pesos. | User, Round 7 item 2 | confirmed (refines Round 4) |
| RN-14 | Cash discounts by payment method are IN scope; bank-specific promos with cashback (reintegro), coupons and miles are OUT. Assumption (Claude): discounts that require a specific bank/card are also out. | User, Round 7 item 2 | confirmed |

### 7.3 Comparison

| ID | Requirement | Source | Status |
|----|-------------|--------|--------|
| RF-21 | Cash vs installments: difference in $ and %, present value (PV) of installments using expected monthly inflation (configurable source: BCRA REM or manual value), verdict "conviene contado / conviene cuotas" per product. Formula: PV = sum_{k=1..n} C/(1+r)^(s+k-1); with s=1, PV = C(1-(1+r)^-n)/r; r=0 gives PV = n*C. Worked example in DAF: Pc=1,000,000, 12 x 100,000, r=3% -> PV ~ 995,400 -> cuotas; r=1% -> 1,125,508 (exact 1,125,507.75; corrected in Round 8) -> contado; r=3%, s=0 -> 1,025,262 -> contado. Assumptions (Claude): s=1 (parametrizable 0/1); REM = constant rate averaging next n monthly expectations; tie = contado; "marginal difference" tag under 1%; product verdict = best global cash vs best global PV; fallback chain for inflation: last value -> manual -> no verdict. | User, Round 7 item 3 | confirmed (formula details assumed) |
| RN-11 | Each installment is discounted with the expected monthly inflation from month s. | User, Round 7 item 3 | confirmed (s assumed) |

### 7.4 Alerts

| ID | Requirement | Source | Status |
|----|-------------|--------|--------|
| RF-22 | Configurable rules: minimum drop in %, minimum drop in $, target price, change of best option. Assumptions (Claude): global defaults with per-product override; rules combined with OR; no rules = any strict drop; thresholds inclusive; target price triggers on crossing; `aplica_a` default cash. | User, Round 7 item 4 | confirmed (details assumed) |
| RF-23 | Alerts via Telegram or email from GitHub Actions; secrets in GitHub Actions secrets. Assumption (Claude): Telegram primary, email optional; one grouped message per run; retry next run without duplicates. | User, Round 7 item 4 | confirmed (final channel open for DRT) |
| RN-12 | The first measurement never alerts. | User, Round 7 item 4 | confirmed |
| RN-13 | A drop greater than 90% is flagged "a verificar" (still alerted). Assumption (Claude): strictly greater than 90%. | User, Round 7 item 4 | confirmed |

### 7.5 Risks and degradation

| ID | Requirement | Source | Status |
|----|-------------|--------|--------|
| R-01 | Risk: stores may block GitHub Actions runners (datacenter IPs). Mitigations to be defined in DRT (early per-store spike, JSON endpoints, retries, manual fallback, drop unviable stores). No evasion of anti-bot protections (RNF-07). | User, Round 7 item 5 | confirmed (risk) |
| RNF-12 | Per-store degradation: one store failing must not break the other stores or the site. Assumption (Claude): 30 s per request, 5 min per store; operational notice if all stores fail. | User, Round 7 item 5 | confirmed |
| RF-04 | Mercado Libre via MejoresCompras is a best-effort source (no availability guarantee; failure treated as store failure and not counted against RNF-10). | User, Round 7 item 5 | confirmed |

### 7.6 Existing alternatives

| ID | Requirement | Source | Status |
|----|-------------|--------|--------|
| ALT-01 | DAF section 12 compares with mejorescompras.com.ar. Only the use of MejoresCompras as a Mercado Libre price source (Q-01) is taken as known; every other claim about it is marked "Assumption / to verify". cuotear's differentials are design goals: cash vs installments per card, present-value verdict, personal alerts, zero cost, open source (licence to be defined). | User, Round 7 item 6 | confirmed; **updated in Round 8**: MejoresCompras facts verified by the owner on 2026-11-22 and licence decided (MIT) |

### 7.7 Kept unchanged

6-hour schedule (RF-07), store list (RF-04), store-adapter extensibility by the developer (RF-05), es-AR/en UI (RNF-03), accessibility (RNF-08), untrusted-content rule (RN-01), out-of-stock rule (RN-06), store failure handling (RF-15), comparison per series (RN-08), zero cost (RNF-01), secrets handling (RNF-11, confirmed via CLAUDE.md; see Round 8).

### 7.8 Open points for the DRT

1. Config file format and schema; where validation runs.
2. History storage layout in the repo, commit frequency/strategy, retention and compaction.
3. Inflation source (BCRA REM availability/format, constant vs monthly vector, manual fallback).
4. Telegram vs email (or both).
5. Runner-blocking mitigation (R-01).
6. Store adapter contract and extraction of cash conditions and per-card installments; MejoresCompras method and ToS.
7. Where the verdict is computed; static site generation, chart accessibility, i18n.
8. Actions minutes budget and cron suspension on inactivity.
9. README/README.es.md alignment (verify mentions of multi-user, OAuth, email-only). (Repo licence removed as an open point in Round 8: MIT, already decided.)

## Round 8 - coherence fixes

Source: internal coherence review of DAF v0.2 (DAF now v0.3). Facts below marked "owner" come from the user; everything else is an **Assumption (Claude)**, labelled S-xx in DAF section 15.1 (S-18 reworded; S-19 to S-34 new).

### 8.1 Facts from the owner

| ID | Fact | Source | Status |
|----|------|--------|--------|
| ALT-01 | The owner verified the MejoresCompras facts on 2026-11-22: covers only Mercado Libre; about 42,000 products chosen by them; daily price snapshot; inflated-discount detection (median and historical minimum); Telegram alerts; free, no registration; Chrome extension. Not offered: cash vs installments comparison, card filter, other stores. DAF section 12 updated. Out of scope for cuotear v1: Chrome extension and inflated-discount detection (S-19). | User, 2026-11-22 | confirmed |
| LIC-01 | The repository licence is MIT (already decided). It is no longer an open point (removed from 7.8 item 9 and from DAF section 12). The reviewer's finding 9 (licence open) is therefore obsolete. | User | confirmed |

### 8.2 Rows missing from earlier rounds (added now)

| ID | Requirement | Source | Status |
|----|-------------|--------|--------|
| RNF-10 | Availability: at least 95% of scheduled runs per month finish (complete measurement, history and site) despite partial store failures; Mercado Libre failures do not count against it (S-17). | Assumption (Claude), DAF v0.1 | assumed (S-02) |
| RNF-11 | Secrets only in GitHub Actions secrets or local env vars; never in the repo or logs. | CLAUDE.md | confirmed (status aligned: earlier note in 7.7 said "assumption") |
| RNF-13 | History size and retention: 12 months (keeping the last point of each series), warn at 45 MB, soft limit 50 MB, hard stop at 100 MB (S-13, S-33). | Assumption (Claude), Round 7 | assumed |
| RNF-15 | New: operational notice defined once (log/summary + GitHub issue `cuotear-ops`, one open per cause, run does not fail), reused by RNF-12, RNF-13, RF-23, RF-19, R-04 (S-18). | Assumption (Claude) | assumed |
| R-07 | New risk: loss of the non-versioned run state (S-25). | Assumption (Claude) | assumed |

(R-01, V2-01 and ALT-01 rows already exist in Round 7 and are now mapped in DAF section 13.)

### 8.3 Decisions (all Assumption (Claude))

| Finding | Change | S-xx |
|---------|--------|------|
| 1 | RF-21 scenario B corrected: exact PV 1,125,507.75, displayed 1,125,508 (+/-1), DifVP +125,508 (+12.55%). Scenarios A (995,400.40; -4,599.60; -0.460%) and C (1,025,262.41; +25,262.41; +2.526%) rechecked and correct. | - |
| 2 | RF-24 purge always keeps the last point of each series, even older than 12 months. | S-13 |
| 3 | Run state (last valid measurement timestamp, failure counters, pending alerts, last valid config, previous best option, last run time) lives outside commits (e.g. Actions cache); the site is deployed from the workflow without commits; commit only when history points change; zero commits otherwise; behaviour if state is lost defined. | S-25 |
| 4 | Mercado Libre: only a price is guaranteed (stored as list price; cash and cards "sin datos" unless obtainable); product must be in the MejoresCompras catalog (absent: "sin datos", no failure, no counter); daily snapshot so ML is queried once a day. | S-27, S-32 |
| 5 | RF-04 list may shrink after the R-01 spike or by RNF-07; criterion evaluated against the current list. | S-28 |
| 6 | RNF-12: stores run in parallel so the worst case fits the 10-min per-run timeout. (Superseded in Round 9: no monthly minutes budget.) | S-29 |
| 7 | Failed, "sin datos", out-of-stock and closed series are excluded from best option and verdict; changes caused by exclusion, recovery, or by r/s/config do not alert. | S-26 |
| 8 | "Aviso operativo" defined once (RNF-15); missing secrets: no send, notice, rest continues (RF-23 and S-18 now consistent). | S-18 |
| 11-13 | Missing rows added (8.2); section 13 maps V2-01, ALT-01, R-01; RN-04 consistent (absorbed into RF-02); RF-03 added to CU-05, CU-08, CU-09 and coverage claim fixed. | - |
| 14 | RF-24 now points to section 9 and RNF-13. | - |
| 15 | RF-17: step-line chart up to last measurement; stale threshold 12 h (36 h for ML). | S-30 |
| 16 | RF-22: series/scope per rule, `aplica_a`, per-rule override, explicit "no" vs no keys, r-only changes do not alert; `baja_minima_monto` added to RF-01 and RF-19. | S-31, S-21 |
| 17 | Last valid config and previous best option added to the section 9 state; RF-02 consistent with RF-19. | S-25, S-12 |
| 18-19 | New acceptance criteria in RF-19 (duplicate URL, >1 URL per store, r<0, s outside {0,1}, 10 OK / 11 fails) and RF-21 (manual fallback, no verdict, r<0, annual 40% -> r about 2.8436% monthly with PV about 1,004,757, tie, marginal tag <1% vs >=1%, r=0 with s=0); REM horizon renamed `h`. | S-07, S-08 |
| 20 | Inline assumptions given ids. | S-19 to S-24 |
| 21 | Cash condition is structured (medio + %), rendered per language. | S-34 |
| 22 | N=4 counter per store+series; out-of-stock and not-in-catalog are not failures. | S-32 |
| 23 | Section 12 cites RF-17 for "sin login"; Chrome extension and inflated-discount detection listed as out of scope in 2.2. | S-19 |
| 24 | SPF/DKIM marked as an analyst annotation. | - |
| 25 | Header no longer claims rounds 1-5 are all confirmed. | - |
| 26 | RF-07 criterion testable (no "active" flag; to stop measuring a URL, remove it); RN-08 criterion for n changes (old series closed, new one opens without alert). | S-24, S-33 |
| 27 | Above 50 MB keep recording (soft); at 100 MB stop persisting points; removed products leave active files at next run. | S-33 |

## Round 9 - Actions budget correction

| ID | Requirement | Source | Status |
|----|-------------|--------|--------|
| RNF-01 | Public repo + standard runners = free Actions minutes, so there is no monthly minutes budget (the 1,500 min/month figure from Round 8 is dropped). The relevant limit is the per-run timeout (<= 10 min, `timeout-minutes`). If the repo became private, re-evaluate the minutes quota. | User instruction (2026-11-22) | confirmed |

## Round 10 - spike findings

Source: store-access spike, verified 2026-11-22 from a local Argentine IP and a GitHub-hosted runner (ubuntu-24.04); report `docs/spikes/store-access.md` on branch `spike/store-access`. DAF bumped to v0.4. Facts below are verified evidence; decisions are **Assumption (Claude)** (S-35 to S-40).

### 10.1 Evidence

| Store | Result from the runner | Notes |
|-------|------------------------|-------|
| On City | VTEX JSON API works (local and runner) | List price; interest-free installments Visa 15x, Mastercard 18x, Naranja X 12x |
| Cetrogar | VTEX JSON API works | Visa 15x, Mastercard 15x, Naranja X 12x |
| Carrefour | VTEX JSON API works | Only Mastercard 3x; two sellers (one with price 0 / no stock) |
| Naldo | VTEX API works | The TCL 75T6C is not carried; needs validation with another product |
| Megatone | Search URLs 404; direct product URL returns 200 | Price in JSON-LD only (no cards, no cash); works from Actions |
| Rodo | 200, no prices in initial HTML (JS-rendered) | No usable endpoint found |
| Musimundo | Not VTEX; redirects to a static home linking to On City | No catalog endpoint |
| Fravega | **BLOCKED** 403 CloudFront (works locally) | No evasion |
| MejoresCompras | **BLOCKED** 403 Cloudflare "Just a moment..." challenge (works locally) | No captcha solving |

Cash price: the VTEX checkout simulation (POST /api/checkout/pub/orderForms/simulation, postal code 5000) on On City, Cetrogar and Carrefour shows every payment method (incl. "Transferencia Bancaria - Con descuento adicional", "Efectivo", debit) totals exactly the published price: no extra cash discount is exposed anonymously. Fravega/Megatone pages show only a generic "descuento".

### 10.2 Decisions

| Item | Change | S-xx |
|------|--------|------|
| R-01 | Recorded as **materialised**: 2 of 9 sources blocked (Fravega, MejoresCompras). Mitigation: no evasion (RNF-07), per-store degradation (RNF-12, RF-15), JSON endpoints where they exist, drop unviable stores (S-28). | S-35 |
| RF-04 / RF-07 / Q-01 / R-02 | Mercado Libre via MejoresCompras is **not viable from Actions** and leaves the v1 measured set (supersedes S-27, S-17; the ML-specific parts of S-30 and S-32 lapse). RF-07 loses the daily-ML exception. "sin datos" without failing the run holds for any blocked store. Alternatives are open points for the DRT: official Mercado Libre API (unverified), manual price entry, self-hosted/other-IP runner (breaks zero-cost serverless). | S-35 |
| RF-04 | Current list (shrink clause S-28): On City, Cetrogar, Carrefour, Naldo (provisional), Megatone (direct product URL only). Fravega, Rodo, Musimundo, Mercado Libre moved to candidates / out of the v1 measured set with reasons (DAF sections 2.2 and 3). Adapter extensibility (RF-05) and config-file URLs per store (RF-19) kept; no search by name. | S-36 |
| RF-20 / RN-10 / RN-14 / RF-21 | Anonymous sources expose cash = published price; condition = payment method with discount 0 %. Data model still carries `descuento_pct` > 0 if a store exposes one. Numeric examples unchanged; RF-21 text clarified (compares one-payment price vs interest-free installment total at present value). | S-37 |
| RF-04 | Carrefour seller selection: discard price 0 / no stock; if several remain, lowest price (provisional). | S-38 |
| RF-04 / RF-03 | Megatone: direct URL adapter only, price only (list = cash, cards "sin datos"). | S-39 |
| RF-04 | Naldo kept as provisional; validate with another product, otherwise drop. | S-40 |
| DAF 15.2 | New DRT questions 14 to 18 (VTEX simulation as cash source, Carrefour seller, Megatone URL-only adapter, Naldo validation, alternative Mercado Libre source); question 7 replaced. | - |

### 10.3 Open points for the DRT (added)

1. VTEX checkout simulation as the cash source (stability, postal code, payment-method identification, fallback).
2. Seller selection for Carrefour.
3. Megatone URL-only adapter (JSON-LD).
4. Naldo validation with another product.
5. Alternative Mercado Libre source (official API unverified / manual entry / other-IP runner) and re-evaluation of Fravega, Rodo, Musimundo.

## Round 11 - DRT alignment

Source: DRT v0.1 (section 20.3, defects D-01 to D-12) and ADRs 0003, 0006 to 0010, 0013, 0014; robots.txt checks verified 2026-11-22. DAF bumped to v0.5. No new facts from the owner: everything below is either verified evidence (robots.txt, BCRA API) or an **Assumption (Claude)** (S-41 to S-52). Where the DRT and the DAF disagree, the DAF text prevails and the point is listed under 11.3.

### 11.1 Verified evidence

| Topic | Fact |
|-------|------|
| Cetrogar | robots.txt: `Disallow: /api/` and `/checkout/` for all agents. The VTEX JSON API is not used. |
| On City | robots.txt: `Disallow: /*checkout*`. The VTEX catalog API is allowed; the checkout simulation is not. Catalog 1-payment lines list debit methods (Cabal Debito, Maestro, Visa Electron), not bank transfer. |
| Carrefour, Naldo | robots.txt allows catalog and checkout simulation. Carrefour is a marketplace (three third-party products/sellers plus CARREFOUR at price 0 in the spike). |
| BCRA API | Only the median 12-month expected inflation (variable 29, monthly, % year-over-year) is published through the API; the monthly expectations vector exists only in XLSX. |

### 11.2 Decisions (all Assumption, Claude)

| Defect / item | Change | S-xx |
|---------------|--------|------|
| D-01 | Cetrogar becomes provisional; HTML product page to be validated in F1; otherwise dropped. RF-04, sections 2.2, 3, 10, 12, glossary. | S-43 |
| D-02 | Checkout simulation is not the cash source at On City / Cetrogar; cash comes from catalog 1-payment lines; simulation optional at Carrefour / Naldo. RF-20, RF-04, S-37 reworded. | S-42 |
| D-03 | RF-20 example corrected: On City -> {debito, 0 %} (no bank transfer). | S-42 |
| D-04 | S-07 reworded: constant monthly `r` from variable 29; `h` averaging deferred; RF-21 definitions and REM source reworded, numeric examples unchanged (given `r`); new criterion with A = 21.8 %. | S-41 |
| D-05 | S-38 reworded per ADR-0006 (marketplace, seller rule, same seller for installments and cash, unverified Mastercard 3x origin). | S-38 |
| D-06 | "Precio de lista" = VTEX `Price`; `ListPrice` not used. RF-03, glossary, RF-20. | S-44 |
| D-07 | RNF-15 cause list extended; issues auto-close. | S-51 |
| D-08 | R-04: notice at 45 days of inactivity instead of "cannot notify". | S-47 |
| D-09 | RF-07 adds the "sin oferta" result. | S-52 |
| D-10 | RF-24: closed-series growth accepted; purge trigger > 500 closed series. | S-48 |
| D-11 | History rule narrowed: failures are not history points (section 9, RF-24, RF-15). | S-48 |
| D-12 | RF-23: Telegram implemented, email deferred (partial coverage). | S-49 |
| Extra | RNF-07: robots.txt enforced at runtime (also for APIs), ToS reviewed manually before F3. | S-45, S-46 |
| Extra | RNF-08: automated checks static; contrast and screen reader tested manually. | S-50 |

### 11.3 Disagreements left for the owner (DAF kept or open)

1. **DAF S-37 evidence vs DRT:** the DAF keeps "cash = published price" as a spike finding (simulation showed all methods equal the published price) but no longer relies on the simulation; the DRT's catalog-line rule yields the same value (0 %). No functional conflict, only the source differs.
2. **S-41:** a median 12-month year-over-year expectation converted to a monthly rate is applied to all installment counts (DRT ST-10). It is an approximation (for short plans the near-term expectation may differ). The DAF accepts it for v1; owner should confirm.
3. **D-10:** the DAF rule "always keep the last point of each series" is kept (DRT also keeps it and defers the purge); unbounded closed-series growth is documented and accepted instead of changed.
4. **RF-23:** the DAF keeps "Telegram or email" as the requirement and records email as a deferred Could; the DRT's `canal: email` rejection in the schema is stated in the DAF as a validation failure (not confirmed in the DRT schema text).
5. **Issue auto-close (DRT ST-11)** and the cause keys are imported into RNF-15 as Assumption S-51; the list is declared open.
6. **Carrefour Mastercard 3x** (generic vs "Tarjeta Carrefour Mastercard") remains unverified until the F1 fixture; if it is the store-brand card, Carrefour has no eligible card series.
