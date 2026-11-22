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

## License
[MIT](LICENSE) © Agustin Gutierrez
