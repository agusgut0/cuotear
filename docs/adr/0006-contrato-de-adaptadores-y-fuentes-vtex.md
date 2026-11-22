# ADR-0006: Contrato de adaptadores de tienda; contado desde las líneas de 1 pago del catálogo VTEX

- Estado: Aceptado
- Fecha: 2026-11-22
- Requisitos: RF-03, RF-04, RF-05, RF-14, RF-20, RN-01, RN-06, RN-09, RN-10, RN-14, S-37, S-38, S-39, S-40 · DAF Q-6, Q-14, Q-15, Q-16, Q-17 · DRT sección 6

## Contexto

El spike (2026-11-22) mostró que la API de catálogo VTEX (`/api/catalog_system/pub/products/search`) entrega `Price`, `ListPrice` e `Installments` por medio de pago, incluidas líneas de 1 pago (débito, efectivo, transferencia) con el mismo valor que el precio publicado; y que la simulación de checkout tampoco expone descuentos de contado. robots.txt prohíbe la simulación en On City (`/*checkout*`) y toda la API en Cetrogar (`/api/`) (ADR-0007). Carrefour es un marketplace con varios vendedores por producto (uno a precio 0). Megatone solo expone precio en JSON-LD de la ficha.

## Decisión

- Interfaz `StoreAdapter` (`id`, `displayName`, `hosts`, `status`, `validateUrl`, `measure`) y resultado `StoreResult` (`outcome` ok/sin_stock/sin_oferta/falla, `listaCents`, `contado` estructurado, `tarjetas`). Los adaptadores solo usan el `FetchContext` común y solo emiten números, enumeraciones e ids validados (ningún texto de la tienda).
- **VTEX** (On City, Carrefour, Naldo): `GET /api/catalog_system/pub/products/search/<slug>/p`; arreglo vacío ⇒ `sin_oferta`; SKU único o `skuId` de la URL; vendedor: descartar precio 0/sin stock/no disponible, menor `Price`, desempates `sellerDefault` y `sellerId`. Lista = `Price` (no `ListPrice`).
- **Tarjetas:** nombre de medio normalizado **igual** a una lista permitida por tarjeta (Visa; Mastercard/Master Card; Naranja/Tarjeta Naranja/Naranja X); `InterestRate = 0`, `n ≥ 2`, mayor n; `|T − n × C| ≤ n` pesos o la serie es inválida. Marcas de tienda o banco se ignoran (RN-14).
- **Contado:** mínimo de las líneas de 1 pago clasificadas como transferencia, efectivo o débito (catálogo y, si está habilitada y permitida, simulación); medio por preferencia en empate; `descuento_pct` si la diferencia supera $1; sin candidatos ⇒ contado = lista con `{ninguno}`.
- **Simulación de checkout:** opcional por perfil, solo Carrefour y Naldo (robots.txt lo permite), código postal configurable (5000); su falla nunca es falla.
- **Megatone:** URL directa `/producto/…`; JSON-LD `Product`/`offers` en ARS; contado = lista `{ninguno}`; tarjetas sin datos.
- **Naldo** y **Cetrogar:** provisionales hasta validación con fixtures en la fase F1 (si no, se retiran por S-28).
- Pruebas de contrato con fixtures reales recortados y `expected.json` por caso.

## Consecuencias

- Un pedido por URL en On City (dos en Carrefour/Naldo), sin depender de un endpoint de checkout frágil.
- Si una tienda aplica un descuento de contado solo en el checkout real, cuotear no lo verá (ya era así con la simulación anónima, S-37).
- La lista exacta de nombres puede dejar sin tarjetas a una tienda que use nombres no previstos: se registran en el log y se ajusta la lista. En Carrefour falta confirmar si la Mastercard 3x es la genérica.

## Alternativas consideradas

- **Simulación de checkout como fuente principal (S-37 del DAF):** prohibida por robots.txt en On City y Cetrogar; un pedido POST extra por URL sin ganancia de información demostrada.
- **Regex amplia de marcas (como el spike):** confundiría "Tarjeta Carrefour Mastercard" con Mastercard (RN-14).
- **Vendedor `sellerDefault` siempre:** en Carrefour el vendedor por defecto puede ser el de precio 0.
- **Búsqueda por texto (`?ft=`):** devuelve productos parecidos de otros vendedores; la URL configurada identifica el producto.
