# ADR-0011: Sitio estático generado sin framework, sin JS en el cliente, desplegado en Pages desde artefacto

- Estado: Aceptado
- Fecha: 2026-11-22
- Requisitos: RF-17, RNF-03, RNF-06, RNF-08, RN-01, S-20, S-22, S-30, S-34 · DAF Q-10, Q-11 · DRT sección 14

## Contexto

El sitio es de solo lectura, con dos pantallas (lista y detalle con gráfico escalonado y tabla alternativa), en es-AR y en, accesible (WCAG 2.2 AA), compatible con Baseline Widely available, regenerado en cada ejecución y publicado sin commits.

## Decisión

- Generador propio en Node (`src/site/`): plantillas con una función etiquetada `html` que escapa todo por defecto; datos embebidos en el HTML.
- **Sin JavaScript en el navegador.** Gráfico SVG escalonado generado en el servidor (`role="img"`, `<title>`/`<desc>`, series distinguibles por trazo y marcador además del color) con **tabla visible** como alternativa.
- i18n por rutas: `/` (es-AR) y `/en/`, catálogos JSON con test de paridad de claves; `Intl` para números, moneda y hora de Argentina; condición de contado generada desde datos estructurados.
- CSP por `<meta>` (`default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'`).
- Publicación: `actions/upload-pages-artifact` + `actions/deploy-pages` (fuente de Pages: "GitHub Actions"); sin rama `gh-pages`.
- Validación: `html-validate` en CI y revisión manual WCAG 2.2 AA (teclado, lector de pantalla, contraste) por fase.

## Consecuencias

- Superficie de XSS mínima (sin JS, sin HTML crudo, sin texto de tiendas) y sitio liviano (< 1 MB, muy por debajo de 1 GB).
- Sin interactividad (tooltips, zoom); la tabla cubre la consulta de valores exactos.
- La preferencia de idioma no se recuerda (la URL es la preferencia).
- La auditoría automática no cubre contraste real ni lectores de pantalla (brecha parcial de RNF-08).

## Alternativas consideradas

- **Astro / Eleventy / Hugo:** cómodos, pero cientos de dependencias o un binario extra para dos plantillas.
- **SPA con librería de gráficos (Chart.js, D3):** JS en el cliente, accesibilidad del canvas más difícil, más superficie.
- **Rama `gh-pages`:** genera commits en cada ejecución (contradice la sección 9 del DAF).
- **Persistir el idioma con `localStorage`:** requiere JS y produce parpadeo en la redirección.
