# ADR-0002: Configuración en YAML 1.2 validada con JSON Schema y reglas semánticas

- Estado: Aceptado
- Fecha: 2026-11-22
- Requisitos: RF-19, RF-02, RF-04, RF-05, RF-22, RNF-11, RNF-14 · DAF Q-1 · DRT sección 4

## Contexto

El dueño define productos, URLs por tienda, reglas de alerta, canal y parámetros de comparación en un archivo del repo, editado a mano (a veces desde la web de GitHub). La validación debe rechazar más de 10 productos, dominios no permitidos, campos desconocidos, URLs duplicadas, más de una URL por tienda, `r < 0`, `s ∉ {0,1}` y secretos, con mensajes que indiquen archivo y campo. Si la configuración es inválida, el relevamiento sigue con la última válida.

## Decisión

- Archivo `config/cuotear.yaml` (YAML 1.2, paquete `yaml` con `uniqueKeys: true`) y esquema `config/cuotear.schema.json` (JSON Schema 2020-12, Ajv). `additionalProperties: false` en todos los objetos.
- `urls` es un mapa `tienda → URL`: una URL por tienda por producto por construcción.
- Una capa semántica posterior valida contra el **registro de adaptadores** (tiendas vigentes/provisionales, host exacto, patrón de ruta por adaptador), unicidad de URLs normalizadas e ids, y rechazo de valores con forma de secreto. Así agregar una tienda no cambia el esquema (RF-05).
- Desactivar una regla: `false` o `"no"` (en YAML 1.2 `no` es un string).
- Mensajes en es-AR con `archivo:línea:columna` y ruta (`productos[2].urls.oncity`).
- La validación corre en CI (PR y push) y al inicio de cada ejecución; la última configuración válida vive en el estado (ADR-0004).

## Consecuencias

- Comentarios y legibilidad para el dueño; autocompletado en editores con la directiva `yaml-language-server`.
- Dos dependencias de ejecución (`yaml`, `ajv`).
- Las claves de la configuración están en español (como en el DAF), aunque el código esté en inglés.

## Alternativas consideradas

- **JSON:** sin dependencia de parseo, pero sin comentarios; peor para edición manual.
- **TOML:** menos difundido para listas de objetos anidados; requiere dependencia igual.
- **Esquema con la lista de tiendas incrustada:** obliga a tocar el esquema al agregar un adaptador (contradice RF-05).
- **Validación hecha a mano sin JSON Schema:** sin autocompletado ni contrato estándar.
