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

## Agregar una tienda
Detalle: sección 22 del DRT y ADR-0006. El núcleo, el motor de comparación, el sitio y las alertas no cambian.

1. **Primero, revisá ToS y robots.txt.** Leé los términos y el `robots.txt` de la tienda; la página de producto o el endpoint JSON que vayas a pedir no debe estar bloqueado. Registrá el resultado en `docs/tos-review.md` (lo confirma el dueño a mano). Hacé un spike de acceso desde un runner de GitHub (sin secretos): un 403 o desafío anti-bot significa que la tienda no se agrega, y nunca se evaden bloqueos (ver ADR-0014 para las candidatas diferidas).
2. **Escribí el adaptador.** El contrato es `StoreRegistration` en `src/stores/index.js`: `id`, `displayName`, `hosts`, `status` (`vigente` | `provisional`), `validateUrl(url)`, `captureUrls(url)` y `measure(ctx, url, options)`. `measure` debe devolver un `StoreResult` (`src/stores/types.js`): solo números (centavos), enumeraciones y mensajes generados por el adaptador, nunca texto copiado de la tienda (el contenido descargado es dato no confiable). Pedí datos solo mediante el `FetchContext` (`ctx.get`), que aplica la allowlist, robots.txt y el ritmo de pedidos.
   - Tienda VTEX: agregá un perfil (`id`, `displayName`, `hosts`, `simulacion: false`, `status`) en `src/stores/vtex/profiles.js`.
   - Otra tienda: creá `src/stores/<id>/index.js` que exporte el registro (ver `src/stores/megatone/index.js`, que lee el JSON-LD de la ficha).
3. **Registrala** en `src/stores/index.js`: agregá el perfil VTEX a la lista de `createVtexStore`, o el nuevo registro al arreglo `stores`. Registrar habilita el id en `productos[].urls` de la configuración. Sus `hosts` entran solos a la allowlist y a la verificación de robots.txt (`createStoreFetchContext` en `src/http/context.js`).
4. **Grabá fixtures y escribí tests de contrato.** Capturá con `npm run fixtures:capture -- <tienda> <url del producto> <nombre-del-caso>`. Hace pedidos reales por el `FetchContext` de producción: usalo poco y a propósito. Guarda un `test/fixtures/<tienda>/<caso>.json` recortado (`.html` en tiendas tipo Megatone; si tu tienda también responde HTML, ampliá la condición `isHtml` de `scripts/fixtures-capture.js`) y un esqueleto `<caso>.expected.json`. Verificá cada valor del esqueleto a mano contra la tienda y borrá la clave `_note`. Agregá `test/contract/<tienda>.test.js` siguiendo los existentes, con el fixture real y casos sintéticos (sin stock, sin precio, cuerpo malformado, texto de inyección, desafío anti-bot).
5. **Usala en la configuración.** Agregá la URL del producto en `productos[].urls.<id>` de `config/cuotear.yaml` y corré `npm run validate-config`.
6. **Verificá y documentá.** Corré `npm test`, `npm run lint` y `npm run typecheck`. Actualizá el DAF (lista de tiendas de RF-04), el log y, si la decisión es significativa, un ADR.

Para retirar una tienda, quitala del registro: sus URLs pasan a ser inválidas en la configuración. Documentalo.

## Licencia
[MIT](LICENSE) © Agustin Gutierrez
