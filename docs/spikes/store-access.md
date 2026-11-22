# Spike: acceso a tiendas y extracción de precios

- **Producto de prueba:** TCL 75T6C.
- **Script:** [scripts/spike/store-access.mjs](../../scripts/spike/store-access.mjs) (Node ≥ 20, sin dependencias, 1 pedido/s por dominio, timeout 15 s, User-Agent identificable, sin login ni captchas).
- **Workflow:** [.github/workflows/spike-store-access.yml](../../.github/workflows/spike-store-access.yml) (solo `workflow_dispatch`, `contents: read`, acciones fijadas por SHA, sin secretos, 10 min).
- **Relacionado:** riesgo R-01 y preguntas 5–8 del DRT en [docs/specs/DAF.md](../specs/DAF.md).
- **Estado:** corrida local hecha el 2026-11-22 (IP argentina). **La corrida en GitHub Actions está pendiente**; la columna "Actions" y la recomendación final se completan después.

## Resultados por tienda

Leyenda: Lista = precio de lista; Contado = precio de un pago con su condición; V/M/N = cuotas sin interés Visa / Mastercard / Naranja X.

| Tienda | Local (IP AR) | Actions | Lista | Contado | V / M / N |
|---|---|---|---|---|---|
| On City | 200, JSON (API VTEX), 1 producto | pendiente | Sí (2.299.999) | Parcial (ver notas) | 15x / 18x / 12x |
| Carrefour | 200, JSON (API VTEX, Cloudflare), 3 ofertas | pendiente | Sí (lista 2.999.999, precio 2.189.999) | Parcial (medio "Efectivo", mismo valor que el precio) | No / 3x / No |
| Cetrogar | 200, JSON (API VTEX), 1 producto | pendiente | Sí (2.299.999) | Parcial (ver notas) | 15x / 15x / 12x |
| Naldo | 200, JSON (API VTEX), **0 coincidencias** | pendiente | Sin dato (el modelo no figura) | Sin dato | Sin dato |
| Musimundo | 200, pero redirige a la home (HTML estático) | pendiente | No | No | No |
| Frávega | 200, HTML con `__NEXT_DATA__` | pendiente | Sí (2.299.999) | No | No (solo filtros genéricos) |
| Megatone | 404 en las URL de búsqueda probadas | pendiente | No | No | No |
| Rodo | 200 (Cloudflare), HTML sin precios | pendiente | No | No | No |
| MejoresCompras (ML) | 200 (Cloudflare), HTML | pendiente | Sí (1.779.999; JSON-LD 1.902.299) | No | No |

Tiempos locales: 70–1.100 ms por pedido; ningún bloqueo, captcha ni timeout.

## Notas por tienda

**VTEX (On City, Carrefour, Cetrogar, Naldo).** `/api/catalog_system/pub/products/search?ft=75t6c` responde JSON sin autenticación. Cada oferta trae `ListPrice`, `Price` y `Installments[]` con `PaymentSystemName`, `NumberOfInstallments`, `Value`, `TotalValuePlusInterestRate` e `InterestRate`.
- **Cuotas sin interés por tarjeta:** salen de `Installments` filtrando por sistema de pago (Visa, Mastercard, Naranja) con `InterestRate = 0` y tomando el mayor número de cuotas. Funciona en On City y Cetrogar.
- **Contado:** `Teasers`, `PromotionTeasers` y `DiscountHighLight` vinieron **vacíos** en las tres tiendas con el producto. Hay líneas de un pago por medio de pago (Visa, Mastercard, "Cabal Débito" en On City; "Efectivo" en Carrefour; "Transferencia Bancaria - Con descuento adicional" en Cetrogar), pero **todas con el mismo valor que `Price`**. Es decir, la API no expone un descuento de contado distinto del precio publicado; el medio de pago aparece, pero no el descuento. Si existe un descuento adicional por transferencia, probablemente se aplica en el checkout o en otra fuente (a investigar). Con lo observado, el contado queda como "precio de un pago, condición = medio de pago", sin descuento adicional demostrado.
- **Carrefour:** devuelve dos vendedores para el mismo producto. Uno (DMAKER S.A.) con precio 2.189.999 y otro (CARREFOUR) con precio 0 y sin medios de pago (sin stock). Hace falta una regla de selección de vendedor y de oferta sin stock. Solo ofrece Mastercard 3 cuotas sin interés.
- **Naldo:** la API funciona pero el TCL 75T6C no figura (vende otros TCL de 75"). No se pudo validar la extracción con un producto en stock. La URL de búsqueda y el formato son los mismos que en las demás tiendas VTEX.

**Musimundo.** No responde como VTEX: tanto `/api/catalog_system/...` como `/search?q=` redirigen a la home, una página estática alojada en S3 con un banner que enlaza a On City. **Hipótesis (sin verificar):** el sitio está siendo migrado o integrado a On City. Sin endpoint utilizable.

**Frávega.** El HTML renderizado en servidor incluye `__NEXT_DATA__` con el producto: `salePrice`, `listPrice`, descuento y `withoutTax` (2.299.999 / 2.299.999 / 0 % / 1.900.826 sin impuestos). Las cuotas aparecen solo como filtros agregados ("9 cuotas sin interés"), no por tarjeta, y no hay contado por medio de pago en esa respuesta. Posiblemente la ficha del producto o un endpoint interno tenga más detalle (no probado).

**Megatone.** `/search/?q=` y `/busqueda/?q=` devuelven 404. La home es una SPA grande (`/next/...`). No se descubrió un endpoint de búsqueda con pedidos HTTP simples; necesita inspeccionar el tráfico del navegador (fuera de este spike).

**Rodo.** Magento detrás de Cloudflare. La búsqueda responde 200 y menciona el producto, pero el HTML inicial no trae precios (se cargan por JavaScript o por otro endpoint). Necesita descubrir ese endpoint.

**MejoresCompras.** La página del producto (MLA75633247) responde 200. Trae precio actual y JSON-LD, pero ningún dato de contado ni de cuotas por tarjeta, y el valor es de Mercado Libre (1.779.999), no comparable con las otras tiendas. Es la fuente best effort ya prevista en el DAF.

## Qué no cubre este spike

- Búsqueda a mano de los endpoints internos de Frávega, Megatone y Rodo (requiere inspeccionar el navegador).
- Si el contado con descuento adicional existe en otra parte (checkout, promos).
- Estabilidad a lo largo del tiempo y límites de tasa con más pedidos.
- Términos de uso y robots.txt de cada tienda (RNF-07, DRT pregunta 8).
- El resultado desde los runners de GitHub Actions (pendiente).

## Cómo correrlo en GitHub Actions

`gh` no está instalado en esta máquina. Desde la web:

1. Hacé push de la rama `spike/store-access`.
2. Un workflow con `workflow_dispatch` solo aparece en la pestaña **Actions** si el archivo existe en la **rama por defecto**. Si no aparece, hay que llevar el archivo `.github/workflows/spike-store-access.yml` a la rama por defecto (por ejemplo, con un PR) y luego elegir la rama del spike en el selector **Run workflow**.
3. Actions → **Spike - store access** → **Run workflow** → rama `spike/store-access`.
4. Al terminar, bajá el artifact `store-access-actions` (archivo `store-access-actions.json`) y pasame el contenido o su ruta para completar la columna "Actions".

Con `gh` instalado: `gh workflow run spike-store-access.yml --ref spike/store-access` y `gh run download`.

## Recomendación provisional (solo con datos locales)

| Tienda | Recomendación | Motivo |
|---|---|---|
| On City | **Incluir** | API JSON estable; lista y cuotas por las 3 tarjetas. |
| Cetrogar | **Incluir** | Igual que On City. |
| Carrefour | **Incluir con degradación** | Funciona, pero con selección de vendedor, sin stock en una oferta y solo Mastercard 3 cuotas. |
| Naldo | **Incluir con degradación** (provisional) | API VTEX utilizable, pero sin producto de prueba en stock; validar con otro modelo. |
| Frávega | **Incluir con degradación** | Solo lista; cuotas por tarjeta y contado requieren más investigación. |
| MejoresCompras (ML) | **Incluir con degradación** | Best effort: solo precio, catálogo limitado, snapshot diario. |
| Rodo | **Descartar de v1 por ahora** | Sin precios en el HTML inicial; reabrir si se encuentra un endpoint. |
| Megatone | **Descartar de v1 por ahora** | Sin URL de búsqueda accesible; reabrir si se encuentra un endpoint. |
| Musimundo | **Descartar de v1 por ahora** | No expone catálogo (redirige a la home); posible migración a On City. |

**Contado:** con lo observado, ninguna tienda expone un descuento de contado distinto del precio publicado. Eso afecta RF-20: el diseño debe prever "contado = precio de un pago con su medio de pago" y tratar los descuentos adicionales como un dato a investigar. La recomendación final se confirma cuando esté la corrida de Actions.
