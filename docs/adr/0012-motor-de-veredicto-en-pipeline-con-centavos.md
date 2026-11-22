# ADR-0012: Motor de comparación y reglas en el pipeline, importes en centavos enteros

- Estado: Aceptado
- Fecha: 2026-11-22
- Requisitos: RF-21, RF-22, RN-08, RN-11, RN-12, RN-13, S-07, S-08, S-10, S-26, S-31 · DAF Q-9 · DRT secciones 12 y 13

## Contexto

El veredicto (VP de las cuotas vs contado), la mejor opción y las reglas de alerta deben ser reproducibles, testeables con el ejemplo numérico del DAF (±1 peso) y consistentes entre el sitio y las alertas. Las bajas se definen como "estrictamente menor", y los porcentajes de borde (−1,00 %, −90 % exacto) deben comportarse según el DAF.

## Decisión

- Todo el cálculo corre **en el pipeline** (Node), en funciones puras de `src/core/compare.js` y `src/core/rules.js`; el sitio solo muestra resultados.
- Importes medidos y guardados en **centavos enteros**; comparaciones de baja e igualdad en enteros.
- VP por suma directa en doble precisión; comparación VP vs Pc en centavos redondeados; porcentajes como `dif × 100 / Pc`; redondeo al peso solo al mostrar.
- Reglas que dependen de la mejor opción (`cambio_mejor_opcion`, `precio_objetivo` con `mejor_vp`) se evalúan sobre las series elegibles en **ambas** ejecuciones y con la `r` **anterior**, para que ni la entrada/salida de series ni un cambio de `r`, `s` o configuración disparen alertas.
- Tests obligatorios: escenarios A, B y C y todos los criterios de aceptación de RF-21 y RF-22.

## Consecuencias

- Mismos números en sitio y alertas; sin cálculo en el navegador.
- Necesita los valores y la elegibilidad de la ejecución anterior (historial + estado); con estado perdido se suprimen esas reglas una vez (S-25).
- Los importes en el historial no son "legibles a simple vista" (centavos), a cambio de exactitud.

## Alternativas consideradas

- **Cálculo en el navegador:** requiere JS y duplica lógica con las alertas.
- **Librería decimal (decimal.js, big.js):** dependencia sin necesidad para estas magnitudes.
- **Importes en pesos con decimales flotantes:** errores de igualdad en bajas de centavos.
