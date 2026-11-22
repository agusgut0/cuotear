# ADR-0013: Aviso anticipado de inactividad para evitar la suspensión del cron (sin commit de latido)

- Estado: Aceptado
- Fecha: 2026-11-22
- Requisitos: R-04, RF-07, RNF-10, RNF-15, S-25 · DAF Q-11 · DRT sección 10.3

## Contexto

GitHub deshabilita los workflows programados de repos públicos tras 60 días sin actividad en el repositorio. No hay confirmación oficial de que los commits de `github-actions[bot]` cuenten como actividad (la práctica comunitaria de "keepalive" sugiere que sí). Una vez suspendido, el workflow no puede avisar. S-25 descarta el commit de latido en v1.

## Decisión

- En cada ejecución se lee la fecha del último commit de `main` desde el repo clonado (sin API). Si supera **45 días**, se abre el aviso operativo `inactividad` (issue `cuotear-ops`) indicando que el dueño haga un commit o revise la pestaña Actions.
- Los commits de historial (frecuentes cuando cambian precios) actúan como actividad en la práctica.
- Sin commit de latido ni llamada a la API para reactivar el workflow en v1 (evita `actions: write`).
- Diferido con disparador (primera suspensión observada): llamar a `PUT /repos/{owner}/{repo}/actions/workflows/{id}/enable` o un commit de latido mensual, con ADR nuevo.

## Consecuencias

- El dueño recibe una notificación 15 días antes de la suspensión.
- El checkout necesita historial suficiente para conocer la fecha del último commit (`fetch-depth: 1` alcanza: el HEAD es el último commit).
- Si el bot no cuenta como actividad y el dueño no actúa, el cron se suspende; GitHub muestra un banner y el dueño reactiva manualmente.

## Alternativas consideradas

- **Commit de latido automático:** contradice S-25 y ensucia el historial.
- **Reactivación por API en cada ejecución:** efecto no verificado y privilegio adicional.
- **Monitoreo externo (otro servicio de cron):** agrega un servicio fuera de GitHub.
