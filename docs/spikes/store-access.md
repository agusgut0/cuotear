# Spike: acceso a tiendas y extracción de precios

- **Producto de prueba:** TCL 75T6C.
- **Script:** [scripts/spike/store-access.mjs](../../scripts/spike/store-access.mjs) (Node ≥ 20, sin dependencias, 1 pedido/s por dominio, timeout 15 s, User-Agent identificable, sin login ni captchas).
- **Workflow:** [.github/workflows/spike-store-access.yml](../../.github/workflows/spike-store-access.yml) (solo `workflow_dispatch`, `contents: read`, acciones fijadas por SHA, sin secretos, 10 min).
- **Relacionado:** riesgo R-01 y preguntas 5–8 del DRT en [docs/specs/DAF.md](../specs/DAF.md).
- **Estado:** corrida local (IP argentina) y corrida en GitHub Actions (runner `ubuntu-24.04`, Node 22, 2026-11-22, run #1 por push) completadas. Ambas incluyen la investigación de contado.

## Resultados por tienda

Leyenda: Lista = precio de lista; Contado = precio de un pago con su condición; V/M/N = cuotas sin interés Visa / Mastercard / Naranja X.

| Tienda | Local (IP AR) | Actions | Lista | Contado | V / M / N |
|---|---|---|---|---|---|
| On City | 200, JSON (API VTEX), 1 producto | 200, JSON, igual que local (708 ms) | Sí (2.299.999) | Parcial (ver notas) | 15x / 18x / 12x |
| Carrefour | 200, JSON (API VTEX, Cloudflare), 3 ofertas | 200, JSON, igual que local (371 ms) | Sí (lista 2.999.999, precio 2.189.999) | Parcial (medio "Efectivo", mismo valor que el precio) | No / 3x / No |
| Cetrogar | 200, JSON (API VTEX), 1 producto | 200, JSON, igual que local (526 ms) | Sí (2.299.999) | Parcial (ver notas) | 15x / 15x / 12x |
| Naldo | 200, JSON (API VTEX), **0 coincidencias** | 200, JSON, 0 coincidencias (igual) | Sin dato (el modelo no figura) | Sin dato | Sin dato |
| Musimundo | 200, pero redirige a la home (HTML estático) | 200, HTML estático (igual) | No | No | No |
| Frávega | 200, HTML con `__NEXT_DATA__` | **403 bloqueado** (CloudFront) | Sí (2.299.999) | No | No (solo filtros genéricos) |
| Megatone | Búsqueda: 404. URL de producto directa: 200, HTML | 200, HTML, igual que local (980 ms) | Sí (2.299.999, JSON-LD) | No | No |
| Rodo | 200 (Cloudflare), HTML sin precios | 200, HTML sin precios (igual) | No | No | No |
| MejoresCompras (ML) | 200 (Cloudflare), HTML | **403 bloqueado** (Cloudflare, "Just a moment...") | Sí (1.779.999; JSON-LD 1.902.299) | No | No |

Tiempos locales: 70–1.100 ms por pedido; ningún bloqueo, captcha ni timeout. En Actions: 250–1.700 ms, **dos bloqueos 403** (Frávega y MejoresCompras) y ningún timeout.

## Notas por tienda

**VTEX (On City, Carrefour, Cetrogar, Naldo).** `/api/catalog_system/pub/products/search?ft=75t6c` responde JSON sin autenticación. Cada oferta trae `ListPrice`, `Price` y `Installments[]` con `PaymentSystemName`, `NumberOfInstallments`, `Value`, `TotalValuePlusInterestRate` e `InterestRate`.
- **Cuotas sin interés por tarjeta:** salen de `Installments` filtrando por sistema de pago (Visa, Mastercard, Naranja) con `InterestRate = 0` y tomando el mayor número de cuotas. Funciona en On City y Cetrogar.
- **Contado:** `Teasers`, `PromotionTeasers` y `DiscountHighLight` vinieron **vacíos** en las tres tiendas con el producto. Hay líneas de un pago por medio de pago (Visa, Mastercard, "Cabal Débito" en On City; "Efectivo" en Carrefour; "Transferencia Bancaria - Con descuento adicional" en Cetrogar), pero **todas con el mismo valor que `Price`**. Es decir, la API no expone un descuento de contado distinto del precio publicado; el medio de pago aparece, pero no el descuento. Si existe un descuento adicional por transferencia, probablemente se aplica en el checkout o en otra fuente (a investigar). Con lo observado, el contado queda como "precio de un pago, condición = medio de pago", sin descuento adicional demostrado.
- **Carrefour:** devuelve dos vendedores para el mismo producto. Uno (DMAKER S.A.) con precio 2.189.999 y otro (CARREFOUR) con precio 0 y sin medios de pago (sin stock). Hace falta una regla de selección de vendedor y de oferta sin stock. Solo ofrece Mastercard 3 cuotas sin interés.
- **Naldo:** la API funciona pero el TCL 75T6C no figura (vende otros TCL de 75"). No se pudo validar la extracción con un producto en stock. La URL de búsqueda y el formato son los mismos que en las demás tiendas VTEX.

**Musimundo.** No responde como VTEX: tanto `/api/catalog_system/...` como `/search?q=` redirigen a la home, una página estática alojada en S3 con un banner que enlaza a On City. **Hipótesis (sin verificar):** el sitio está siendo migrado o integrado a On City. Sin endpoint utilizable.

**Frávega.** El HTML renderizado en servidor incluye `__NEXT_DATA__` con el producto: `salePrice`, `listPrice`, descuento y `withoutTax` (2.299.999 / 2.299.999 / 0 % / 1.900.826 sin impuestos). Las cuotas aparecen solo como filtros agregados ("9 cuotas sin interés"), no por tarjeta, y no hay contado por medio de pago en esa respuesta. Posiblemente la ficha del producto o un endpoint interno tenga más detalle (no probado).

**Megatone.** `/search/?q=` y `/busqueda/?q=` devuelven 404 (la home es una SPA grande, `/next/...`), pero la **URL de producto directa** responde 200 con HTML de ~55 KB y JSON-LD con el precio (2.299.999). No trae cuotas por tarjeta ni contado en el HTML inicial. Sirve si el usuario carga la URL del producto en la configuración (RF-19), no para buscar por nombre.

**Rodo.** Magento detrás de Cloudflare. La búsqueda responde 200 y menciona el producto, pero el HTML inicial no trae precios (se cargan por JavaScript o por otro endpoint). Necesita descubrir ese endpoint.

**MejoresCompras.** La página del producto (MLA75633247) responde 200. Trae precio actual y JSON-LD, pero ningún dato de contado ni de cuotas por tarjeta, y el valor es de Mercado Libre (1.779.999), no comparable con las otras tiendas. Es la fuente best effort ya prevista en el DAF.

## Qué no cubre este spike

- Búsqueda a mano de los endpoints internos de Frávega, Megatone y Rodo (requiere inspeccionar el navegador).
- Descuentos de contado que solo se apliquen con un paso real de checkout (login, cupón, medio de pago concreto).
- Estabilidad a lo largo del tiempo y límites de tasa con más pedidos.
- Términos de uso y robots.txt de cada tienda (RNF-07, DRT pregunta 8).

## Cómo correrlo en GitHub Actions

`gh` no está instalado en esta máquina. Desde la web:

1. Hacé push de la rama `spike/store-access`.
2. Un workflow con `workflow_dispatch` solo aparece en la pestaña **Actions** si el archivo existe en la **rama por defecto**. Si no aparece, hay que llevar el archivo `.github/workflows/spike-store-access.yml` a la rama por defecto (por ejemplo, con un PR) y luego elegir la rama del spike en el selector **Run workflow**.
3. Actions → **Spike - store access** → **Run workflow** → rama `spike/store-access`.
4. Al terminar, bajá el artifact `store-access-actions` (archivo `store-access-actions.json`) y pasame el contenido o su ruta para completar la columna "Actions".

Con `gh` instalado: `gh workflow run spike-store-access.yml --ref spike/store-access` y `gh run download`.

## Local vs Actions: diferencias

- **Idénticas** (mismo estado, mismos datos extraíbles): On City, Carrefour, Cetrogar, Naldo, Musimundo, Megatone y Rodo. Las simulaciones de checkout VTEX también dieron los mismos totales desde Actions, sin ningún medio de pago por debajo del precio publicado.
- **Frávega:** 200 en local, **403 desde Actions** (respuesta de CloudFront). Los runners de GitHub (IPs de datacenter) quedan bloqueados.
- **MejoresCompras:** 200 en local, **403 desde Actions** con la página de desafío de Cloudflare ("Just a moment..."). Sin resolver captchas ni evadir el desafío, la fuente de Mercado Libre no se puede leer desde los runners.
- Esto confirma el riesgo R-01 del DAF: el bloqueo de IPs de datacenter es real, pero solo afecta a 2 de las 9 tiendas; las APIs VTEX no discriminan.

## Recomendación

| Tienda | Recomendación | Motivo |
|---|---|---|
| On City | **Incluir** | API JSON estable; lista y cuotas por las 3 tarjetas. |
| Cetrogar | **Incluir** | Igual que On City. |
| Carrefour | **Incluir con degradación** | Funciona, pero con selección de vendedor, sin stock en una oferta y solo Mastercard 3 cuotas. |
| Naldo | **Incluir con degradación** (provisional) | API VTEX utilizable, pero sin producto de prueba en stock; validar con otro modelo. |
| Frávega | **Descartar de v1 por ahora** | 403 desde Actions; además solo se obtenía lista. No se evade el bloqueo. Reabrir si hay otro endpoint no bloqueado o un runner con otra IP. |
| MejoresCompras (ML) | **No viable desde Actions** | Cloudflare bloquea al runner (403). Mercado Libre queda sin cobertura salvo que el DRT encuentre otra fuente (por ejemplo, la API oficial de Mercado Libre; a verificar). |
| Rodo | **Descartar de v1 por ahora** | Sin precios en el HTML inicial; reabrir si se encuentra un endpoint. |
| Megatone | **Incluir con degradación** | Solo con URL de producto directa y solo precio de lista; sin búsqueda accesible. |
| Musimundo | **Descartar de v1 por ahora** | No expone catálogo (redirige a la home); posible migración a On City. |

**Cobertura resultante en v1 (desde Actions):** On City, Cetrogar, Carrefour, Naldo (provisional) y Megatone (solo URL de producto). Es decir, 5 de las 9 tiendas del DAF; Musimundo, Rodo, Frávega y Mercado Libre quedan fuera por ahora. Esto activa la cláusula de RF-04 ("la lista puede reducirse tras el spike") y exige que el DRT decida cómo tratar Mercado Libre.

**Contado:** ver la sección "Contado". Con lo observado, ninguna tienda expone un descuento de contado distinto del precio publicado, ni siquiera simulando el checkout. La recomendación final se confirma cuando esté la corrida de Actions.

## Contado

Investigación adicional (corridas local y Actions, 2026-11-22; resultados idénticos en las tiendas VTEX): ¿algún medio de pago baja el total por debajo del precio publicado?

**VTEX: simulación de checkout** (`POST /api/checkout/pub/orderForms/simulation`, 1 unidad, país ARG, código postal 5000, SKU y vendedor tomados de la API de búsqueda).

| Tienda | Total simulado | Medios de pago con total en 1 pago | ¿Alguno menor que el publicado? |
|---|---|---|---|
| On City | 2.299.999 (publicado 2.299.999) | 12 (Amex, Visa, Mastercard, Visa Electron, Cabal, Naranja, Maestro, MercadoPagoPro, Modo, On City Crédito, Patagonia 365, Cabal Débito) | No: todos 2.299.999 |
| Cetrogar | 2.299.999 (publicado 2.299.999) | 12 (incluye "Transferencia Bancaria - Con descuento adicional" y "Mastercard Debit") | No: todos 2.299.999 |
| Carrefour | 2.189.999 (publicado 2.189.999, vendedor Producteca225119) | 15 (incluye "Efectivo") | No: todos 2.189.999 |

- El endpoint responde 200 sin autenticación en las tres tiendas y devuelve `paymentData.installmentOptions` por medio de pago.
- `messages` y promociones de precio vacíos. Cetrogar solo devuelve una promoción de envío ("25% valor envio"), no de precio.
- **Conclusión:** el nombre del medio de pago puede sugerir un descuento ("Transferencia Bancaria - Con descuento adicional"), pero la simulación no lo refleja en el total. Si ese descuento existe, se aplica en un paso posterior del checkout o requiere condiciones que no se pueden simular de forma anónima. No hay forma de obtenerlo con estos endpoints.

**Frávega.** Se leyeron la búsqueda y las 3 fichas de producto (HTML renderizado en servidor). Aparecen solo textos genéricos ("descuento", "% off") y ningún texto de transferencia, efectivo o precio especial. Además el HTML de la ficha **no trae el precio** (se carga después por JavaScript), por lo que tampoco se pudo comparar contra un precio menor. El único precio verificado es el de la búsqueda (`salePrice` = `listPrice` = 2.299.999, sin descuento). Hay un listado de vendedor "Multipoint" (marketplace).

**Megatone.** La ficha directa trae el precio en JSON-LD (2.299.999) y solo textos genéricos de "descuento"; ninguna mención a transferencia, efectivo o precio menor.

**Qué significa para el DAF y el DRT (RF-20, RN-05, RN-14):**
1. En las tiendas probadas, el **contado observable es el precio publicado**, con su medio de pago como condición (por ejemplo "efectivo" en Carrefour). No se pudo demostrar ningún descuento de contado adicional.
2. El modelo de datos debe permitir `contado = precio publicado, condición = medio de pago` (descuento 0 %) y dejar espacio para un descuento cuando una tienda lo exponga.
3. La diferencia contado vs cuotas (RF-21) seguirá siendo útil igual: compara el precio de un pago contra el total en cuotas sin interés, aunque ambos suelan coincidir en monto nominal.
4. Queda abierto si existen descuentos que solo se ven en el checkout real; no se pueden automatizar sin login.
