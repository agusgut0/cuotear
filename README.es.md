[English](README.md) | **Español**

# cuotear

Monitor de precios sin servidor para tiendas online argentinas. Sigue hasta 10 productos y separa el **precio de contado** del **precio en cuotas sin interés** por tarjeta (Visa, Mastercard, Naranja X).

Primer caso: Smart TV TCL 75T6C.

## Estado
🔍 **En análisis.** Todavía no hay código de la aplicación.

## Roadmap
| Fase | Alcance | Entregable |
|---|---|---|
| 0. Análisis | Requisitos, tiendas, fuentes de precios | Documento de Análisis Funcional (DAF) |
| 1. Diseño | Arquitectura, modelo de datos, estrategia de scraping, seguridad | Documento de Requerimientos Técnicos (DRT), ADRs |
| 2. MVP | Scraper programado para TCL 75T6C, historial en JSON | Workflow de GitHub Actions |
| 3. Panel | Sitio estático con historial y comparación contado vs. cuotas | GitHub Pages (es-AR / en) |
| 4. Expansión | Hasta 10 productos, alertas | — |

## Stack previsto
- GitHub Actions (tareas programadas) — scraping y actualización de datos
- Node.js — scraper y procesamiento
- JSON en el repositorio — historial de precios
- GitHub Pages — panel estático, interfaz en es-AR y en
- Costo: cero

## Licencia
[MIT](LICENSE) © Agustin Gutierrez
