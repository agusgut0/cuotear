# Revisión de Términos y Condiciones y robots.txt de las tiendas monitoreadas

- **Fecha:** 2026-11-23
- **Requisitos relacionados:** DAF RNF-07 y S-46; DRT sección 6.x y ADR 0007 (respeto de robots.txt en tiempo de ejecución).

## Propósito y alcance

Documentar qué dicen los términos y condiciones (TyC), políticas de uso y `robots.txt` de las cuatro tiendas del conjunto monitoreado (On City, Carrefour Argentina, Naldo, Megatone) sobre el **acceso automatizado** a páginas públicas de producto y a JSON público de catálogo.

Perfil de uso de cuotear: como máximo 4 pedidos por día por URL, User-Agent identificable, respeto de `robots.txt`, 1 pedido por segundo por dominio, sin login, sin evasión de bloqueos; solo se lee información pública de precios, para uso personal.

## Aviso importante

Esta revisión es una **lectura técnica de buena fe y NO constituye asesoramiento legal**. Fue hecha con herramientas automáticas de lectura de páginas (WebFetch/WebSearch), que resumen el contenido y pueden omitir texto. RNF-07 / S-46 exige que **el DUEÑO del proyecto confirme manualmente** los términos de cada tienda (ver checklist al final). El contenido de las tiendas se trató como dato no confiable.

## Resumen

| Tienda | TyC leídos | Cláusula sobre acceso automatizado | robots.txt para nuestras rutas | Hallazgo | Riesgo | Recomendación |
|---|---|---|---|---|---|---|
| On City | No (no se encontró) | No verificable | Permite fichas de producto; bloquea checkout, account, login, `page`/`q`/`_q`/`order` y rutas con `test`/`prueba` | Ambiguo (TyC no leídos) | Media | Mantener con vigilancia |
| Carrefour AR | No (no se encontró) | No verificable | Permite fichas; bloquea `/img`, account, login, checkout, búsqueda, `?_q`, quick-view, espiar, buscapagina, `/folletos-new/` | Ambiguo (TyC no leídos) | Media | Mantener con vigilancia |
| Naldo | No (página sin texto legible) | No verificable | Permite fichas; bloquea `/img/*`, account, login, checkout, `/busca/*`, quick-view, espiar | Ambiguo (TyC no leídos) | Media | Mantener con vigilancia |
| Megatone | Sí | Sin cláusula explícita sobre bots/scraping; prohíbe uso/reproducción de contenidos sin autorización | Permite `/producto/` y `/listado/` | Sin cláusula explícita | Baja a Media | Mantener con vigilancia |

## On City (www.oncity.com)

**URLs consultadas**
- https://www.oncity.com/robots.txt (leído; la herramienta entregó un resumen, no el texto literal)
- https://www.oncity.com/terminos-y-condiciones (HTTP 404)
- https://www.oncity.com/institucional/terminos-y-condiciones (HTTP 404)
- https://www.oncity.com/ (home; el contenido llegó truncado antes del pie, no se obtuvieron los enlaces legales)
- Búsqueda web "oncity.com términos y condiciones": sin resultados del dominio.

**Fragmentos relevantes:** ninguno; no se pudo acceder a ningún TyC.

**robots.txt:** para `User-agent: *` bloquea rutas que contienen `checkout`, `account` y `login`; los parámetros `page`, `q`, `_q` y `order`; `/oncity-trabaja-con-nosotros`, `/newsletter-suscripcion` y cualquier ruta con `test` o `prueba`. Bloquea totalmente (`Disallow: /`) a Amazonbot, ClaudeBot, SiteAuditBot, CazoodleBot, MJ12bot, dotbot y Gigabot. Las fichas de producto no están bloqueadas. Nuestro User-Agent identificable no coincide con ninguno de los bots bloqueados por nombre; igualmente conviene que no contenga "ClaudeBot".

**Hallazgo:** Ambiguo (no se encontró ni leyó el TyC). **Riesgo:** Media. **Recomendación:** mantener con vigilancia; el dueño debe ubicar y leer el TyC desde el pie del sitio. Seguir sin pedir checkout ni rutas con `test`/`prueba` (ya cubierto por ADR 0007).

## Carrefour Argentina (www.carrefour.com.ar)

**URLs consultadas**
- https://www.carrefour.com.ar/robots.txt (leído; resumen)
- https://www.carrefour.com.ar/terminos-y-condiciones (200, pero el contenido recibido fue solo el encabezado de la home; sin términos)
- https://www.carrefour.com.ar/institucional/terminos-y-condiciones (HTTP 404)
- https://www.carrefour.com.ar/ (contenido truncado antes del pie; aparece un encabezado "Legales" sin texto recuperable)
- Búsqueda web: devolvió TyC de carrefour.es y del Banco de Servicios Financieros (tarjeta), que **no** son los del sitio de comercio argentino y no se usaron.

**Fragmentos relevantes:** ninguno.

**robots.txt:** `User-agent: *` pide no acceder a imágenes, account, login, checkout, búsqueda, quick-view, "espiar", "buscapagina", URLs con `?_q` y `/folletos-new/`. Sitemap en https://www.carrefour.com.ar/sitemap.xml. Las fichas de producto no están bloqueadas.

**Hallazgo:** Ambiguo (TyC no leídos). **Riesgo:** Media. **Recomendación:** mantener con vigilancia; el dueño debe leer la sección "Legales" del sitio. No usar rutas de búsqueda ni `?_q`.

## Naldo (www.naldo.com.ar)

**URLs consultadas**
- https://www.naldo.com.ar/robots.txt (leído; resumen)
- https://www.naldo.com.ar/terminos-y-condiciones (la página existe, título "terminos-y-condiciones - Naldo", pero solo se recuperaron ~1000 caracteres de navegación; el texto de los términos no se obtuvo, probablemente se renderiza con JavaScript)
- https://www.naldo.com.ar/ (contenido truncado antes del pie)
- Búsqueda web: sin resultados del dominio.

**Fragmentos relevantes:** ninguno.

**robots.txt:** `User-agent: *` bloquea `/img/*`, `/account/*`, `/login/*`, `/checkout/*`, `/busca/*`, `/quick-view/*` y `/espiar/*`; permite archivos de descubrimiento de IA/MCP (`llms.txt`, `mcp.json`, etc.) y permite explícitamente GPTBot, ClaudeBot, PerplexityBot y Google-Extended. Hay un segundo grupo `User-agent: *` solo con Allow (algunos parsers no lo fusionan). La línea de sitemap apunta a un dominio de plantilla (`www.MiTienda.com.br`), un error de configuración de la tienda sin efecto para nosotros. Las fichas de producto no están bloqueadas.

**Hallazgo:** Ambiguo (TyC no leídos); el robots.txt es notablemente permisivo con bots de IA. **Riesgo:** Media (por falta de lectura, no por señales negativas). **Recomendación:** mantener con vigilancia; el dueño debe leer el TyC en un navegador. Naldo es provisional según el DAF (S-36, S-43).

## Megatone (www.megatone.net)

**URLs consultadas**
- https://www.megatone.net/robots.txt (leído; resumen)
- https://www.megatone.net/terminoscondiciones/ (título "Terminos y condiciones | Megatone"; leído mediante resumen automático)

**Fragmentos relevantes** (citados a partir del resumen de la herramienta; verificar el texto literal en el sitio)
- Sección 3.3 "Contenidos del Sitio": los contenidos "están protegidos por la legislación sobre propiedad intelectual y son de propiedad exclusiva de Megatone.net o de sus proveedores u otros terceros"; "Queda prohibida su utilización y/o reproducción sin expresa autorización de Megatone.net."
- "Actos prohibidos", inciso c: prohíbe usar el Sitio para actividades que "infrinjan la regulación sobre propiedad intelectual".
- No se encontró ninguna cláusula sobre bots, scraping, automatización, extracción de datos o uso comercial, ni mención a los precios.

**robots.txt:** `User-agent: *` permite explícitamente `/producto/`, `/listado/`, `/tienda/`, `/tiendas/`, `/marca/`, `/guias/`, `/sucursales/`, `/privacidad/`, `/terminoscondiciones/`, imágenes de artículos y los sitemaps; bloquea `/micuenta/mis-compras/` y, tras las reglas Allow, un `disallow: /` general (solo lo no listado queda bloqueado). Hay grupos equivalentes para agentes de Meta. Importante: cualquier ruta usada por el adaptador que no esté en la lista permitida (por ejemplo un endpoint JSON) quedaría bloqueada y debe verificarse.

**Hallazgo:** Sin cláusula explícita sobre acceso automatizado; existe una prohibición genérica de reproducir contenidos sin autorización. **Riesgo:** Baja a Media (la lectura de precios para uso personal sin republicar contenido parece compatible, pero la cláusula 3.3 es amplia). **Recomendación:** mantener con vigilancia; no republicar descripciones ni imágenes, solo precios propios derivados.

## Checklist del dueño (confirmación manual, RNF-07 / S-46)

Fecha de confirmación: ____ / ____ / ________    Confirmado por: ______________________

- [ ] On City: leí el TyC y la política de uso en el navegador; no prohíben el acceso automatizado de bajo volumen a fichas públicas.
- [ ] Carrefour Argentina: leí la sección "Legales" / TyC; no prohíben el acceso automatizado de bajo volumen.
- [ ] Naldo: leí el TyC (renderizado en navegador); no prohíbe el acceso automatizado de bajo volumen.
- [ ] Megatone: leí la sección 3.3 y "Actos prohibidos"; acepto el uso (solo lectura de precios, personal, sin republicar contenidos).
- [ ] Verifiqué que las rutas que usa cada adaptador no están bloqueadas por el `robots.txt` actual de la tienda (en especial Megatone, por su `disallow: /` general).
- [ ] Verifiqué que el User-Agent de cuotear es identificable y no coincide con los bots bloqueados por nombre.
- [ ] Decisión final por tienda (mantener / mantener con vigilancia / retirar) registrada en el DAF y en el log: ______________________

## Limitaciones

- No se pudo acceder al TyC de **On City** (las URLs probadas dieron 404 y la home llegó truncada sin pie de página), ni al de **Carrefour Argentina** (la URL probada devolvió la home), ni se obtuvo el texto de **Naldo** (página con contenido dinámico). Solo se leyó un TyC completo (Megatone), y vía resumen automático.
- Las URLs de TyC probadas fueron adivinadas a partir de convenciones comunes; las reales están en el pie de cada sitio y no se pudieron extraer. La búsqueda web no devolvió páginas de estos dominios.
- La herramienta de lectura entrega resúmenes y no texto literal; los robots.txt se resumieron y no se transcribieron íntegros. Las citas de Megatone deben verificarse contra el original.
- No se consultaron APIs, checkouts ni rutas bloqueadas, y no se intentó evadir ningún bloqueo.
- No se evaluó legislación (propiedad intelectual, bases de datos, defensa del consumidor, competencia desleal) ni jurisprudencia; esto requiere asesoramiento legal.
- Los términos pueden cambiar; esta lectura es válida a la fecha indicada.
