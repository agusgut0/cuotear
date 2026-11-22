# ADR-0003: Historial en JSON Lines por producto, commiteado por el bot en `main` solo ante cambios

- Estado: Aceptado
- Fecha: 2026-11-22
- Requisitos: RF-24, RNF-13, RN-08, S-13, S-33, R-05 · DAF Q-2 · DRT sección 8

## Contexto

El historial debe vivir en archivos del repo, con diffs chicos, cero commits si nada cambió, un commit por ejecución si cambió algo, retención de 12 meses conservando el último punto de cada serie y límites de tamaño (45/50/100 MB). El dueño edita la configuración a mano en la misma rama.

## Decisión

- Un archivo `data/history/<producto-id>.jsonl` por producto; una línea por punto (`t`, `tienda`, `serie`, `estado`, importes en centavos enteros, condición estructurada).
- Se agrega un punto solo si cambia valor, condición, lista, cuota/total o estado (`ok`, `sin_stock`, `sin_oferta`, `cerrada`). **Las fallas no generan puntos** (solo contador en el estado).
- Los puntos nuevos se calculan contra el historial del repo (no contra el estado): si un commit falla, la siguiente ejecución vuelve a detectar el cambio (autocuración).
- Purga en cada ejecución; archivo de un producto quitado se borra; tamaño medido tras la escritura propuesta.
- Commit único por `github-actions[bot]` en `main` (`chore(data): …`), push con `GITHUB_TOKEN`, hasta 3 intentos de `fetch`/`rebase`/`push`. Conflicto ⇒ `rebase --abort`, sin commit, aviso `commit-conflicto`.
- `.gitattributes`: `data/** linguist-generated=true`.

## Consecuencias

- Diffs mínimos (líneas agregadas) y lectura simple (una línea = un `JSON.parse`).
- El bot y el dueño tocan carpetas distintas: el rebase no conflictúa en uso normal.
- Si el dueño protege `main`, debe permitir el push del bot.
- Las series cerradas conservan su último punto indefinidamente (pocos bytes; ver D-10 del DRT).

## Alternativas consideradas

- **Rama `data` separada:** `main` más limpia, pero dos checkouts, y es incierto si los commits fuera de la rama por defecto cuentan como actividad (R-04).
- **Un JSON por producto reescrito entero:** diffs ruidosos.
- **CSV:** sin tipos ni campos opcionales por tipo de serie.
- **Registrar fallas como puntos:** commits cada 6 h por una tienda bloqueada.
- **SQLite en el repo:** binario, sin diffs legibles.
