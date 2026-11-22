# ADR-0007: Respeto de robots.txt en tiempo de ejecución, incluidas las APIs JSON de las tiendas

- Estado: Aceptado
- Fecha: 2026-11-22
- Requisitos: RNF-07, RF-04, RF-15, RNF-15, S-28 · DAF Q-8 · DRT sección 5.1

## Contexto

RNF-07 pide respetar ToS/robots "en lo factible" y retirar las tiendas que lo prohíban. Verificación del 2026-11-22:
- Cetrogar: `Disallow: /api/` (y `/checkout/`, `/_next/`) para todos los agentes ⇒ la API VTEX de catálogo y de checkout está prohibida.
- On City: `Disallow: /*checkout*` ⇒ la simulación de checkout está prohibida; el catálogo no.
- Carrefour y Naldo: solo prohíben `/checkout/*` (prefijo), búsquedas y cuentas ⇒ catálogo y simulación permitidos.
- Megatone: `Disallow: /` con `Allow: /producto/` ⇒ fichas permitidas.

El spike usó la API de Cetrogar y la simulación de On City antes de esta revisión. robots.txt puede cambiar en cualquier momento.

## Decisión

- Interpretación estricta (ST-14): robots.txt se aplica a **todo** pedido a una tienda, incluidas sus APIs JSON, aunque el volumen sea ínfimo.
- La capa HTTP descarga robots.txt de cada host como máximo cada 24 h (caché en el estado), lo interpreta según RFC 9309 (grupo `cuotear` o `*`, comodines, regla más larga, empate ⇒ Allow; 4xx ⇒ todo permitido; 5xx/inalcanzable ⇒ copia ≤ 7 días o todo prohibido) y verifica cada ruta antes del pedido.
- Ruta prohibida ⇒ no se pide; falla de URL (cuenta para N) y aviso operativo `robots:<tienda>`. Si la ruta prohibida es la simulación opcional, solo se omite.
- Consecuencias inmediatas: **On City sin simulación**; **Cetrogar pasa a provisional** con un adaptador por HTML de ficha (`/<slug>/p`, permitido) a validar en F1; si no da al menos el precio, se retira (S-28).

## Consecuencias

- El comportamiento se adapta solo si una tienda cambia su robots.txt; el dueño decide el retiro a partir del aviso.
- Cetrogar probablemente pierda las cuotas por tarjeta (o salga de la lista vigente): el DAF debe actualizarse (RF-04, sección 10).
- Un pedido extra por host por día y un parser pequeño con tests.

## Alternativas consideradas

- **Ignorar robots.txt para APIs** (argumento: un monitor personal de baja frecuencia no es un rastreador): más cobertura, pero contradice la letra de RNF-07 y la postura "sin evasión". Queda como decisión que el dueño puede revisar explícitamente.
- **Revisión manual única de robots.txt:** no detecta cambios posteriores.
- **Retirar Cetrogar ya:** se prefiere validar primero la ficha HTML (puede aportar al menos el precio).
