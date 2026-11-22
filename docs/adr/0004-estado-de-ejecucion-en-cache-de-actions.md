# ADR-0004: Estado de ejecución en la caché de GitHub Actions

- Estado: Aceptado
- Fecha: 2026-11-22
- Requisitos: S-25, R-07, RF-15, RF-19, RF-22, RF-23, RNF-06 · DAF Q-11 · DRT sección 9

## Contexto

Entre ejecuciones hay que conservar datos que no deben generar commits: contadores de fallas, fecha de la última medición válida, última configuración válida, mejor opción y series elegibles anteriores, alertas pendientes y enviadas, último valor de inflación y copias de robots.txt. Debe ser gratis y sin backend externo.

## Decisión

- Archivo `.state/state.json` (con `schemaVersion`, validado con Ajv) guardado en la caché de Actions.
- Restauración con `actions/cache/restore` (`key: cuotear-state-<run_id>-<run_attempt>`, `restore-keys: cuotear-state-`, toma la más reciente); guardado con `actions/cache/save` e `if: always()` (las entradas son inmutables, por eso la clave es única por ejecución).
- El monitor corre en la rama por defecto: los PRs no pueden escribir en su alcance de caché.
- Si el estado falta o es inválido, se aplica S-25 (contadores 0, sin alertas de cambio de mejor opción ni de `mejor_vp` esa vez, pendientes perdidos, última configuración válida perdida, historial intacto) y se anota en el log y el resumen.

## Consecuencias

- Costo 0; sin permisos extra; latencia baja.
- Desalojo tras 7 días sin acceso y tope de 10 GB por repo (verificado): con ejecuciones cada 6 h la entrada vigente se accede siempre; el volumen es de pocos MB.
- Riesgo aceptado: un desalojo inesperado produce una ejecución "sin memoria" sin pérdida de historial.
- Se acumulan ~28 entradas por semana de ≤ 1 MB; GitHub las desaloja solas. No se borran desde el workflow (requeriría `actions: write`).

## Alternativas consideradas

- **Artefactos de Actions:** retención configurable, pero descargar el de otra ejecución requiere la API y `actions: read`, y más código.
- **Commit del estado:** viola "cero commits sin cambios de historial".
- **Publicar el estado en Pages y leerlo:** depende del deploy anterior y expone datos de trabajo.
- **Servicio externo (KV, Gist):** backend o token adicional; contradice RNF-01/RNF-11 en espíritu.
