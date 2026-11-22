# ADR-0005: Workflow del monitor con un job de medición (paralelismo en proceso) y un job de deploy

- Estado: Aceptado
- Fecha: 2026-11-22
- Requisitos: RF-07, RNF-01, RNF-10, RNF-11, RNF-12, S-02, S-15, S-29 · DRT sección 10

## Contexto

Cada 6 h hay que medir hasta 50 URLs en 5 tiendas, en paralelo entre tiendas y en serie dentro de cada una (1 pedido/s por dominio), escribir el historial, construir el sitio y publicarlo en ≤ 10 min por ejecución, con permisos mínimos, sin que una tienda caída haga fallar la ejecución y sin dos ejecuciones concurrentes sobre el mismo estado.

## Decisión

- `monitor.yml`: `schedule` `17 */6 * * *` + `workflow_dispatch` (entrada `dry_run`). `permissions: {}` a nivel workflow; `concurrency: cuotear-monitor` sin cancelar en curso.
- Job `run` (timeout 10 min; `contents: write`, `issues: write`, `actions: read`): checkout sin credenciales persistidas, Node 24, `npm ci --ignore-scripts`, restauración de estado, `run.js` (medición en paralelo por tienda con `Promise.allSettled`, presupuestos 30 s/pedido, 5 min/tienda, 6 min global), `commit.js`, `notify.js` (único paso con secretos de Telegram), guardado de estado (`always()`), `upload-pages-artifact`.
- Job `deploy` (timeout 5 min; `pages: write`, `id-token: write`; `environment: github-pages`): `deploy-pages`.
- `ci.yml` aparte para PRs y pushes (`contents: read`).
- Acciones fijadas por SHA. Los scripts salen con 0 ante fallas de tiendas o envíos; solo un bug termina con error.

## Consecuencias

- Un checkout, una caché, un commit: diseño simple y rápido (peor caso estimado < 8 min).
- Los permisos de escritura del repo y los de Pages están en jobs distintos; los secretos, en un solo paso.
- El paralelismo depende del código (cola por host), no de la infraestructura; un bug que bloquee el event loop afecta a todas las tiendas (mitigado por presupuestos y tests).

## Alternativas consideradas

- **Matriz de jobs por tienda:** aislamiento a nivel de proceso, pero 20–40 s de arranque por job, artefactos intermedios, un job de fusión y mayor superficie de permisos.
- **Un solo job con deploy incluido:** mezcla `contents: write` con `pages`/`id-token`.
- **Cron en el minuto 0:** horario de mayor congestión en Actions.
