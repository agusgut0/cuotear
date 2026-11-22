# ADR-0014: Mercado Libre y tiendas candidatas (Frávega, Rodo, Musimundo) diferidas

- Estado: Diferido
- Fecha: 2026-11-22
- Requisitos: RF-04, RF-05, RNF-01, RNF-07, R-01, R-02, S-35, S-36 · DAF Q-7, Q-18 · DRT sección 20.1

## Contexto

El spike mostró: MejoresCompras (fuente prevista para Mercado Libre) y Frávega responden 403 a los runners de GitHub (Cloudflare y CloudFront); Rodo no trae precios en el HTML inicial; Musimundo no tiene catálogo propio. Alternativas para Mercado Libre: API oficial (la documentación de Items y Búsquedas muestra llamadas con token Bearer; requiere crear una aplicación y gestionar OAuth), carga manual de precios o un runner propio con otra IP (rompe RNF-01).

## Decisión

- Ninguna de estas fuentes entra en v1. Sus dominios no son válidos en la configuración.
- No se evaden bloqueos (RNF-07).
- Disparadores para reabrir:
  - Mercado Libre: pedido del dueño ⇒ spike desde un runner con una aplicación de Mercado Libre (token en secretos) para verificar acceso, límites, y si la API expone cuotas sin interés por tarjeta y medios de un pago; ADR nuevo con el resultado.
  - Frávega: un spike desde runner que responda 200 en un endpoint permitido por robots.txt.
  - Rodo: hallazgo de un endpoint JSON público permitido.
  - Musimundo: reaparición de catálogo propio (o confirmación de que redirige a On City, que ya se mide).
  - Revisión manual semestral de las candidatas.

## Consecuencias

- Mercado Libre queda sin cobertura en v1; MejoresCompras sigue siendo la alternativa manual del dueño (DAF sección 12).
- Agregar cualquiera de ellas en el futuro sigue el procedimiento de extensión (DRT sección 22) sin tocar el núcleo.

## Alternativas consideradas

- **API oficial de Mercado Libre ya en v1:** no verificada desde runners; OAuth con renovación de tokens agrega secretos y complejidad; no se sabe si da cuotas por tarjeta.
- **Carga manual de precios:** rompe la fuente única de verdad y no aporta series automáticas.
- **Runner propio o proxy residencial:** costo y/o evasión de bloqueos (RNF-01, RNF-07).
