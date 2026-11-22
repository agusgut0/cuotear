# ADR-0010: Inflación esperada desde la API del BCRA (Estadísticas Monetarias v4.0, variable 29) con tasa constante

- Estado: Aceptado
- Fecha: 2026-11-22
- Requisitos: RF-21, RN-11, S-07, S-09, R-06 · DAF Q-3 · DRT sección 13.4

## Contexto

RF-21 descuenta las cuotas con la inflación mensual esperada `r`, de fuente REM (BCRA) o manual, con respaldo último valor ⇒ manual ⇒ sin veredicto. S-07 propone promediar las expectativas mensuales de los próximos `h = n` meses. Verificado el 2026-11-22:
- La API "Principales Variables" v3.0 tiene fecha de deprecación 2026-02-28; la vigente es **Estadísticas Monetarias v4.0**.
- `https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/29` = "Mediana de la variación interanual próximos 12 meses del IPC del REM", mensual, en %; último dato 2026-10-31 = 21,8. Respuesta `{status, metadata.resultset, results[{idVariable, detalle[{fecha, valor}]}]}`, sin autenticación observada.
- El vector de expectativas mensuales del REM está solo en PDF y XLSX mensuales con nombres de archivo no del todo consistentes.

## Decisión

- `fuente: rem` usa el valor más reciente `A` de la variable 29: `r = (1 + A/100)^(1/12) − 1`, constante para cualquier `n` (ST-10).
- Consulta como máximo diaria; dato vigente si tiene ≤ 70 días (si no, se usa marcado "desactualizado").
- Respaldo: último valor del estado ("desactualizado") ⇒ `manual` de la configuración ("respaldo") ⇒ sin `r` ("sin veredicto", comparación nominal).
- Validación de forma de la respuesta con Ajv; TLS siempre verificado.
- El promedio de `h = n` meses de S-07 queda **diferido** con disparador (desvío > 0,3 p.p. mensuales durante dos meses frente a la expectativa del próximo mes del REM, o pedido del dueño).

## Consecuencias

- Fuente oficial, JSON, gratuita y sin dependencia nueva.
- Para n distinto de 12 la tasa es una aproximación (más gruesa en 15–18 cuotas). Se muestra siempre `r`, fuente y fecha.
- No verificado: acceso desde runners de GitHub (IPs fuera de Argentina) y validez de la cadena TLS en Node; se prueba en F2/F5 y, si falla, opera el respaldo.
- La API ya cambió de versión una vez: la URL base y el id viven en una constante única.

## Alternativas consideradas

- **Parsear el XLSX del REM:** cumple S-07 a la letra, pero exige una dependencia de XLSX (históricamente con problemas de distribución y seguridad) y adivinar nombres de archivo.
- **Solo manual:** simple, pero desactualizable; queda como respaldo.
- **Otras fuentes (consultoras, mercado de bonos):** no oficiales o sin API estable.
