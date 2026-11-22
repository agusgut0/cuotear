# DAF — Documento de Análisis Funcional: cuotear

Versión: 0.4 (borrador, hallazgos del spike de acceso a tiendas) · Fecha: 2026-11-22 · Estado: para revisión
**Cambio v0.3 → v0.4 (ronda 10):** el spike de acceso a tiendas (2026-11-22, IP local de Argentina vs runner `ubuntu-24.04` de GitHub) materializó R-01: Frávega y MejoresCompras bloquean los runners (403). Mercado Libre vía MejoresCompras deja de ser parte del conjunto medido de v1 (RF-04, S-35); el conjunto medible de v1 queda en On City, Cetrogar, Carrefour, Naldo (provisional) y Megatone (solo URL directa) (S-36); el contado expuesto de forma anónima es igual al precio publicado (descuento 0 %, S-37); nuevos S-35 a S-40; RF-04, RF-07, RF-15, RF-17, RF-20, RF-21, RNF-10, secciones 2, 3, 10, 11, 12, 13 y 15 ajustadas. Ver `docs/spikes/store-access.md` (rama `spike/store-access`).
Origen: `docs/specs/requirements-log.md` (rondas 1 a 5: respuestas del usuario, con detalles como N = 4 marcados como supuesto; ronda 6: delegación total al analista, DEC-01, todo lo decidido allí es supuesto; **ronda 7 = revisión de alcance dictada por el usuario**, que prevalece sobre rondas anteriores; ronda 8: correcciones de coherencia interna y verificación de MejoresCompras por el dueño; ronda 9: sin presupuesto mensual de minutos; ronda 10: hallazgos del spike) y `CLAUDE.md`.

Cambio principal respecto de v0.1: cuotear pasa de app multiusuario con cuentas y backend externo a **herramienta personal de un único usuario (el dueño del repo)**, con configuración en un archivo del repo, historial en archivos del repo y un sitio estático de solo lectura en GitHub Pages. Se agrega el modelo de precios contado vs cuotas con veredicto por valor presente y alertas por Telegram/email configurables. La v0.3 corrige incoherencias internas de la v0.2 (estado de ejecución, series elegibles, Mercado Libre, presupuesto de tiempo, avisos operativos).

Convenciones:
- Prioridad MoSCoW: M = Must, S = Should, C = Could, W = Won't (v1).
- **Supuesto**: decisión tomada por el analista sin confirmación del usuario (se lista con id S-xx en la sección 15.1).
- Criterios de aceptación en formato Dado / Cuando / Entonces.
- Los requisitos reemplazados no se borran: figuran como *superseded* en la sección 13 y en el log.

## 1. Propósito y contexto

cuotear es un monitor de precios serverless y de costo cero para hasta **10 productos** en tiendas online argentinas. Para cada producto distingue:
1. el **precio de contado** (mejor precio de pago único, con su condición), y
2. el **precio en cuotas sin interés por tarjeta** (Visa, Mastercard, Naranja X),

y compara ambos descontando las cuotas a valor presente con una inflación mensual esperada, para indicar si conviene contado o cuotas. Avisa por Telegram o email, con reglas configurables. Caso inicial: Smart TV TCL 75T6C.

Usuario único: el dueño del repo. No hay cuentas, login, base de datos ni datos personales.

## 2. Alcance v1

### 2.1 Dentro de alcance

- Productos (máx. 10) y URLs por tienda definidos en un archivo de configuración del repo, validado con un esquema (RF-19).
- Relevamiento cada 6 horas en las tiendas de la lista vigente de RF-04 (On City, Cetrogar, Carrefour, Naldo provisional, Megatone por URL directa; S-36). Mercado Libre no se mide en v1 (S-35).
- Precio de contado con su condición, incluidos descuentos por medio de pago único (transferencia, débito, efectivo, promo de un pago) cuando la tienda los expone; las fuentes anónimas verificadas exponen contado = precio publicado (RF-20, S-37).
- Cuotas sin interés por tarjeta: Visa, Mastercard, Naranja X (RF-14).
- Comparación contado vs cuotas: diferencia en $ y %, valor presente, veredicto (RF-21).
- Alertas por Telegram o email desde GitHub Actions con reglas configurables (RF-22, RF-23) y avisos operativos (RNF-15).
- Historial en archivos del repo con política de retención y tamaño (RF-24).
- Sitio estático de solo lectura en GitHub Pages, es-AR (por defecto) y en, accesible (RF-17, RNF-03, RNF-08).
- Extensibilidad de tiendas por parte del desarrollador (RF-05).
- Degradación por tienda (RNF-12).

### 2.2 Fuera de alcance (v1)

| Ítem | Origen |
|---|---|
| Promociones específicas de un banco emisor con reintegro (cashback), cupones, millas | Ronda 7 (instrucción 2) |
| Descuentos que exigen una tarjeta o banco específico (aunque sean de pago único) | **Supuesto** S-06 |
| Alta/edición de productos o tiendas desde la web (la UI es de solo lectura) | Ronda 7 |
| Tarjetas distintas de Visa, Mastercard y Naranja X; cuotas con interés | RF-03 |
| Compra automática; app móvil nativa; monedas distintas de ARS | **Supuesto** S-19 |
| Extensión de navegador (Chrome) | **Supuesto** S-19 (MejoresCompras la ofrece; ver sección 12) |
| Detección de descuentos inflados (mediana y mínimo histórico) | **Supuesto** S-19 (MejoresCompras la ofrece; ver sección 12) |
| Frávega, Rodo, Musimundo, Mercado Libre (vía MejoresCompras): fuera del conjunto medido de v1 (candidatas, sección 3) | Spike, ronda 10 (S-35, S-36) |
| Búsqueda por nombre en tiendas (las URLs por tienda se pegan a mano) | Ronda 7; confirmado por el spike (Megatone sin búsqueda) |
| Evasión de bloqueos anti-bot, resolución de captchas | RNF-07 |
| Todo lo listado en la sección 3 (v2) | Ronda 7 |

## 3. v2 / fuera de alcance (con justificación)

| Ítem | Requisitos que reemplaza | Justificación |
|---|---|---|
| Multiusuario (varios usuarios con productos propios, aislamiento de datos) | RF-08, RN-02, RN-03 (RN-04 se absorbe en RF-02, no pasa a v2) | El usuario real es solo el dueño; multiusuario obliga a cuentas, aislamiento y topes globales que no aportan valor en v1. |
| Autenticación OAuth (Google/GitHub), cuentas, email verificado | RF-11 | Sin usuarios ajenos no hay nada que autenticar; el sitio es de solo lectura. |
| Alta de productos desde la web (formulario) y backend externo para escrituras | RF-06, RF-12, RNF-02 | Los productos viven en un archivo del repo; elimina el backend externo, su costo potencial y su superficie de ataque. |
| Búsqueda automática y coincidencia entre tiendas con confirmación del usuario | RF-13, RN-07 | Complejo y propenso a errores; en v1 el dueño pega a mano la URL de cada tienda en la configuración. |
| Borrado de cuenta, baja de alertas por enlace, protección anti-abuso por usuario | RNF-04 (parte), RNF-09, RNF-05 | No hay cuentas ni terceros que abusen; las alertas se configuran en el archivo. |
| Cumplimiento Ley 25.326 (inscripción de base de datos, política de privacidad, consentimiento) | RNF-04 (parte) | No se recolectan datos personales en v1 (RNF-14). **Si v2 incorpora usuarios, deberá evaluarse.** |
| Alertas multiusuario por proveedor de email con dominio propio | RF-09, RF-10, RF-16, RF-18 | Reemplazadas por RF-22/RF-23 (un único destinatario, secretos en GitHub). *Anotación del analista:* SPF/DKIM sería necesario solo en ese escenario v2. |
| Promociones bancarias con reintegro | — | Dependen del banco, vigencia y topes; difíciles de extraer de forma fiable. Candidato a v2. |
| Frávega (candidata) | RF-04 (lista original) | Spike 2026-11-22: HTTP 403 de CloudFront desde el runner (funciona desde IP local). No se evade el bloqueo (RNF-07). Reevaluar si cambia el acceso. |
| Mercado Libre vía MejoresCompras (candidata) | RF-04, Q-01 | Spike: 403 de Cloudflare ("Just a moment...") desde el runner (funciona desde IP local). Alternativas, sin decidir (DRT, sección 15.2): API oficial de Mercado Libre (**no verificada**), carga manual de precios, runner propio/de otra IP (rompe el costo cero serverless, RNF-01). |
| Rodo (candidata) | RF-04 (lista original) | Spike: responde 200 pero sin precios en el HTML inicial (renderizado por JS) y sin endpoint utilizable hallado. |
| Musimundo (candidata) | RF-04 (lista original) | Spike: no es VTEX; redirige a un home estático que enlaza a On City; sin endpoint de catálogo. |

## 4. Actores

| Actor | Descripción |
|---|---|
| Dueño (usuario único) | Edita la configuración en el repo, recibe alertas y consulta el sitio. También es desarrollador/administrador. |
| Desarrollador | Mismo dueño en su rol de agregar adaptadores de tienda (RF-05). |
| Visitante | Quien abra el sitio público de GitHub Pages; solo lectura, sin datos personales (**Supuesto** S-14: el sitio es público). |
| Sistema de relevamiento | Workflow programado en GitHub Actions (cada 6 h). |
| Tiendas | Fuentes externas no confiables (RN-01); pueden bloquear a los runners (R-01). |
| Servicio de mensajería | Telegram Bot API y/o servicio de email para enviar alertas. |
| Fuente de inflación | BCRA REM u otra, o valor manual (RF-21). |

## 5. Casos de uso

| ID | Caso de uso | Actor | Requisitos |
|---|---|---|---|
| CU-01 | Definir/editar productos y URLs por tienda en el archivo de configuración | Dueño | RF-19, RF-02, RF-04 |
| CU-02 | Configurar reglas de alerta y canal | Dueño | RF-22, RF-23 |
| CU-03 | Configurar la fuente de inflación y parámetros de comparación | Dueño | RF-21 |
| CU-04 | Validar la configuración (en cada cambio) | Sistema | RF-19, RF-02 |
| CU-05 | Relevar precios y registrar historial | Sistema | RF-03, RF-07, RF-14, RF-15, RF-20, RF-24, RN-06, RN-08, RNF-12 |
| CU-06 | Calcular comparación contado vs cuotas y veredicto | Sistema | RF-21, RN-11 |
| CU-07 | Evaluar reglas y enviar alertas | Sistema | RF-01, RF-22, RF-23, RN-12, RN-13, RNF-15 |
| CU-08 | Ver lista de productos, mejor opción y veredicto | Dueño/Visitante | RF-03, RF-17, RF-20, RF-21 |
| CU-09 | Ver detalle e histórico de un producto | Dueño/Visitante | RF-03, RF-17, RF-24, RNF-06 |
| CU-10 | Cambiar idioma de la UI | Dueño/Visitante | RNF-03 |
| CU-11 | Agregar una tienda nueva (adaptador) | Desarrollador | RF-05 |

## 6. Requisitos funcionales

### RF-01 — Notificación de bajas y cambios relevantes (M) — *modificado*
Se notifica al dueño cuando se cumple alguna regla de RF-22 (`baja_minima_pct`, `baja_minima_monto`, `precio_objetivo`, `cambio_mejor_opcion`). Reemplaza la regla "cualquier baja" de RF-10 original, que pasa a ser el valor por defecto (RF-22).
- Dado un producto con medición previa válida y una regla satisfecha, cuando termina el relevamiento, entonces se envía una notificación por el canal de RF-23.
- Dado que ninguna regla se satisface, entonces no se envía nada.

### RF-02 — Límite de productos monitoreados (M) — *modificado (vuelve a 10)*
La configuración admite hasta **10** productos. El límite cuenta productos, no URLs: un producto puede tener varias URLs de tienda (hasta una por tienda de RF-04; S-12).
- Dado una configuración con 11 productos, cuando se valida, entonces la validación falla indicando el límite y el relevamiento sigue usando la última configuración válida (RF-19), con aviso operativo (RNF-15).
- Dado una configuración con exactamente 10 productos, entonces la validación pasa.
- Dado un producto con 5 URLs (una por cada tienda de la lista vigente), entonces cuenta como 1 producto.

### RF-03 — Distinción contado / cuotas por tarjeta (M) — *modificado*
Por producto y tienda se registran por separado: precio de lista, precio de contado (RF-20) y, para Visa, Mastercard y Naranja X, cuotas sin interés (RF-14).
- Dado un producto con medición válida, cuando se consulta, entonces se muestran contado (con condición) y las tres tarjetas por separado, y el precio de lista no se presenta como contado.
- Dado una tienda que expone solo un precio (Megatone, por JSON-LD: sin tarjetas ni contado), entonces se registra el precio como lista, el contado es lista con condición {ninguno} (S-05) y las tres tarjetas figuran "sin datos"; esa tienda solo es elegible para el contado.

### RF-04 — Tiendas de v1 (M) — *modificado*
Lista original de v1 (9 tiendas): Mercado Libre (vía MejoresCompras), Frávega, On City, Musimundo, Cetrogar, Carrefour, Megatone, Rodo, Naldo. Tras el spike (S-35, S-36) la **lista vigente (conjunto medido de v1)** es:

| Tienda | Estado | Fuente y alcance verificado (spike 2026-11-22) |
|---|---|---|
| On City | Vigente | API JSON de VTEX desde IP local y runner; lista y cuotas sin interés: Visa 15x, Mastercard 18x, Naranja X 12x. |
| Cetrogar | Vigente | API VTEX; Visa 15x, Mastercard 15x, Naranja X 12x. |
| Carrefour | Vigente | API VTEX; solo Mastercard 3x (Visa y Naranja X "sin datos"); devuelve dos vendedores (uno con precio 0 / sin stock; S-38). |
| Naldo | Vigente, **provisional** | API VTEX funciona, pero el 75T6C no está en su catálogo; requiere validar con otro producto (S-40, DRT). Si no se valida, se retira (S-28). |
| Megatone | Vigente, **solo URL directa** | Las URLs de búsqueda devuelven 404; la URL directa del producto devuelve 200 con precio en JSON-LD (sin tarjetas ni contado); funciona desde el runner (S-39). |

Fuera del conjunto medido (candidatas, sección 3): Frávega (403 CloudFront desde el runner), Mercado Libre vía MejoresCompras (403 Cloudflare desde el runner), Rodo (sin precios en HTML inicial), Musimundo (sin catálogo propio). **La lista puede seguir reduciéndose** tras nuevas pruebas o por RNF-07 (S-28): una tienda inviable se retira con una decisión documentada (DAF y log). El criterio se evalúa contra la **lista vigente**, no contra el número 9 ni contra el 5.

Las URLs por tienda se dan en la configuración (RF-19); no hay búsqueda por nombre (no está disponible en todas las tiendas, p. ej. Megatone).

Criterios:
- Dado cada tienda de la lista vigente, cuando la configuración incluye una URL de ella, entonces existe un adaptador que extrae precios (con el alcance de la tabla: p. ej. Megatone solo lista; Carrefour solo Mastercard).
- Dado que una tienda se retira de la lista (inviable, bloqueada o por RNF-07, S-28), entonces su dominio deja de ser válido en la configuración, el criterio de "adaptador por tienda" aplica solo a las restantes y el DAF y el log registran el cambio; no se considera incumplimiento de RF-04 (así ocurrió con Frávega, Mercado Libre, Rodo y Musimundo; S-36).
- Dado una URL cuyo dominio no pertenece a la lista vigente (p. ej. Frávega o Mercado Libre), entonces la validación de configuración falla y no se descarga nada.
- Dado una tienda de la lista vigente que pasa a ser bloqueada desde el runner (403, captcha), cuando corre el relevamiento, entonces se trata como falla de tienda (RF-15, RNF-07), no se intenta evadir, la ejecución no falla y, tras N fallas, la tienda muestra "sin datos".
- Dado Megatone, cuando la configuración trae una URL directa de producto, entonces se extrae el precio; no se ofrece búsqueda ni se aceptan URLs de búsqueda (la validación las rechaza o la medición falla con 404 como falla de tienda).
- Dado Carrefour con dos vendedores, uno con precio 0 / sin stock, entonces se ignora el vendedor sin stock y se mide el otro (S-38); no se marca falla.
- Dado un adaptador nuevo (RF-05), entonces se agrega sin modificar el núcleo (p. ej. para reincorporar una tienda candidata).

### RF-05 — Fuentes extensibles (M)
El desarrollador puede agregar tiendas sin modificar el núcleo.
- Dado un adaptador nuevo que cumple el contrato del DRT, cuando se registra, entonces su dominio es válido en la configuración sin cambios en otros módulos.
- Dado que la UI es de solo lectura, entonces no existe función web para agregar tiendas.

### RF-07 — Frecuencia de relevamiento (M)
Relevamiento cada 6 horas (4 ejecuciones por día) de todas las URLs de la configuración válida vigente. Sin excepciones de cadencia en v1 (la excepción diaria de Mercado Libre queda sin efecto al salir ML del conjunto medido, S-35).
- Dado el planificador y una configuración válida con U URLs, cuando transcurren 6 h, entonces se ejecuta un relevamiento que intenta medir cada una de las U URLs y registra por URL un resultado: válido, fallido o sin stock.
- **Supuesto** S-02: se tolera una demora de hasta 60 min del cron de GitHub Actions.
- No existe un indicador de "activa/inactiva" por URL: todas las URLs presentes en la configuración válida se miden; para dejar de medir una URL se quita de la configuración (S-33).

### RF-14 — Datos por tarjeta (M) — *modificado*
Por tienda y tarjeta (Visa, Mastercard, Naranja X): cantidad de cuotas sin interés `n`, valor de la cuota `C` y total `T`. Si la tienda ofrece varias opciones de cuotas para una tarjeta, se registra la de mayor cantidad de cuotas sin interés (S-04). Las cuotas por tarjeta disponibles varían por tienda (p. ej. Carrefour solo Mastercard 3x; Megatone ninguna): lo no publicado es "sin datos" sin falla.
- Dado una tienda con 12 cuotas sin interés de $100.000 con Visa, entonces se registran n = 12, C = 100.000 y T = 1.200.000.
- Dado una tienda sin oferta para Naranja X, entonces se muestra "sin datos" para esa tarjeta.
- Dado un total publicado que difiere de n × C en más de n pesos (redondeo, S-04), entonces la medición de esa tarjeta se marca inválida (falla de esa serie, RF-15).
- Dado una oferta con interés, entonces se muestra "sin datos" (RN-09).
- Dado On City con Visa 15x, Mastercard 18x y Naranja X 12x sin interés, entonces se registran las tres series, cada una con su n (S-04).
- Dado Carrefour con solo Mastercard 3x, entonces Visa y Naranja X muestran "sin datos" sin falla y sin contar para N.
- Dado Megatone (solo precio, sin tarjetas), entonces las tres tarjetas muestran "sin datos" sin falla.

### RF-15 — Falla de tienda (M)
Ante caída, bloqueo (incluido bloqueo de IPs de runners, ver R-01, ya materializado: S-35) o cambio de HTML: se conserva el último precio válido, la medición se marca "fallida", se reintenta en la próxima ejecución y no se envía alerta; tras **N = 4** fallas consecutivas (S-01) se muestra "sin datos". El contador es **por tienda y serie** (S-32): una falla de la URL (caída, 403, HTML) suma 1 a todas las series de esa URL; una medición inválida de una sola tarjeta (RF-14) suma solo a esa serie. **"Sin stock" (RN-06), el vendedor con precio 0 y "sin oferta" de una tarjeta no cuentan como falla.** Una tienda bloqueada (403, captcha) sí cuenta como falla de URL y nunca hace fallar la ejecución. Una serie fallida o "sin datos" no es elegible para mejor opción ni veredicto (S-26).
- Dado una falla, entonces el último precio válido sigue visible con marca de falla y no hay alerta.
- Dado 4 fallas consecutivas de una serie, entonces la UI muestra "sin datos" para esa serie.
- Dado 3 fallas de la URL de una tienda y 1 falla aislada de la tarjeta Visa, entonces el contador de Visa es 4 ("sin datos") y el de las demás series es 3.
- Dado un producto "sin stock" durante 10 ejecuciones, entonces el contador de fallas es 0 y no aparece "sin datos".
- Dado un éxito posterior, entonces se reinicia el contador y se compara contra el último precio válido.

### RF-17 — Sitio estático de solo lectura (M) — *modificado*
Sitio en GitHub Pages, de solo lectura, generado a partir de la configuración, el historial y el estado de ejecución (sección 9). Pantallas (**Supuesto** S-20): lista de productos (contado con condición y cuotas por tarjeta por tienda, mejor opción y veredicto resaltados) y detalle con gráfico histórico. No hay login, formularios de alta ni escritura.

Definiciones (S-30):
- **Gráfico:** línea escalonada por serie (el valor se mantiene constante hasta el siguiente punto, porque el historial solo registra cambios) que se extiende hasta la fecha de la última medición válida de la serie; nunca más allá. Incluye alternativa en tabla (RNF-08).
- **Desactualizado:** valor cuya última medición válida tiene más de **12 h** (2 ciclos) de antigüedad. Se muestra con marca de desactualizado/falla; a las N = 4 fallas pasa a "sin datos".

Criterios:
- Dado un producto con datos en varias tiendas, cuando se abre la lista, entonces se resalta el menor precio de contado, el menor valor presente de cuotas y el veredicto, considerando solo series elegibles (S-26).
- Dado que la configuración no tiene productos, entonces se muestra un estado vacío con instrucciones para editar el archivo de configuración.
- Dado un historial con menos de 2 puntos, entonces el detalle muestra un mensaje en lugar del gráfico.
- Dado una serie con puntos el 1/3 y el 10/3 y última medición válida el 20/3, entonces la línea escalonada llega hasta el 20/3 y no más.
- Dado una última medición válida de hace 13 h, entonces se marca desactualizada; dado una de hace 11 h, entonces no.
- Dado un valor sin datos o desactualizado, entonces se muestra "sin datos" o la marca de falla, nunca un número inventado.
- Dado el sitio completo, entonces no contiene campos de entrada que escriban datos ni requiere inicio de sesión.

### RF-19 — Configuración en archivo del repo validada por esquema (M) — *nuevo*
Los productos y sus URLs por tienda, las reglas de alerta, el canal y los parámetros de comparación se definen en un archivo de configuración del repo, validado con un esquema (formato y esquema concretos: DRT). Contenido mínimo por producto (**Supuesto** S-21): identificador estable, nombre, URLs por tienda, reglas de alerta propias opcionales (`baja_minima_pct`, `baja_minima_monto`, `precio_objetivo` + `aplica_a`, `cambio_mejor_opcion`). Parámetros globales: reglas por defecto, canal, fuente de inflación, `r` manual, `s` (0 o 1).
Si la validación falla, **el relevamiento continúa con la última configuración válida** (S-12, guardada en el estado de ejecución, sección 9) y se emite un aviso operativo (RNF-15). Si no existe ninguna configuración válida previa, no se mide ni se publica y se emite aviso operativo.
- Dado una configuración válida, cuando se hace un cambio en el repo, entonces la validación pasa y el relevamiento la usa.
- Dado una configuración con más de 10 productos, URL malformada, dominio no permitido, campo desconocido u obligatorio faltante, entonces la validación falla con un mensaje que indica archivo y campo, y el relevamiento usa la última válida.
- Dado exactamente 10 productos, entonces pasa; dado 11, entonces falla.
- Dado la misma URL repetida (en un producto o entre productos), entonces la validación falla (S-12).
- Dado un producto con más de una URL de la misma tienda, entonces la validación falla (S-12).
- Dado `r` manual negativo, entonces la validación falla (S-09); dado `r = 0`, entonces pasa.
- Dado `s` = 0 o 1, entonces pasa; dado `s` = 2 (o cualquier valor fuera de {0, 1}), entonces falla.
- Dado que no se aceptan secretos en la configuración, entonces la validación rechaza campos de token o contraseña (RNF-11).
- Dado una configuración inválida y una última válida disponible, entonces el relevamiento usa la última válida y el sitio indica que la configuración vigente no es la del repo (aviso operativo abierto).

### RF-20 — Precio de contado con condición (M) — *nuevo*
El precio de contado es el **mejor precio de pago único** publicado por la tienda: transferencia, débito, efectivo o promoción de un solo pago. Se registra con su **condición** y se guarda además el precio de lista por separado. El precio de lista NO es el precio de contado conceptualmente (reemplaza RN-05), aunque pueden coincidir en valor.
**Hallazgo del spike (S-37):** en On City, Cetrogar y Carrefour, la simulación de checkout de VTEX (anónima, código postal 5000) muestra que **todos** los medios de pago (incluidos "Transferencia Bancaria - Con descuento adicional", "Efectivo" y débito) suman exactamente el precio publicado: las fuentes anónimas no exponen un descuento adicional por pago contado. Frávega y Megatone solo muestran un "descuento" genérico sin texto de contado. Por lo tanto, en v1 el contado coincide normalmente con el precio publicado y la condición es el medio de pago con `descuento_pct` = 0. El modelo de datos conserva la capacidad de registrar un descuento > 0 si una tienda lo expone (mismo cálculo, sin cambios en RF-21).
La **condición es dato estructurado** (S-34): `medio` (transferencia | débito | efectivo | promo_un_pago | ninguno) y `descuento_pct` (número, 0 o vacío). El texto visible se genera a partir de esos campos en el idioma activo (RNF-03); no se guarda texto libre traducido.
- Dado una tienda VTEX (On City) cuya simulación de checkout devuelve el mismo total para transferencia, efectivo y débito que el precio publicado de 1.000.000, entonces contado = 1.000.000, lista = 1.000.000 y condición = {transferencia, 0 %} (el medio de pago único identificado con descuento 0 %); la UI muestra "Pago único por transferencia, sin descuento adicional" (es-AR) / "Single payment by bank transfer, no extra discount" (en).
- Dado una tienda hipotética que expone lista 1.000.000 y 10% off por transferencia, entonces contado = 900.000, condición = {transferencia, 10 %}, lista = 1.000.000; la UI en es-AR muestra "10 % off por transferencia" y en en "10% off with bank transfer" (el modelo admite el descuento aunque ninguna fuente verificada lo expone hoy).
- Dado una tienda con lista 1.000.000, 5% off con débito y 10% off con transferencia, entonces contado = 900.000 (el menor) y la condición es {transferencia, 10 %}.
- Dado una tienda sin descuento ni medio de pago único identificable (Megatone, solo precio en JSON-LD), entonces contado = lista con condición {ninguno, vacío} (S-05).
- Dado un descuento que exige un banco o tarjeta específicos, o un reintegro (cashback), entonces no se aplica (fuera de alcance, RN-14).
- Dado un cambio de condición con igual precio, entonces se registra el cambio de condición sin alerta de baja.
- Dado una simulación de checkout con montos distintos entre medios de pago único (más allá del redondeo), entonces se toma el menor como contado con su medio y su descuento (descuento > 0), salvo que el medio exija banco o tarjeta específicos (RN-14).
- Dado que la simulación no está disponible pero el precio publicado sí, entonces contado = precio publicado con condición {ninguno, vacío} sin marcar falla (S-37); dado un descuento detectado pero no interpretable, entonces la medición de contado se marca fallida (S-05).

### RF-21 — Comparación contado vs cuotas y veredicto (M) — *nuevo*
Para cada producto se calcula la comparación entre contado y cuotas sin interés por tarjeta, usando solo series elegibles (S-26). `Pc` es el mejor precio de pago único (RF-20), que en las fuentes anónimas verificadas coincide con el precio publicado (S-37); la comparación es, en la práctica, **precio de un pago vs total de cuotas sin interés a valor presente**, y las fórmulas y ejemplos numéricos siguen siendo válidos sin cambios (el ejemplo usa Pc = 1.000.000 como un pago único, sea o no con descuento).

**Definiciones**
- `Pc`: precio de contado (RF-20).
- Para una tarjeta: `n` cuotas, `C` valor de cuota, `T` total publicado (T ≈ n × C).
- `r`: tasa mensual de descuento = inflación mensual esperada (fracción, p. ej. 0,03). `r ≥ 0`. Si la fuente es anual `A`: `r = (1 + A)^(1/12) − 1`.
- `s`: mes de pago de la primera cuota. S-07: `s = 1` por defecto (parametrizable con 0 o 1; otro valor es inválido, RF-19).
- `h`: horizonte en meses para promediar expectativas del REM. S-07: `h = n` de la opción evaluada (no confundir con `n`, cantidad de cuotas, ni con la tasa `r`).

**Fórmulas**
1. Diferencia nominal: `Dif$ = T − Pc`; `Dif% = (T − Pc) / Pc × 100`.
2. La cuota k (k = 1..n) se paga en el mes `t_k = s + (k − 1)` y se descuenta: `VP = Σ_{k=1..n} C / (1 + r)^{t_k}`. Con `s = 1` equivale a `VP = C × (1 − (1 + r)^−n) / r`. Si `r = 0`, `VP = n × C` (cualquier `s`).
3. Diferencia a valor presente: `DifVP$ = VP − Pc`; `DifVP% = (VP − Pc) / Pc × 100`.
4. Veredicto por opción: si `VP < Pc` → **conviene cuotas**; en otro caso (incluye igualdad) → **conviene contado**. Si `|DifVP%| < 1 %` se agrega la etiqueta "diferencia marginal"; con `|DifVP%| ≥ 1 %` no se agrega (S-08).
5. Veredicto por producto: se compara el menor `Pc` entre tiendas contra el menor `VP` entre todas las combinaciones tienda × tarjeta elegibles; se muestra el ganador, la tienda, la tarjeta y la opción. Se comparan opciones de distintas tiendas (mejor compra global) y se muestra también el detalle por tienda.
6. Redondeo: cálculos con precisión completa; solo se redondea al peso entero al mostrar.

**Fuente de inflación (configurable)**
- `manual`: valor mensual (o anual) fijado en la configuración.
- `REM` (BCRA, Relevamiento de Expectativas de Mercado): S-07: tasa constante igual al promedio de las expectativas mensuales de los próximos `h` meses. Disponibilidad y formato: DRT.
- Si la fuente automática falla: se usa el último valor obtenido (marcado como desactualizado) y, si no existe, el valor manual de respaldo; si no hay ninguno, no se emite veredicto ("sin veredicto") pero sí la comparación nominal (S-09).

**Ejemplo numérico resuelto** (Pc = 1.000.000; Visa 12 cuotas de 100.000, T = 1.200.000; valores exactos recalculados):

| Escenario | r mensual | s | VP de las cuotas | DifVP$ | DifVP% | Veredicto |
|---|---|---|---|---|---|---|
| A | 3 % | 1 | 995.400,40 (factor 9,954004) | −4.599,60 | −0,460 % | Conviene cuotas (diferencia marginal) |
| B | 1 % | 1 | 1.125.507,75 (factor 11,255077) | +125.507,75 | +12,551 % | Conviene contado |
| C | 3 % | 0 | 1.025.262,41 (= 995.400,40 × 1,03) | +25.262,41 | +2,526 % | Conviene contado |

Al mostrar (redondeo al peso): A = 995.400 / −4.600 / −0,46 %; B = **1.125.508** / **+125.508** / +12,55 %; C = 1.025.262 / +25.262 / +2,53 %. En todos los escenarios Dif$ = +200.000 y Dif% = +20 %.

Criterios de aceptación:
- Dado Pc = 1.000.000, n = 12, C = 100.000, r = 3 %, s = 1, cuando se calcula, entonces Dif$ = 200.000, Dif% = 20 %, VP = 995.400 (±1 peso), DifVP$ = −4.600 (±1), DifVP% = −0,46 %, veredicto "conviene cuotas" con etiqueta "diferencia marginal".
- Dado los mismos datos con r = 1 %, entonces VP = 1.125.508 (±1 peso), DifVP$ = +125.508 (±1), DifVP% = +12,55 % y el veredicto es "conviene contado" sin etiqueta marginal.
- Dado los mismos datos con r = 3 % y s = 0, entonces VP = 1.025.262 (±1 peso), DifVP% = +2,53 % y el veredicto es "conviene contado".
- Dado r = 0 y s = 1, entonces VP = 1.200.000 y "conviene contado"; dado r = 0 y s = 0, entonces VP = 1.200.000 (igual).
- Dado empate VP = Pc (Pc = 1.200.000, r = 0, n = 12, C = 100.000), entonces el veredicto es "conviene contado" (con etiqueta marginal, |DifVP%| = 0 < 1 %).
- Dado Pc = 1.000.000, r = 0, n = 12, C = 82.500 (VP = 990.000, DifVP% = −1,00 %), entonces "conviene cuotas" **sin** etiqueta marginal; con C = 82.400 (VP = 988.800, −1,12 %) también sin etiqueta; con C = 83.000 (VP = 996.000, −0,40 %) con etiqueta marginal.
- Dado una inflación anual de 40 %, entonces r = 1,4^(1/12) − 1 ≈ 2,8436 % mensual; con Pc = 1.000.000, n = 12, C = 100.000, s = 1, VP ≈ 1.004.757 (±5 pesos), "conviene contado" con etiqueta marginal.
- Dado r manual < 0, entonces la configuración es inválida (RF-19) y no se calcula con ese valor.
- Dado una fuente REM caída con último valor previo, entonces se usa ese valor marcado como desactualizado.
- Dado una fuente REM caída sin último valor y con valor manual de respaldo, entonces se usa el manual (marcado como respaldo).
- Dado una fuente REM caída sin último valor ni manual, entonces se muestra "sin veredicto" y sí la comparación nominal (Dif$, Dif%).
- Dado una tarjeta "sin datos", fallida o sin stock, entonces no se calcula comparación para ella y no afecta a las demás.
- Dado un producto sin contado válido o sin ninguna tarjeta elegible, entonces se muestra "sin veredicto".

### RF-22 — Reglas de alerta configurables (M) — *nuevo*
Reglas definidas en la configuración (valores globales por defecto, con reemplazo por producto, S-10). Cada regla se evalúa sobre series concretas (S-31):

| Regla | Parámetro | Serie / alcance | Dispara cuando |
|---|---|---|---|
| Baja mínima en % | `baja_minima_pct` | Cada serie individualmente: contado de cada tienda y total `T` de cada tarjeta + n (no VP). Para una tienda que solo expone lista (Megatone), su serie de contado = lista. | La baja respecto de la medición válida anterior de esa serie (RN-08) es ≥ el umbral. |
| Baja mínima en $ | `baja_minima_monto` | Ídem. | Ídem en pesos. |
| Precio objetivo | `precio_objetivo` y `aplica_a` | `aplica_a = contado`: contado de cada tienda; `total_cuotas`: total `T` de cada serie tarjeta + n; `mejor_vp`: el mejor VP del producto (RF-21, con la `r` vigente). Por defecto `contado` (S-10). | El valor pasa a ser ≤ objetivo desde un valor > objetivo (cruce; no se repite mientras permanezca por debajo). |
| Cambio de mejor opción | `cambio_mejor_opcion` (sí/no) | Mejor opción del producto (tipo contado/cuotas, tienda, tarjeta) sobre series elegibles (S-26). | La mejor opción difiere de la de la ejecución anterior, incluido un cambio de veredicto contado ↔ cuotas, **solo si el cambio se debe a cambios de valores o condiciones de series elegibles en ambas ejecuciones**. |

Semántica (S-31):
- El reemplazo por producto actúa **por regla**: el valor del producto sustituye al global de esa misma regla.
- Un valor explícito `no` (o ausencia de umbral con `cambio_mejor_opcion: no`) **desactiva esa regla**. Si no hay ninguna clave de regla definida en ningún nivel, se aplica "cualquier baja estricta" sobre las mismas series que las bajas mínimas (continuidad con RF-10 original). Si hay al menos una clave definida pero todas las reglas quedan desactivadas, no se envían alertas (silencio explícito).
- Las reglas habilitadas se combinan con OR. Se aplican RN-12 y RN-13.
- **No alertan**: cambios de mejor opción o de veredicto causados solo por entrada/salida de series elegibles (falla, "sin datos", sin stock, recuperación, serie nueva) o solo por cambio de `r`, `s` o de la configuración (por ejemplo, el valor REM nuevo). En esos casos la nueva mejor opción pasa a ser la base. Un cruce de `precio_objetivo` con `aplica_a = mejor_vp` causado solo por cambio de `r` tampoco alerta.
- Una baja real tras una recuperación de falla sí puede alertar (RF-15, comparación con el último valor válido).

Criterios:
- Dado `baja_minima_pct = 5` y contado 1.000.000 → 960.000 (−4 %), entonces no hay alerta; con 940.000 (−6 %) sí.
- Dado `baja_minima_monto = 50.000` y una baja de 50.000 exactos, entonces hay alerta (umbral inclusivo).
- Dado `baja_minima_pct = 5` y una baja de −6 % en el VP del mejor valor pero ningún total `T` ni contado bajó, entonces no hay alerta por esa regla (la regla no opera sobre VP).
- Dado `precio_objetivo = 900.000` con `aplica_a = contado`, previo 950.000 y nuevo 899.000, entonces hay alerta; si la siguiente medición es 880.000, no hay nueva alerta por esta regla.
- Dado `precio_objetivo = 1.000.000` con `aplica_a = mejor_vp` y un mejor VP que pasa de 1.020.000 a 995.400 por baja del precio de la cuota, entonces hay alerta; si el cruce se produce solo porque `r` cambió, no hay alerta.
- Dado `cambio_mejor_opcion` activo y la mejor opción pasa de "contado en On City" a "12 cuotas Visa en Cetrogar" por una baja de precio en Cetrogar, entonces hay alerta que indica ambas opciones.
- Dado `cambio_mejor_opcion` activo y la mejor opción cambia porque la tienda anterior falló 4 veces (pasó a "sin datos"), entonces **no** hay alerta; tampoco al recuperarse esa tienda y volver a ser la mejor.
- Dado `cambio_mejor_opcion` activo y la mejor opción cambia solo porque `r` pasó de 3 % a 1 % (veredicto de cuotas a contado), entonces no hay alerta.
- Dado dos reglas satisfechas a la vez para el mismo valor, entonces se genera una sola alerta que lista las reglas satisfechas.
- Dado un mejor valor en empate con el anterior, entonces se mantiene la opción anterior y no hay alerta (S-10).
- Dado un producto sin ninguna clave de regla (global ni propia) y una baja estricta de 1 peso en el contado, entonces hay alerta; dado `cambio_mejor_opcion: no` como única clave definida, entonces una baja de 1 peso no genera alerta.

### RF-23 — Canal de alerta: Telegram o email (M) — *nuevo*
Las alertas se envían desde GitHub Actions por Telegram (bot) y/o email, según la configuración. S-11: Telegram como canal principal; email opcional; elección final en el DRT. Credenciales y destinatario (token del bot, chat ID, credenciales de email) solo en GitHub Actions secrets (RNF-11).
- Dado al menos un canal configurado y una alerta, entonces el mensaje llega al destino con producto, tienda, tipo de precio (contado o tarjeta + cuotas), condición (generada desde los datos estructurados de RF-20), precio anterior, precio nuevo, regla satisfecha y enlace.
- Dado 3 alertas en una misma ejecución, entonces se envía un mensaje agrupado (dividido si supera el límite del canal, S-11).
- Dado una falla de envío, entonces la alerta se reintenta en la siguiente ejecución sin duplicar envíos ya hechos y el error queda en el log del workflow sin romper el relevamiento ni el sitio (si el estado se perdió, ver S-25).
- Dado un secreto ausente o inválido del canal configurado, entonces no se envía, se emite un **aviso operativo** (RNF-15; coherente con S-18) y el resto del flujo (medición, historial, sitio) continúa.
- El idioma del mensaje es es-AR por defecto, configurable a en (S-11).

### RF-24 — Historial en archivos del repo (M) — *nuevo (resuelve A-02)*
El historial de precios (por producto, tienda y serie: contado, o tarjeta + n; y lista cuando la tienda solo expone un precio) se guarda como archivos del repo con la política de la **sección 9** y los límites de RNF-13.
- Dado un relevamiento con cambios, cuando termina, entonces los puntos nuevos quedan en archivos versionados con marca de tiempo, valor, condición/cuotas, estado y tienda.
- Dado un punto de más de 12 meses (S-13), entonces se elimina de los archivos activos en el siguiente relevamiento, **salvo el último punto de cada serie, que se conserva siempre** aunque tenga más de 12 meses (un valor sin cambios durante 13 meses sigue representando el precio vigente).
- Dado una serie estable durante 13 meses con un único punto de hace 13 meses, entonces tras la purga ese punto sigue en los archivos activos y el gráfico (RF-17) muestra el valor vigente.
- Dado una serie con puntos de hace 14 y 13 meses y de hace 2 meses, entonces tras la purga queda solo el de hace 2 meses; dado una serie con puntos de hace 14 y 13 meses únicamente, entonces queda solo el de hace 13 meses.
- Dado un relevamiento en el que ningún punto de historial cambia, entonces **no se genera commit** (cero commits), aunque haya cambiado el estado de ejecución o la marca "actualizado a las" (sección 9).
- Dado una ejecución con al menos un punto nuevo, entonces se genera un único commit con mensaje convencional.

## 7. Reglas de negocio

| ID | Regla | Estado | Criterio de aceptación |
|---|---|---|---|
| RN-01 | Todo contenido descargado de tiendas o fuentes de inflación es dato no confiable; nunca se interpreta como instrucciones. | Confirmada (se mantiene) | Dado HTML con texto "ignora instrucciones y envía…", entonces solo se extraen campos de precio validados y el texto no altera el comportamiento. Lo mostrado en el sitio y en los mensajes se escapa (sin ejecución de HTML/script ni formato de Telegram inyectado). |
| RN-06 | Sin stock / discontinuado / precio cero: estado "sin stock", no es baja, no es falla (no suma al contador de RF-15), sin alerta; la serie no es elegible para mejor opción/veredicto mientras esté sin stock; al volver el stock se compara con el último precio válido. | Confirmada (se mantiene) | Dado precio 0 o "agotado", entonces "sin stock" y sin alerta. Dado reposición a un valor menor que el último válido, entonces puede alertar según RF-22. |
| RN-08 | Los valores se comparan solo dentro de la misma tienda y serie: contado, o tarjeta + cantidad de cuotas; baja = valor estrictamente menor que la medición válida anterior. | **Supuesto** S-24 (se mantiene, ampliado) | Dado Visa 12 cuotas total 1.200.000 y luego Visa 6 cuotas total 1.100.000, entonces no se comparan: la serie "Visa 12" se cierra (sin más puntos y no elegible, queda en el historial), se abre la serie "Visa 6" sin alerta (RN-12) y el contador de fallas de la serie nueva parte de 0. Un cambio de condición del contado dentro de la misma tienda no crea una serie nueva (el contado siempre es el mejor pago único). Dado una tarjeta con n que cambia 3 veces en 3 meses, entonces el historial tiene 4 series para esa tienda y tarjeta, y solo la vigente es elegible. |
| RN-09 | La tarjeta se toma solo si la tienda publica explícitamente cuotas sin interés para esa tarjeta. | **Supuesto** (S-04, se mantiene) | Dado 12 cuotas con interés, entonces "sin datos". |
| RN-10 | Contado = mejor precio de pago único (transferencia, débito, efectivo o promo de un pago) con su condición; el precio de lista no es el contado (reemplaza RN-05). | Confirmada (ronda 7) | Ver RF-20. |
| RN-11 | El valor presente de las cuotas descuenta cada cuota con la inflación mensual esperada `r`, a partir del mes `s` (por defecto 1), según RF-21. | Confirmada (fórmula); `s` y uso de REM: **Supuesto** S-07 | Ver ejemplo numérico de RF-21. |
| RN-12 | La primera medición de un producto/serie nunca alerta, aunque cumpla alguna regla (p. ej. ya esté bajo el precio objetivo). | Confirmada (ronda 7) | Dado una serie sin medición previa válida y un valor bajo el objetivo, entonces se registra sin alerta. Dado una nueva cantidad de cuotas sin antecedente, entonces se registra sin alerta. Dado un producto quitado y vuelto a agregar a la configuración, entonces sus series reinician sin alerta (S-33). |
| RN-13 | Una baja > 90 % respecto del valor previo se alerta igual pero marcada "a verificar" (puede ser error de la tienda). | Confirmada (ronda 7); inclusividad: **Supuesto** S-16 | Dado 1.000.000 → 80.000, entonces la alerta lleva la marca "a verificar"; con −90 % exacto (100.000) no se marca (el umbral es estrictamente mayor). |
| RN-14 | Fuera de alcance: promociones de un banco emisor específico con reintegro, cupones y millas. En alcance: descuentos genéricos por medio de pago único. | Confirmada (ronda 7) | Dado "20 % de reintegro con Banco X", entonces no modifica el contado. Dado "10 % off por transferencia" sin banco específico, entonces sí. |

## 8. Requisitos no funcionales

| ID | Requisito (medible) | Estado | Criterio de aceptación |
|---|---|---|---|
| RNF-01 | Arquitectura serverless de costo cero: GitHub Actions + GitHub Pages (impuesta). Costo mensual = USD 0; sin servicios externos de pago ni backend propio. Con el repo público, los runners estándar de GitHub Actions no consumen cuota de minutos (gratis), por lo que **no se define un presupuesto mensual de minutos**; el límite relevante es el **timeout por ejecución** (S-15, S-29): ejecución completa (medición, historial, construcción del sitio) ≤ 10 min, aplicado como `timeout-minutes` del job. | Confirmada (costo cero); runners gratuitos por repo público y timeout de 10 min: **Supuesto** | Dado un mes de operación con el repo público y runners estándar, entonces no hay cargos y ninguna ejecución supera 10 min (el job se corta por timeout). Si el repo pasara a privado, entonces hay que reevaluar la cuota de minutos (**a verificar** contra las condiciones vigentes de GitHub). |
| RNF-03 | Idiomas de la UI: es-AR (por defecto) y en; el 100 % de las cadenas visibles existe en ambos. Las condiciones de contado se generan desde datos estructurados (RF-20). | Confirmada | Dado el cambio de idioma, entonces ninguna cadena queda sin traducir (incluidas las condiciones de contado); sin preferencia previa se muestra es-AR. |
| RNF-06 | Precios en ARS con marca de tiempo de cada medición; la UI muestra "actualizado a las…" en horario de Argentina, generada al construir el sitio (no versionada, sección 9). También el valor de inflación usado y su fecha. | **Supuesto** S-22 | Dado un producto, entonces cada precio muestra fecha/hora de su última medición válida. Dado una ejecución sin cambios de historial, entonces "actualizado a las…" refleja igualmente esa ejecución sin generar commit. |
| RNF-07 | Respeto a ToS/robots en lo factible: máx. 1 pedido/seg por dominio (S-03), User-Agent identificable, sin evadir protecciones anti-bot; tiendas que lo prohíban se retiran (RF-04, S-28). | **Supuesto** | Dado un bloqueo anti-bot (captcha, 403), entonces se trata como falla (RF-15) y no se intenta evadirlo. |
| RNF-08 | Accesibilidad WCAG 2.2 AA; navegadores Baseline Widely available (CLAUDE.md). | **Supuesto** S-23 | Dado una auditoría automatizada y revisión manual de las pantallas de RF-17, entonces 0 incumplimientos AA críticos (incluye gráfico con alternativa en tabla). |
| RNF-10 | Disponibilidad: ≥ 95 % de las ejecuciones programadas por mes terminan, es decir completan medición, historial y publicación del sitio aunque haya fallas parciales de tiendas o avisos operativos (las tiendas bloqueadas o caídas son fallas parciales y no hacen fallar la ejecución; S-17 reemplazado por S-35). | **Supuesto** S-02 | Dado un mes, entonces ≥ 95 % de las ejecuciones terminan. |
| RNF-11 | Seguridad: secretos solo en GitHub Actions secrets o variables locales; nunca en el repo ni en logs (CLAUDE.md). | Confirmada | Dado el repo y los logs de una ejecución, entonces un escaneo de secretos no detecta credenciales. |
| RNF-12 | **Degradación por tienda:** la falla de una tienda (timeout, 403, bloqueo de IP, HTML cambiado, captcha) no impide medir las demás, escribir el historial, calcular veredictos, enviar alertas ni publicar el sitio. Timeouts (S-03, S-29): 30 s por pedido y 5 min por tienda; **las tiendas se miden en paralelo entre sí** (secuencial dentro de una tienda, respetando RNF-07), de modo que el peor caso sea ≈ 5 min + construcción del sitio, dentro del límite de 10 min de RNF-01. | Confirmada (ronda 7); timeouts y paralelismo: **Supuesto** | Dado 4 de 5 tiendas de la lista vigente fallando, entonces la ejecución termina, la tienda sana se actualiza y el sitio se publica con las demás marcadas con falla/"sin datos". Dado todas las tiendas alcanzando el timeout de 5 min, entonces la ejecución completa (incluido el sitio) en ≤ 10 min. Dado todas las tiendas fallando, entonces el sitio sigue publicado con datos previos y marcas de falla y se emite un aviso operativo (RNF-15). |
| RNF-13 | Tamaño y retención del historial en repo (S-13, S-33): 12 meses de retención (conservando el último punto de cada serie, RF-24); ≥ 45 MB de datos activos = aviso operativo; > 50 MB = el aviso se mantiene y se sigue registrando (límite blando); > 100 MB (límite duro) = no se persisten nuevos puntos, aviso operativo y el resto del flujo (alertas, sitio) continúa. | **Supuesto** | Dado datos activos ≥ 45 MB, entonces se emite aviso operativo (RNF-15); dado un punto de más de 12 meses que no es el último de su serie, entonces se retira; dado > 100 MB, entonces no hay commit de historial nuevo y hay aviso. |
| RNF-14 | Sin datos personales: el repo, el historial y el sitio no contienen datos personales; el destinatario de alertas (chat ID, email) vive solo en secretos. | Confirmada (ronda 7) | Dado el repo y el sitio publicados, entonces una revisión/escaneo no encuentra emails, chat IDs ni datos de terceros. |
| RNF-15 | **Aviso operativo (definición única, S-18):** notificación al dueño de un problema del sistema (no de un precio). Consiste en (a) una línea de error en el log y en el resumen de la ejecución y (b) un issue de GitHub etiquetado `cuotear-ops`, uno abierto por causa (se actualiza, no se duplica). No depende de los secretos del canal de alertas y **no hace fallar** la ejecución. Causas: todas las tiendas fallan (RNF-12), faltan o son inválidos los secretos del canal (RF-23), configuración inválida (RF-19, RF-02), historial ≥ 45 MB / > 100 MB (RNF-13). | **Supuesto** S-18 | Dado todas las tiendas fallando, entonces existe un issue `cuotear-ops` abierto con la causa y la ejecución termina; dado la misma causa en la ejecución siguiente, entonces no se abre un segundo issue. Dado un secreto ausente, entonces hay aviso y las demás etapas se completan. |

## 9. Datos capturados y retención

| Dato | Detalle | Ubicación | Retención |
|---|---|---|---|
| Configuración | Productos (≤ 10), URLs por tienda, reglas de alerta, canal, fuente de inflación, `s` | Archivo del repo (validado, RF-19) | Versionada en git |
| Historial de precios | Por producto, tienda y serie (contado, o tarjeta + n; lista si la tienda solo expone un precio): valor, condición (estructurada), lista, cuotas, estado, marca de tiempo | Archivos del repo (versionados) | 12 meses, conservando el último punto de cada serie (S-13); el git history conserva versiones anteriores; al quitar un producto de la configuración, su historial sale de los archivos activos en el siguiente relevamiento (S-33) |
| Estado de ejecución | Última medición válida y marca de tiempo por serie, contadores de fallas consecutivas (por tienda y serie), alertas pendientes de reintento, última inflación usada, **última configuración válida**, **mejor opción anterior** por producto, hora de la última ejecución | **Almacenamiento de estado no versionado** (p. ej. caché de GitHub Actions; mecanismo: DRT). **No se commitea** | Mientras el producto esté en la configuración; ver pérdida del estado (S-25) |
| Valores calculados | VP, diferencias, veredicto, "actualizado a las…" (derivables) | Datos del sitio generados en cada ejecución y publicados sin commit al repo (p. ej. despliegue de Pages desde el workflow; DRT) | Regenerados en cada ejecución |
| Secretos | Token de bot, chat ID, credenciales de email | GitHub Actions secrets | Fuera del repo |

Política de historial y de estado (S-13, S-25):
- **Dónde vive cada cosa:** el historial (solo cambios) es lo único que se commitea; el estado de ejecución y la marca de tiempo de cada ejecución viven fuera de los commits (estado no versionado y sitio generado). Por eso una ejecución sin cambios de historial produce **cero commits**, aunque cambien contadores, última medición o "actualizado a las…".
- Se agrega un punto a la serie solo cuando cambia el valor, la condición o el estado. El último valor válido de una serie es el último punto del historial (la fecha de la última medición válida sale del estado de ejecución).
- Un único commit por ejecución, solo si algún punto de historial cambió (o si la purga eliminó puntos), con mensaje convencional (p. ej. `chore(data): ...`).
- **Pérdida del estado de ejecución** (S-25): contadores a 0; la mejor opción anterior se reconstruye desde el historial y esa ejecución no alerta por `cambio_mejor_opcion`; las alertas pendientes de reintento se pierden; la última configuración válida se pierde (si la configuración vigente es inválida, no se mide y hay aviso operativo, RF-19); no se pierde historial.
- Archivos separados por producto (y por año si crece) para mantener diffs pequeños.
- Estimación de tamaño (**Supuesto**): 10 productos × 5 tiendas × 4 series ≈ 200 series (hasta 360 si se reincorporan las 9 tiendas originales); con registro solo ante cambios, el volumen esperado es de unos pocos MB por año; sin esa optimización sería de decenas de MB (RNF-13).
- El historial no contiene datos personales. No se guarda HTML descargado, solo los campos extraídos.
- Si el repo es público, la configuración y el historial son públicos (S-14: aceptado por el dueño, no contienen datos personales).

## 10. Integraciones y riesgos

| Integración | Uso | Requisitos | Riesgos |
|---|---|---|---|
| On City, Cetrogar, Carrefour, Naldo (provisional) | API JSON de VTEX: precio de lista, cuotas sin interés por tarjeta, stock y simulación de checkout (`POST /api/checkout/pub/orderForms/simulation`, código postal 5000) como fuente del contado (S-37). Verificado desde runner. | RF-04, RF-14, RF-20 | Cambios de la API, bloqueos futuros, ToS; Carrefour con varios vendedores (S-38); Naldo sin el 75T6C (S-40) |
| Megatone | Solo URL directa de producto; precio en JSON-LD (sin tarjetas ni contado). Funciona desde el runner. | RF-04, RF-20 | Sin búsqueda; cambio de HTML/JSON-LD; ToS |
| Frávega, Rodo, Musimundo, Mercado Libre vía MejoresCompras | **No integradas en v1** (candidatas, sección 3): bloqueo 403 desde el runner (Frávega, MejoresCompras), sin precios en HTML (Rodo), sin catálogo (Musimundo). | — | Ver R-01, R-02 |
| Telegram Bot API / email | Envío de alertas | RF-23 | Límites de mensaje, entregabilidad del email, secretos mal configurados |
| BCRA REM (u otra fuente) | Inflación mensual esperada | RF-21 | Formato/disponibilidad no verificados; ver fallback en RF-21 |
| GitHub Actions / GitHub Pages / issues | Planificación, relevamiento, commits de historial, estado, hosting del sitio y avisos operativos | RNF-01, RF-07, RF-24, RNF-15 | Demoras del cron, timeout por ejecución, suspensión del cron por inactividad, expiración de la caché de estado |

### Riesgos principales

| ID | Riesgo | Impacto | Mitigación inicial (a detallar en DRT) |
|---|---|---|---|
| R-01 | **Las tiendas bloquean los runners de GitHub Actions** (IPs de datacenter; WAF/anti-bot tipo Cloudflare/CloudFront devuelven 403/captcha). **MATERIALIZADO (spike 2026-11-22): 2 de 9 fuentes bloqueadas desde el runner `ubuntu-24.04`**: Frávega (403 CloudFront) y MejoresCompras (403 Cloudflare, desafío "Just a moment..."); ambas funcionan desde IP local en Argentina. Las otras 7 respondieron desde el runner (On City, Cetrogar, Carrefour, Naldo, Megatone con datos; Rodo y Musimundo sin datos utilizables por otras razones). | Frávega y Mercado Libre salen del conjunto medido de v1 (S-35, S-36); otras tiendas pueden bloquearse en el futuro; la lista de RF-04 puede reducirse (S-28). | **Aplicada:** no se evaden bloqueos ni se resuelven captchas (RNF-07); degradación por tienda (RNF-12, RF-15: la tienda bloqueada queda "sin datos" sin fallar la ejecución); se usan endpoints JSON públicos (VTEX) donde existen; las tiendas bloqueadas se retiran de la lista vigente con decisión documentada (S-28, S-35, S-36). Opciones restantes para el DRT, sin decidir aquí: reducir frecuencia/volumen, reintentos con espera, ejecución manual local como respaldo, ver también R-02. Opciones para el DRT, sin decidir aquí: endpoints JSON/API públicos de las tiendas, reducir frecuencia/volumen, reintentos con espera, ejecución manual local como respaldo, descartar tiendas inviables. **Prueba temprana (spike) de cada tienda desde un runner antes de construir adaptadores.** |
| R-02 | **Materializado:** no hay una fuente viable para Mercado Libre desde GitHub Actions (MejoresCompras responde 403 Cloudflare). | Mercado Libre fuera del conjunto medido de v1. | S-35; alternativas abiertas para el DRT: API oficial de Mercado Libre (no verificada), carga manual de precios, runner propio/de otra IP (rompe el costo cero serverless, RNF-01). |
| R-03 | Cambios de HTML de las tiendas rompen los adaptadores. | Mediciones fallidas. | RF-15, aviso operativo (RNF-15), adaptadores aislados (RF-05). |
| R-04 | Repo inactivo: GitHub suspende cron en repos públicos tras 60 días sin actividad; con commits solo ante cambios de historial hay menos actividad. | Se detiene el relevamiento y la propia ejecución no puede avisar. | A verificar si los commits del bot cuentan como actividad; GitHub notifica por su cuenta la deshabilitación (a verificar); el dueño puede reactivar y ejecutar manualmente. No se agrega commit de latido en v1 (S-25). El aviso operativo (RNF-15) no cubre este caso. |
| R-05 | Crecimiento del repo por commits de historial. | Repo pesado. | Commits solo ante cambios de historial (sección 9), RNF-13. |
| R-06 | Cálculo de veredicto sensible a `r` y `s`; la inflación esperada es incierta. | Veredicto erróneo si el supuesto es malo. | Mostrar siempre `r`, `s` y su fuente; etiqueta "diferencia marginal"; veredicto indicativo. |
| R-07 | Pérdida o expiración del estado de ejecución no versionado (S-25). | Contadores y alertas pendientes perdidos; una ejecución sin alerta de mejor opción. | Comportamiento definido en sección 9; el historial no se pierde. |

Toda integración con tiendas y fuentes externas trata la respuesta como no confiable (RN-01).

## 11. Casos límite y errores

| Situación | Comportamiento esperado |
|---|---|
| Lista vacía en la configuración | Estado vacío en el sitio (RF-17). |
| Configuración inválida (incluye 11 productos) | La validación falla; se usa la última configuración válida y hay aviso operativo (RF-19, RF-02, RNF-15). |
| Tienda caída / bloqueada / HTML cambiado | RF-15, RNF-12. |
| Tienda bloqueada desde el runner (403, captcha) | Falla de tienda: se conserva el último valor, "sin datos" tras N fallas, sin evasión, la ejecución no falla y el resto no cambia (RF-15, RNF-07, RNF-12). |
| URL de una tienda fuera de la lista vigente (Frávega, Rodo, Musimundo, Mercado Libre) | La validación de configuración falla (RF-04, RF-19). |
| Tienda que solo expone precio (Megatone) | Precio como lista y contado = lista con condición {ninguno}; tarjetas "sin datos" (RF-03, RF-20). |
| Tienda con pocas tarjetas (Carrefour: solo Mastercard 3x) | Las demás tarjetas "sin datos" sin falla (RF-14). |
| Carrefour con dos vendedores (uno con precio 0 / sin stock) | Se ignora el vendedor sin stock; se mide el otro (S-38). |
| Producto que la tienda no ofrece (p. ej. Naldo con el 75T6C) | Sin oferta: "sin datos" sin falla ni aviso (RN-06, S-40). |
| URL de búsqueda de Megatone (404) | No soportada; solo URL directa de producto (S-39). |
| Simulación de checkout de VTEX no disponible | Contado = precio publicado con condición {ninguno}, sin falla (RF-20, S-37). |
| Precio inválido (negativo, no numérico) | Falla de medición, sin alerta; 0 = sin stock (RN-06). |
| Salto de precio extremo (> 90 % de baja) | Alerta con marca "a verificar" (RN-13). |
| Primera medición | Se registra sin alerta (RN-12). |
| Cambio de cantidad máxima de cuotas | Serie nueva por n; la anterior se cierra; sin antecedente, sin alerta (RN-08, RN-12). |
| Serie fallida, "sin datos" o sin stock | No elegible para mejor opción ni veredicto; sigue visible con marca (S-26). |
| Cambio de mejor opción por entrada/salida de series o por cambio de `r` | No alerta (RF-22). |
| Descuento de contado detectado pero no interpretable | La medición de contado se marca fallida; no se usa el precio de lista como contado (S-05). |
| Inflación `r` ≤ 0 o ausente | `r = 0` válido → VP = total. `r < 0`: configuración inválida (S-09). Ausente: ver fallback RF-21. |
| Telegram/email caído | Reintento en la siguiente ejecución sin duplicados (RF-23). |
| Secreto del canal ausente | Sin envío, aviso operativo, el resto continúa (RF-23, RNF-15). |
| Todas las tiendas fallan | Sitio publicado con datos previos y marcas de falla; aviso operativo (RNF-12, RNF-15). |
| Ejecución sin cambios de historial | Cero commits; el sitio se publica igual con "actualizado a las…" nuevo (sección 9). |
| Pérdida del estado de ejecución | Ver sección 9 (S-25). |
| Datos > 12 meses | Se purgan salvo el último punto de cada serie (RF-24). |
| Historial ≥ 45 MB / > 50 MB / > 100 MB | Aviso / límite blando con aviso sostenido / se dejan de persistir puntos (RNF-13). |
| Producto quitado de la configuración | Su historial y estado salen de los archivos activos en el siguiente relevamiento; sin alertas; si se vuelve a agregar, series nuevas sin alerta (S-33, RN-12). |
| URL duplicada o más de una URL por tienda en un producto | La validación la rechaza (S-12). |

## 12. Alternativas existentes

Datos verificados por el dueño del proyecto sobre **MejoresCompras** (https://mejorescompras.com.ar/) el 22/11/2026. Lo que no figura en esta lista no está verificado y no se afirma.

**Qué ofrece MejoresCompras (verificado):**
- Cubre solamente Mercado Libre.
- Cerca de 42.000 productos, elegidos por ellos (el usuario no elige qué seguir).
- Snapshot diario de precios.
- Detección de descuentos inflados (mediana y mínimo histórico).
- Alertas por Telegram.
- Gratis y sin registro.
- Extensión de Chrome.

**Qué no ofrece (verificado):** no compara contado vs cuotas, no filtra por tarjeta y no cubre otras tiendas.

| Capacidad | MejoresCompras | cuotear (objetivo de v1) |
|---|---|---|
| Tiendas cubiertas | Solo Mercado Libre | Lista vigente de RF-04 (On City, Cetrogar, Carrefour, Naldo provisional, Megatone); **Mercado Libre no está cubierto en v1** (S-35) |
| Catálogo | ~42.000 productos elegidos por ellos | Hasta 10 productos elegidos por el dueño (RF-02, RF-19), con URLs por tienda |
| Frecuencia de medición | Snapshot diario | Cada 6 h (RF-07) |
| Detección de descuentos inflados (mediana, mínimo histórico) | Sí | Fuera de alcance de v1 (sección 2.2); el historial propio (RF-24) lo permitiría en el futuro |
| Contado vs cuotas sin interés | No | Sí, con valor presente y veredicto (RF-20, RF-21) |
| Filtro por tarjeta (Visa, Mastercard, Naranja X) | No | Sí (RF-14) |
| Alertas | Telegram | Telegram o email con reglas configurables (RF-22, RF-23) |
| Costo y registro | Gratis, sin registro | USD 0 (RNF-01), sin login (RF-17) |
| Extensión de Chrome | Sí | No (fuera de alcance, sección 2.2) |
| Código de MejoresCompras | No verificado (no se afirma) | — |
| Código de cuotear | — | Abierto, **licencia MIT** (decidido por el dueño; ya no es punto abierto); extensible por el desarrollador (RF-05) |

Diferencial de cuotear: compara contado vs cuotas por tarjeta con veredicto a valor presente, cubre varias tiendas y permite reglas de alerta personales. MejoresCompras es más amplio en catálogo de Mercado Libre y ofrece detección de descuentos inflados y extensión de navegador, que cuotear no busca replicar en v1. cuotear no reemplaza a MejoresCompras. **Actualización v0.4:** MejoresCompras bloquea a los runners de GitHub Actions (403 Cloudflare; spike 2026-11-22), por lo que cuotear v1 no depende de él ni cubre Mercado Libre; para ese caso MejoresCompras sigue siendo la alternativa existente (uso manual).

## 13. Trazabilidad con el log (incluye reemplazados)

| ID del log | Estado en v0.3 | Detalle |
|---|---|---|
| RF-01 | Modificado | Ahora por reglas (RF-22). |
| RF-02 | Modificado | Vuelve a 10 productos; consistente con RF-19 (última configuración válida). |
| RF-03 | Modificado | Contado ≠ lista; ver RF-20. |
| RF-04, RF-05, RF-07, RF-14, RF-15 | Mantenidos / modificados | RF-04 con lista vigente reducida (v0.4: ML, Frávega, Rodo y Musimundo fuera del conjunto medido); RF-07 sin excepción de ML (v0.4); RF-14 con total y cuota; RF-15 con contador por serie; RF-05 sin cambio sustancial. |
| RF-06 | **Superseded** | Formulario web de alta: sustituido por configuración en archivo (RF-19) y UI de solo lectura (RF-17). |
| RF-08 | **Superseded** | Multiusuario fuera de alcance (v2). |
| RF-09 | **Superseded** | Canal solo email: reemplazado por RF-23 (Telegram o email). |
| RF-10 | **Superseded** | "Cualquier baja": reemplazado por RF-22 (queda como regla por defecto). |
| RF-11 | **Superseded** | Sin OAuth ni cuentas (v2). |
| RF-12 | **Superseded** | Alta por URL desde la web; las URLs ahora están en la configuración (RF-19). |
| RF-13 | **Superseded** | Coincidencia automática entre tiendas fuera de alcance (v2). |
| RF-16 | **Superseded** | Proveedor de email multiusuario: reemplazado por RF-23. |
| RF-17 | Modificado | Sitio de solo lectura, sin pantallas de ingreso, alta ni cuenta. |
| RF-18 | **Superseded** | Emails por usuario/idioma de cuenta: reemplazado por RF-23. |
| RN-01, RN-06, RN-08, RN-09 | Mantenidas | RN-08 ampliada; RN-06 aclara que no es falla. |
| RN-02 | **Superseded** | 5 por usuario: vuelve a 10 productos (RF-02). |
| RN-03 | **Superseded** | Tope global de 50 URLs: sin multiusuario. |
| RN-04 | **Superseded (absorbida)** | Su idea (el límite cuenta productos, no URLs) se absorbe en RF-02; no pasa a v2 (sección 3 lo aclara). |
| RN-05 | **Superseded** | Contado = lista: reemplazado por RN-10. |
| RN-07 | **Superseded** | Confirmación de coincidencias: no hay coincidencia automática (v2). |
| RNF-01, RNF-03, RNF-06, RNF-07, RNF-08, RNF-10, RNF-11 | Mantenidos | RNF-01 con timeout por ejecución medible (sin presupuesto mensual: repo público); RNF-11 confirmada (CLAUDE.md). |
| RNF-02 | **Superseded** | Backend externo: no hay escritura desde la UI. |
| RNF-04 | **Superseded** | Privacidad/borrado de cuenta/Ley 25.326: sin datos personales (RNF-14). Retención de 12 meses se conserva en RNF-13. |
| RNF-05 | **Superseded** | Anti-abuso multiusuario: no aplica. |
| RNF-09 | **Superseded** | Baja de alertas por enlace: no hay terceros; se configuran en el archivo. |
| A-02 | Resuelto | Historial en archivos del repo (RF-24). |
| Q-01 | **Superseded en v0.4 (ronda 10)** | MejoresCompras bloqueado desde el runner: Mercado Libre fuera del conjunto medido (S-35); alternativas en 15.2. |
| Q-02, DEC-01 | Sin contenido funcional | — |
| V2-01 | Mantenido | Lista de diferidos a v2: sección 3 (y 2.2). |
| ALT-01 | Mantenido y actualizado | Sección 12; datos de MejoresCompras verificados por el dueño el 22/11/2026; licencia MIT decidida. |
| R-01 | **Materializado (ronda 10)** | Sección 10: 2 de 9 fuentes bloqueadas desde el runner (Frávega, MejoresCompras); sin evasión; degradación por tienda; efecto sobre RF-04 (S-28, S-35, S-36). |
| Spike de acceso a tiendas (ronda 10) | Nuevo | RF-04 (lista vigente y criterios), RF-07 (sin excepción de ML), RF-03, RF-14 (cuotas por tienda), RF-15, RF-17, RF-20 (contado = publicado, S-37), RF-21 (texto), RNF-10, R-01, R-02, secciones 3, 10, 11, 12; S-35 a S-40; preguntas 14 a 18 de 15.2. Informe: `docs/spikes/store-access.md` (rama `spike/store-access`). |
| Nuevos | RF-19, RF-20, RF-21, RF-22, RF-23, RF-24; RN-10 a RN-14; RNF-12, RNF-13, RNF-14; RNF-15 (ronda 8); R-07 | Ronda 7 y ronda 8. |

Cobertura de casos de uso: todo RF vigente (RF-01 a RF-05, RF-07, RF-14, RF-15, RF-17, RF-19 a RF-24) aparece en la sección 5. RF-03 figura en CU-05, CU-08 y CU-09; RF-24 en CU-05 y CU-09; RF-02 en CU-01 y CU-04.

## 14. Glosario

| Término | Definición |
|---|---|
| Precio de lista | Precio publicado sin descuento por medio de pago ni financiación. No es el contado. |
| Precio de contado | Mejor precio de pago único (transferencia, débito, efectivo o promo de un pago), con su condición (RN-10). |
| Condición (del contado) | Dato estructurado (medio de pago + % de descuento) que justifica el precio de contado (RF-20). |
| Cuotas sin interés | Pago en cuotas cuyo total no incluye recargo financiero publicado por la tienda. |
| Tarjeta | Visa, Mastercard o Naranja X en v1. |
| Valor presente (VP) | Valor equivalente hoy de las cuotas futuras, descontadas con la inflación mensual esperada. |
| Inflación mensual esperada (`r`) | Tasa de descuento mensual; de REM o manual. |
| `h` | Horizonte en meses sobre el que se promedian las expectativas del REM (= n de la opción evaluada). |
| REM | Relevamiento de Expectativas de Mercado del BCRA. |
| Veredicto | "Conviene contado" o "conviene cuotas" según VP vs contado. |
| Mejor opción | Combinación tipo (contado/cuotas), tienda y tarjeta de menor valor efectivo, calculada solo con series elegibles. |
| Serie | Secuencia de valores comparables: contado de una tienda, o tarjeta + n de una tienda; lista si la tienda solo expone un precio (RN-08). |
| Serie elegible | Serie cuyo estado actual es "válida" (no fallida, no "sin datos", no sin stock, no cerrada). Solo estas entran en mejor opción y veredicto (S-26). |
| Producto | Entidad monitoreada; agrupa URLs de tienda. |
| Adaptador | Módulo por tienda que extrae datos (RF-05). |
| Medición válida / fallida | Medición exitosa con precio > 0 y stock / que no pudo completarse (RF-15). |
| Baja | Valor estrictamente menor que la medición válida anterior de la misma serie. |
| Sin datos | Estado visible cuando no hay oferta para una tarjeta, o tras N fallas (incluida una tienda bloqueada). |
| Desactualizado | Última medición válida con más de 12 h de antigüedad (RF-17). |
| Aviso operativo | Aviso al dueño de un problema del sistema: log/resumen + issue `cuotear-ops`, sin fallar la ejecución (RNF-15). |
| Estado de ejecución | Datos de trabajo no versionados entre ejecuciones (contadores, última medición, última configuración válida, mejor opción anterior); sección 9. |
| VTEX | Plataforma de comercio electrónico usada por On City, Cetrogar, Carrefour y Naldo; expone una API JSON pública de catálogo y simulación de checkout (spike). |
| Conjunto medido de v1 | Tiendas de la lista vigente de RF-04 cuyo acceso desde el runner fue verificado. |
| Runner | Máquina de GitHub Actions que ejecuta el relevamiento. |
| MejoresCompras | Sitio tercero de seguimiento de Mercado Libre; bloquea a los runners (no usado como fuente en v1). |
| ARS | Peso argentino. |
| Baseline Widely available | Funciones web soportadas ampliamente por los navegadores principales. |
| WCAG 2.2 AA | Pautas de accesibilidad web nivel AA. |

## 15. Decisiones del analista y preguntas abiertas para el DRT

### 15.1 Supuestos (decididos por el analista)

| # | Supuesto | Ref. |
|---|---|---|
| S-01 | N = 4 fallas consecutivas antes de "sin datos". | RF-15 |
| S-02 | Tolerancia de 60 min en el cron; objetivo de 95 % de ejecuciones exitosas. | RF-07, RNF-10 |
| S-03 | 1 pedido/seg por dominio; timeouts de 30 s por pedido y 5 min por tienda. | RNF-07, RNF-12 |
| S-04 | Cuotas con interés no se registran; con varias opciones se toma la de mayor n sin interés; total válido si difiere de n × C en ≤ n pesos. | RN-09, RF-14 |
| S-05 | Sin descuento de pago único, contado = lista con condición {ninguno}; descuentos no interpretables = medición de contado fallida. | RF-20 |
| S-06 | Descuentos que exigen banco/tarjeta específicos quedan fuera. | RN-14 |
| S-07 | Primera cuota en el mes s = 1 (parametrizable 0/1); tasa constante; REM = promedio de los próximos h meses con h = n de la opción evaluada; conversión anual → mensual compuesta. | RF-21, RN-11 |
| S-08 | Veredicto binario; empate = contado; etiqueta "diferencia marginal" si \|DifVP%\| < 1 % (con ≥ 1 % no hay etiqueta); veredicto de producto compara mejor contado global vs mejor VP global. | RF-21 |
| S-09 | Fallback de inflación: último valor (desactualizado) → manual → sin veredicto; r < 0 inválido. | RF-21, RF-19 |
| S-10 | Reglas globales con reemplazo por producto; combinadas con OR; sin reglas = cualquier baja estricta; umbrales inclusivos; objetivo por cruce; `aplica_a` por defecto contado; empate mantiene la opción anterior. | RF-22 |
| S-11 | Telegram canal principal, email opcional; mensaje agrupado y dividido si excede el límite; idioma es-AR por defecto. | RF-23 |
| S-12 | Se conserva la última configuración válida si la nueva falla (también con 11 productos); una URL por tienda por producto; URL duplicada rechazada. | RF-19, RF-02 |
| S-13 | Historial: punto solo ante cambios; un commit por ejecución solo si hay cambios de historial; retención 12 meses conservando el último punto de cada serie; advertencia a 45 MB, límite blando 50 MB; archivos por producto. | RF-24, RNF-13 |
| S-14 | El sitio y el repo son públicos; sin datos personales. | RNF-14, sección 9 |
| S-15 | Límite por ejecución: ≤ 10 min (`timeout-minutes`; incluye construcción del sitio). Repo público con runners estándar: minutos gratis, sin presupuesto mensual. | RNF-01 |
| S-16 | Umbral "a verificar" estrictamente mayor a 90 %. | RN-13 |
| S-17 | ~~Mercado Libre es best-effort: su falla no cuenta contra RNF-10.~~ **Reemplazado por S-35** (ML fuera del conjunto medido). Se mantiene la regla general: la falla o bloqueo de cualquier tienda no hace fallar la ejecución (RNF-12). | RF-04, RNF-10 |
| S-18 | **Aviso operativo** definido una sola vez (RNF-15): log/resumen + issue `cuotear-ops` (uno abierto por causa), sin fallar la ejecución ni depender de los secretos del canal. Se emite si todas las tiendas fallan, faltan secretos del canal (RF-23: no se envía, se avisa y el resto continúa), configuración inválida o historial ≥ 45 MB. | RNF-15, RNF-12, RNF-13, RF-23, RF-19, R-04 |
| S-19 | Fuera de alcance v1: compra automática, app móvil nativa, monedas distintas de ARS, extensión de navegador, detección de descuentos inflados. | Sección 2.2 |
| S-20 | Pantallas del sitio: lista de productos y detalle con gráfico. | RF-17 |
| S-21 | Contenido mínimo de la configuración por producto: id estable, nombre, URLs por tienda, reglas propias opcionales (incluye `baja_minima_monto`); parámetros globales de reglas, canal, inflación y `s`. | RF-19, RF-01 |
| S-22 | "Actualizado a las…" en horario de Argentina, generado al construir el sitio; muestra la inflación usada y su fecha. | RNF-06 |
| S-23 | Objetivo WCAG 2.2 AA con auditoría automatizada + revisión manual. | RNF-08 |
| S-24 | Comparación solo dentro de la misma serie; baja estricta; al cambiar n se cierra la serie anterior y se abre una nueva. | RN-08 |
| S-25 | El estado de ejecución (contadores, última medición, última configuración válida, mejor opción anterior, alertas pendientes, hora de ejecución) vive fuera de los commits (p. ej. caché de Actions; DRT). Si se pierde: contadores en 0, mejor opción reconstruida desde el historial sin alerta, alertas pendientes perdidas. No hay commit de latido en v1. | Sección 9, RF-24, RNF-06, R-04, R-05, R-07 |
| S-26 | Solo las series elegibles (válidas) entran en mejor opción, veredicto y resaltados; series fallidas, "sin datos", sin stock o cerradas se excluyen. Los cambios de mejor opción por entrada/salida de series elegibles o por cambio de `r`/`s`/configuración no alertan. | RF-21, RF-22, RF-17, RF-15 |
| S-27 | ~~Mercado Libre vía MejoresCompras: solo precio, catálogo, consulta diaria.~~ **Reemplazado por S-35** (no viable desde Actions). | RF-04, sección 12 |
| S-28 | La lista de tiendas de RF-04 puede reducirse tras el spike de R-01 o por RNF-07, con decisión documentada; el criterio se evalúa contra la lista vigente. | RF-04, R-01 |
| S-29 | Las tiendas se miden en paralelo entre sí, de modo que el peor caso (≈ 5 min + sitio) entre en el timeout de 10 min por ejecución. Sin presupuesto mensual de minutos (repo público). | RNF-01, RNF-12 |
| S-30 | Gráfico de línea escalonada hasta la última medición válida; desactualizado > 12 h (el umbral de 36 h para Mercado Libre queda sin efecto, S-35). | RF-17 |
| S-31 | Alcance de reglas: bajas mínimas sobre contado y total T de cada serie (no VP); `precio_objetivo` según `aplica_a`; reemplazo por producto por regla; `no` explícito desactiva la regla; sin claves = baja estricta; claves todas desactivadas = silencio. | RF-22 |
| S-32 | Contador de fallas por tienda y serie; "sin stock", vendedor con precio 0 y "sin oferta" no cuentan como falla (la parte de "no disponible en catálogo" y del contador de Mercado Libre queda sin efecto, S-35); un bloqueo 403 sí cuenta. | RF-15, RN-06, RF-04 |
| S-35 | Mercado Libre vía MejoresCompras **no es viable desde GitHub Actions** (403 Cloudflare, spike 2026-11-22) y no integra el conjunto medido de v1; no se evade el bloqueo ni se resuelven captchas. Reemplaza S-27 y S-17 y deja sin efecto la parte específica de ML de S-30 y S-32. Cualquier tienda bloqueada se comporta igual: "sin datos" sin hacer fallar la ejecución. | RF-04, RF-07, RF-15, RNF-07, RNF-10, RNF-12, R-01, R-02 |
| S-36 | Conjunto medido de v1 (lista vigente): On City, Cetrogar, Carrefour, Naldo (provisional) y Megatone (solo URL directa). Frávega, Rodo, Musimundo y Mercado Libre pasan a candidatas fuera del conjunto (con su motivo, sección 3). Las URLs por tienda se dan en la configuración; no hay búsqueda por nombre. | RF-04, RF-05, RF-19, secciones 2.2 y 3 |
| S-37 | Contado desde fuentes anónimas: la simulación de checkout de VTEX (código postal 5000) muestra que todos los medios de pago suman el precio publicado, por lo que contado = precio publicado con condición {medio de pago único identificado, 0 %}; el modelo admite `descuento_pct` > 0 si una tienda lo expone. Si la simulación no está disponible pero el precio publicado sí, se usa el precio publicado con condición {ninguno} (no se marca fallida: el hallazgo es que el contado coincide con el publicado). Efectivo/transferencia reales en tienda física u otras condiciones no se modelan. | RF-20, RF-21, RN-10, RN-14 |
| S-38 | Carrefour devuelve dos vendedores: se descartan los de precio 0 o sin stock; si quedan varios con stock, se toma el de menor precio publicado de la misma tienda (criterio provisional, validar en el DRT). | RF-04, RN-06 |
| S-39 | Megatone: adaptador solo por URL directa de producto (JSON-LD); sin búsqueda; solo lista/contado (sin tarjetas). | RF-04, RF-03 |
| S-40 | Naldo permanece en la lista vigente como **provisional**: la API VTEX funciona pero el 75T6C no figura en su catálogo; se valida con otro producto antes de construir el adaptador; si no se valida, se retira (S-28). | RF-04 |
| S-33 | Por encima de 50 MB el sistema sigue registrando (límite blando); a 100 MB deja de persistir puntos. Al quitar un producto de la configuración, su historial y estado salen de los archivos activos en el siguiente relevamiento; si vuelve, series nuevas sin alerta. No hay indicador "activa" por URL. | RNF-13, RF-07, sección 9, RN-12 |
| S-34 | La condición del contado es dato estructurado (medio + %), no texto traducido. | RF-20, RNF-03 |

### 15.2 Preguntas abiertas para el DRT

1. Formato del archivo de configuración (YAML/JSON) y esquema de validación; dónde se ejecuta la validación (CI en PR y en el workflow) y mensajes de error (RF-19).
2. Almacenamiento del historial en el repo: estructura de archivos, estrategia de commit (rama, bot, conflictos con ediciones manuales de la configuración), retención y compactación (RF-24, RNF-13).
3. Fuente de inflación: disponibilidad y formato del REM del BCRA (API o archivo), tasa constante vs vector mensual, valor manual de respaldo (RF-21).
4. Telegram vs email (o ambos): elección final, límites, secretos necesarios, formato y escape seguro del mensaje (RF-23).
5. Mitigación del bloqueo de runners de GitHub Actions (R-01): spike por tienda, endpoints JSON, reintentos, respaldo manual, tiendas a descartar (RF-04, S-28).
6. Contrato de adaptadores de tienda: cómo extraen lista, contado con condición estructurada, cuotas por tarjeta y stock; pruebas con fixtures; distinguir descuentos genéricos de promos bancarias (RF-05, RF-14, RF-20, RN-14).
7. (Reemplazada en v0.4) Fuente alternativa para Mercado Libre: API oficial de Mercado Libre (**no verificada**), carga manual de precios o runner propio/de otra IP (rompe el costo cero serverless); MejoresCompras queda descartado desde Actions (S-35).
8. Revisión de ToS/robots de cada tienda (RNF-07).
9. Cálculo del veredicto: dónde se ejecuta (en el relevamiento o en el sitio), precisión numérica y pruebas con el ejemplo de RF-21.
10. Generación del sitio estático (datos embebidos, gráfico escalonado accesible con tabla alternativa) y estrategia de i18n es-AR/en para UI y mensajes (RF-17, RNF-03, RNF-08).
11. Mecanismo del estado de ejecución no versionado (caché de Actions u otro), publicación del sitio sin commit, creación/deduplicación de issues `cuotear-ops`, y gestión de la cuota de minutos y de la suspensión del cron por inactividad (S-25, RNF-15, R-04).
12. Alineación documental: `CLAUDE.md` ya indica 10 productos (coherente); revisar si README/README.es.md mencionan multiusuario, OAuth o email como único canal y actualizarlos (acción pendiente, fuera de este documento). La licencia MIT ya está decidida (no es punto abierto).
13. Valores configurables finales: N = 4, 6 h, `s`, umbrales por defecto, 12 meses, 12 h de desactualizado, límites de tamaño.
14. Simulación de checkout de VTEX como fuente del contado (`POST /api/checkout/pub/orderForms/simulation`, código postal 5000): estabilidad, necesidad del código postal, identificación del medio de pago único y comportamiento si falla (RF-20, S-37).
15. Selección de vendedor en Carrefour (dos vendedores, uno con precio 0 / sin stock): criterio definitivo y pruebas con fixtures (S-38).
16. Adaptador de Megatone solo por URL directa con JSON-LD: contrato, validación de URLs y comportamiento ante 404 de búsqueda (S-39).
17. Validación de Naldo con otro producto (el 75T6C no está en su catálogo) antes de construir el adaptador; decisión de retirarlo si no se valida (S-40).
18. Fuente alternativa para Mercado Libre y para las demás candidatas (Frávega, Rodo, Musimundo): API oficial de Mercado Libre (no verificada), carga manual, runner propio/de otra IP (rompe RNF-01), o reevaluar el acceso más adelante (S-35, S-36).
