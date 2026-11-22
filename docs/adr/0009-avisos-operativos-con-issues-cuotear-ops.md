# ADR-0009: Avisos operativos como issues `cuotear-ops` reconciliados por causa

- Estado: Aceptado
- Fecha: 2026-11-22
- Requisitos: RNF-15, S-18, RNF-12, RNF-13, RF-19, RF-23, R-04, RNF-10 · DAF Q-11 · DRT sección 13.6

## Contexto

RNF-15 define el aviso operativo como línea de log/resumen más un issue `cuotear-ops`, uno abierto por causa, sin duplicar, sin depender de los secretos del canal y sin hacer fallar la ejecución.

## Decisión

- `src/notify/ops-issues.js` usa la REST API de GitHub con `GITHUB_TOKEN` (`issues: write`); crea la etiqueta si falta.
- Cada causa tiene una clave; el issue lleva `<!-- cuotear-ops:cause=<clave> -->` en el cuerpo y título `[cuotear-ops] …`.
- En cada ejecución: causa presente con issue abierto ⇒ se actualiza el cuerpo (última vez vista, contador, enlace a la ejecución) sin comentar; sin issue ⇒ se crea; causa ausente con issue abierto ⇒ comentario "resuelto" y cierre automático (ST-11).
- Causas: las del DAF (`todas-tiendas-fallan`, `secretos-canal`, `config-invalida`, `config-ausente`, `historial-45mb`, `historial-100mb`) y las agregadas por el DRT (`robots:<tienda>`, `commit-conflicto`, `inactividad`, `disponibilidad`).
- Cada causa también produce `::error::` y una fila en el resumen. Si la API falla, solo log. `dry_run` no toca issues.

## Consecuencias

- El dueño recibe una notificación de GitHub al abrirse cada causa y no cada 6 h.
- Los issues son públicos: su contenido no incluye secretos ni datos personales.
- El cierre automático puede ocultar una causa intermitente; el historial del issue conserva las reaperturas.

## Alternativas consideradas

- **Un comentario por ejecución:** ruido cada 6 h.
- **Usar el canal de Telegram:** depende de los secretos que justamente pueden faltar.
- **Hacer fallar la ejecución:** GitHub notifica, pero viola RNF-15 y degrada RNF-10.
- **Acción de terceros para issues:** dependencia innecesaria para tres llamadas REST.
