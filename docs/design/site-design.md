# Diseño visual del sitio estático

Estado: propuesta para implementar. Alcance: `src/site/site.css` y el marcado de `views.js`, `pages.js`, `chart.js`. Respeta DRT 14 (HTML + un CSS, sin JS, sin fuentes ni CDN externos, CSP intacta) y ADR-0011. Referencias externas (21st.dev) no disponibles: el diseño es original.

## 1. Dirección visual

**"Boleta de comercio"**: papel cálido, tinta oscura, filetes finos y números grandes. Titulares y cifras clave en serif del sistema (identidad); el resto en sans del sistema (legibilidad). Un solo recurso gráfico: el **ticket** (tarjeta de papel, separador punteado tipo troquel entre veredicto y detalle).

- Personalidad: sobria, concreta, de "libro de cuentas". Encaja con un producto de decisión de plata para un usuario que mira rápido desde el celular.
- Jerarquía: 1) veredicto + mejor opción (hero con color semántico), 2) comparación por tienda (lista de ofertas, sin tablas en el flujo principal), 3) historial, 4) estado del sistema (pie compacto).
- Color con significado: verde = conviene cuotas, índigo = conviene contado, gris punteado = sin veredicto, ámbar = advertencia (desactualizado/falla), rojo = error. Nunca solo color: cada estado lleva texto.
- Los enlaces dejan de estar subrayados por defecto salvo en prosa; los enlaces de navegación se reconocen por contexto, peso y foco; los externos son "chips" con borde.

## 2. Tokens

Contrato con los tests: `contrast.test.js` lee solo tokens `--nombre: #rrggbb;` del primer bloque `:root` (claro) y del bloque que está entre `@media (prefers-color-scheme: dark)` y `*,` (oscuro). Mantener ese orden en el archivo, no usar anidado CSS ni `oklch()` para estos tokens (los tokens no hex, como sombras o tamaños, se ignoran). Mantener `:focus-visible { outline: 3px ... }` y `.chart { min-width: 36rem }` como reglas simples.

### 2.1 Color (hex; razón de contraste calculada con la fórmula WCAG)

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `--bg` | `#f7f4ec` | `#14130f` | fondo de página (papel / tinta) |
| `--surface` | `#fffdf8` | `#1d1b16` | tarjetas, gráfico |
| `--sunken` | `#efeadf` | `#0f0e0b` | pie, avisos, bloques hundidos |
| `--text` | `#1c1a15` | `#f1ede2` | texto |
| `--muted` | `#575145` | `#b5ae9e` | texto secundario |
| `--accent` | `#0b5a63` | `#6fd0d6` | enlaces, foco, marca (azul petróleo) |
| `--on-accent` | `#ffffff` | `#062a2d` | texto sobre relleno accent |
| `--border` | `#857d6e` | `#8c8574` | bordes de controles (3:1) |
| `--line` | `#d9d2c2` | `#37342b` | filetes decorativos (no portan información) |
| `--good` | `#0c6a3a` | `#7ddc9c` | conviene cuotas, mejor opción |
| `--good-bg` | `#dcf0e1` | `#16301f` | fondo de badge cuotas |
| `--on-good` | `#ffffff` | `#0b2415` | texto sobre relleno good |
| `--best-bg` | `#e3f1e6` | `#17301f` | fila "mejor opción" |
| `--contado` | `#2f3fa6` | `#aab4ff` | conviene contado |
| `--contado-bg` | `#e2e5f8` | `#222654` | fondo de badge contado |
| `--warn` | `#8a4a00` | `#f0b46a` | desactualizado, fallida, avisos |
| `--warn-bg` | `#fbe9cf` | `#3a2a10` | fondo de avisos y tags warn |
| `--bad` | `#a6261c` | `#ff9c92` | error (reservado: 404 / errores) |
| `--c0` | `#0b5a63` | `#6fd0d6` | serie 1 del gráfico |
| `--c1` | `#a6261c` | `#ff9c92` | serie 2 |
| `--c2` | `#2f3fa6` | `#aab4ff` | serie 3 |
| `--c3` | `#8a4a00` | `#f0b46a` | serie 4 |

Pares a agregar/mantener en `PAIRS` (mínimo; valores medidos claro / oscuro):

- 4.5:1 texto: `text/bg` 15.8/15.9, `text/surface` 17.1/14.7, `text/sunken` 14.5/16.5, `text/best-bg` 14.9/12.1, `muted/bg` 7.2/8.4, `muted/surface` 7.7/7.8, `muted/sunken` 6.6/8.7, `muted/best-bg` 6.7/6.4, `accent/bg` 7.2/10.3, `accent/surface` 7.8/9.6, `accent/sunken` (agregar), `good/bg` 6.1/11.1, `good/surface` 6.6/10.3, `good/good-bg` 5.6/8.5, `good/best-bg` 5.7/8.5, `contado/surface` 8.7/8.8, `contado/bg` 8.0/9.5, `contado/contado-bg` 7.1/7.3, `warn/bg` 6.2/10.1, `warn/surface` 6.8/9.4, `warn/warn-bg` 5.8/7.5, `warn/best-bg` 5.9/7.7, `warn/sunken` (agregar), `bad/bg` 6.6/9.2, `bad/surface` 7.1/8.5, `bad/best-bg` 6.2/7.1, `on-accent/accent` 7.9/8.5, `on-good/good` 6.7/9.9.
- 3:1 UI/gráficos: `border/bg` 3.7/5.1, `border/surface` 4.0/4.7, `accent/bg`, `c0..c3` sobre `bg` y `surface` (todos >= 6.2).
- `--line` no se testea: es decorativo; ninguna información depende de él (los controles usan `--border`).

### 2.2 Tipografía (solo pilas del sistema)

```css
--font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
--font-display: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
```

| Token | Valor | Uso |
|---|---|---|
| `--step--1` | `clamp(0.8125rem, 0.79rem + 0.1vw, 0.875rem)` | notas, pie, etiquetas |
| `--step-0` | `clamp(1rem, 0.96rem + 0.2vw, 1.0625rem)` | cuerpo |
| `--step-1` | `clamp(1.125rem, 1.05rem + 0.4vw, 1.3125rem)` | h3, precio de oferta |
| `--step-2` | `clamp(1.375rem, 1.2rem + 0.9vw, 1.75rem)` | h2, marca |
| `--step-3` | `clamp(1.75rem, 1.4rem + 1.8vw, 2.5rem)` | h1, cifra clave del hero |

- Cuerpo `line-height: 1.5`; titulares `1.15`; `font-variant-numeric: tabular-nums lining-nums` en `body`.
- Display (`--font-display`): marca, h1, h2 de producto, cifras del hero (`.figure-key`). Peso 700.
- Se pide `text-wrap: balance` en titulares y `pretty` en párrafos (ya existente).

### 2.3 Espaciado, radios, bordes, sombras

```css
--space-1: .25rem; --space-2: .5rem; --space-3: .75rem; --space-4: 1rem;
--space-5: 1.25rem; --space-6: 1.5rem; --space-8: 2rem; --space-12: 3rem;
--radius-s: .375rem; --radius: .75rem; --radius-pill: 999px;
--measure: 64rem;                 /* ancho de página (como hoy) */
--shadow: 0 1px 0 rgb(30 20 0 / .05), 0 8px 20px -12px rgb(60 40 0 / .25);   /* claro */
--shadow: none;                                                               /* oscuro: se usa borde */
--ring: 3px;
```

- Tarjetas: `1px solid var(--line)` + `--shadow`; en oscuro `border-color: var(--border)` queda para controles, la tarjeta usa `--line`.
- Separador "troquel": `border-block-start: 2px dashed var(--line)`.
- Objetivos táctiles: `min-block-size: 2.75rem` (44 px) en idioma y enlace de detalle; chips de tienda `2rem` (>= 24 px, WCAG 2.5.8).

## 3. Layout y componentes

Mobile first. Columna única hasta `48em`; contenedor `max-width: var(--measure)`, `padding-inline: var(--space-4)` (`--space-6` desde `48em`). Sin scroll horizontal a 320 px en la comparación principal.

### 3.1 Cabecera

- Estructura actual (`.brand`, `.updated`, `.lang`) se mantiene; `.updated` pasa a ser un `<p>` con el `<time>` (test lo exige) y el texto en `--step--1` `--muted`.
- Mobile: `display: grid; grid-template-areas: "brand lang" "updated updated"; align-items: center`. Desktop (`>= 48em`): una fila `brand | updated (centrado, flex 1) | lang`.
- Marca: `--font-display`, `--step-2`, `--text`, sin subrayado; marca gráfica CSS pura antes del texto: `.brand a::before` cuadrado `0.7em` redondeado con `linear-gradient(135deg, var(--good) 50%, var(--contado) 50%)` (cuotas / contado), decorativo, `content: ""`.
- Fondo `--surface`, `border-block-end: 1px solid var(--line)`.
- Idioma: control segmentado, `display: inline-flex; border: 1px solid var(--border); border-radius: var(--radius-pill); padding: 2px`. Cada ítem `min-block-size: 2.25rem; min-inline-size: 2.75rem; padding-inline: var(--space-3); display: grid; place-items: center; border-radius: var(--radius-pill)`. Actual (`[aria-current]`): relleno `--accent`, texto `--on-accent`, peso 700. Otro idioma: enlace `--text`, hover `--sunken`. Sin subrayado.

### 3.2 Tarjeta de producto en el inicio (hero de veredicto)

`<article class="product v-{cuotas|contado|none}">` (la misma clase en el detalle, ver 4). Los `.v-*` definen `--verdict` y `--verdict-bg`: cuotas = `--good`/`--good-bg`, contado = `--contado`/`--contado-bg`, none = `--muted`/`--sunken`.

Orden dentro de la tarjeta:

1. `h2` (nombre, `--font-display`, `--step-2`, enlace al detalle sin subrayado; subrayado en hover/foco).
2. **Hero** `.verdict` (fondo `--verdict-bg`, `border-inline-start: 6px solid var(--verdict)`, `border-radius: var(--radius)`, `padding: var(--space-4)`):
   - Fila 1: `.badge` del veredicto (ver 3.4) + tag "Diferencia marginal" si corresponde.
   - Fila 2: `.verdict-best` mejor opción en `--step-1`, peso 700: "Mastercard en On City" y debajo en `--step--1` `--muted` "18 cuotas sin interés".
   - Fila 3: `<dl class="figures">` con 3 cifras: Contado, Cuotas a valor presente, Diferencia. Mobile: grid de 3 columnas con `minmax(0,1fr)` (a 320 px caben: `--step-0` en `dd`), etiqueta `dt` en `--step--1` `--muted` arriba, valor `dd` abajo; si no entran, `repeat(auto-fit, minmax(8.5rem, 1fr))`. La cifra de Diferencia usa `--font-display`, `--step-2` en mobile y `--step-3` desde `48em`, color `--verdict`.
3. Separador troquel (`border-block-start: 2px dashed var(--line)` con `margin-block: var(--space-5)`).
4. Una sección por tienda (3.3).
5. Enlace "Ver detalle e historial": botón de borde (`display: inline-flex; min-block-size: 2.75rem; padding-inline: var(--space-4); border: 1px solid var(--accent); border-radius: var(--radius-pill); color: var(--accent); font-weight: 600; text-decoration: none`); hover relleno `--accent` con `--on-accent`. Se mantiene el `.sr-only` con el nombre.

Con varios productos (hasta 10): tarjetas apiladas con `gap: var(--space-6)`; desde `64em` no se cambia (una columna por legibilidad).

### 3.3 Comparación por tienda: lista de ofertas (reemplaza la tabla)

Decisión: las tablas por tienda se reemplazan por listas semánticas. Evita scroll horizontal y repetir columnas en mobile; el historial sigue siendo `<table>` (datos tabulares reales). Las regiones `.table-wrap` quedan solo para el historial.

Marcado de una tienda:

```html
<section class="store" aria-labelledby="store-tv-oncity">
  <h3 class="store-head"><span id="store-tv-oncity">On City</span> <a class="store-link" href=... rel="noopener noreferrer">Ver en On City</a></h3>
  <p class="store-meta note">Medido el 27/11/2026, 23:13</p>   <!-- nuevo, ver abajo -->
  <ul class="offers" aria-label="Precios en On City">          <!-- clave store.table -->
    <li class="offer is-best"> ... </li>
  </ul>
</section>
```

(Se conserva `<h[23]><span id=...>nombre</span> <a class="store-link"` por el test existente.)

Cada `<li class="offer">`:

```html
<li class="offer is-best">
  <p class="offer-head"><span class="offer-name">Mastercard</span>
     <span class="offer-flags"><strong class="best">Mejor opción</strong> <span class="badge badge-cuotas">Conviene cuotas</span></span></p>
  <p class="offer-price"><span class="offer-label">18 cuotas sin interés de</span> <strong class="price">$ 127.778</strong></p>
  <p class="note">Total $ 2.299.999</p>
  <!-- solo detalle --><dl class="figures figures-sm"><div><dt>Diferencia nominal</dt><dd>$ 0 <span class="note">0,00%</span></dd></div><div><dt>Valor presente</dt><dd>$ 1.834.040 <span class="note">-20,26%</span></dd></div></dl>
</li>
```

- Contado: mismo patrón; `offer-name` "Contado", `.price` el monto, `.note` la condición ("Pago único con débito, sin descuento adicional"). Sin badge de veredicto (el contado es la referencia): ya no se muestra "—"; solo aparece "Mejor opción" si es el mejor.
- Sin datos / sin stock: `<li class="offer is-empty">` con `offer-name` y `<span class="state">Sin datos</span>` en una sola línea compacta (texto `--muted`, sin cifras, fondo transparente). Mantiene la clase `state` (test existente). No se muestran columnas vacías con "—"; el patrón `aria-hidden="—" + sr-only "Sin comparación"` queda solo donde aún hay una cifra ausente dentro de una oferta con datos (p. ej. VP nulo en `figures-sm`, y en la tabla de historial).
- "Medido el …": se muestra una vez por tienda en `.store-meta` (fecha de la última medición válida más reciente de la tienda). Por oferta solo si su `lastValidAt` difiere de la de la tienda, o si está `fallida`/desactualizada (tags warn). Clave nueva no necesaria: se reusa `cell.measured`.
- Mejor opción: fondo `--best-bg`, `border-inline-start: 4px solid var(--good)`, y el texto "Mejor opción" como pill rellena (`background: var(--good); color: var(--on-good)`). Sigue siendo texto (1.4.1).
- Layout mobile (por defecto): `.offer` en bloque, `padding: var(--space-3) var(--space-4)`, separadas por `border-block-end: 1px solid var(--line)`; `.offer-head` es flex `justify-content: space-between; flex-wrap: wrap; gap: var(--space-2)`; `.offer-name` peso 700; precio con `.price` en `--step-1`, `font-family: var(--font-display)`. Contenedor `.offers`: `list-style: none; padding: 0; margin: 0; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); overflow: hidden`.
- Desktop (`>= 48em`): `.offer` pasa a grid `grid-template-columns: 9rem minmax(0,1.6fr) minmax(0,1fr)` (nombre | precio y nota | badge) y, en detalle, `figures-sm` ocupa una cuarta columna `minmax(0,1.4fr)` con las dos cifras en fila. Cada `dd` mantiene su `dt` visible (etiqueta pequeña) para no perder el encabezado de columna de la tabla.
- Tags: `state.stale` y `state.failed` usan `.tag-warn` (3.4). Se ubican bajo el precio.

### 3.4 Badges y estados

Todos: `display: inline-flex; align-items: center; min-block-size: 1.5rem; padding: 0 var(--space-3); border-radius: var(--radius-pill); font-size: var(--step--1); font-weight: 700; border: 1px solid currentcolor`.

| Estado | Clase | Texto (clave existente) | Color / fondo |
|---|---|---|---|
| Conviene cuotas | `.badge-cuotas` | `verdict.cuotas` | `--good` sobre `--good-bg` |
| Conviene contado | `.badge-contado` | `verdict.contado` | `--contado` sobre `--contado-bg` |
| Sin veredicto | `.badge-none`, `.badge-sin_veredicto` | `verdict.sin_veredicto` | `--muted` sobre `--sunken`, borde `dashed` |
| Diferencia marginal | `.tag` | `verdict.marginal` | `--muted` sobre `--sunken`, peso 500 |
| Desactualizado / medición fallida | `.tag-warn` | `state.stale` / `state.failed` | `--warn` sobre `--warn-bg` |
| Sin stock / sin datos | `.state` | `status.sin_stock` / `status.sin_datos` | `--muted`, cursiva, sin cifras |
| Mejor opción | `.best` | `tag.best` | relleno `--good` / `--on-good` |

- En el hero "Sin veredicto": `.v-none`, borde `dashed` y el motivo (`product.reason_rate` / `product.reason_data`) en `--step-0` `--muted`; sin la fila de cifras.
- Un badge nunca es interactivo (sin hover ni cursor).

### 3.5 Historial: gráfico y tabla

- `h2` historial; luego `<figure class="chart-card">` (`background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: var(--space-3)`) que contiene el `.chart-scroll` y el `<figcaption>`.
- `.chart-scroll`: `overflow-x: auto`, foco visible (tiene `tabindex="0"`). Se mantiene `.chart { min-width: 36rem }` por la decisión de accesibilidad de DRT 14.4: en mobile el gráfico se desplaza dentro de su región; la tabla y el resumen del `<desc>` son la alternativa.
- Gráfico: fondo transparente (lo da la tarjeta), grilla `--line` con `stroke-dasharray: 2 4`, etiquetas `--muted` 12 px, líneas `stroke-width: 2.5`, `stroke-linejoin: round`, marcadores con borde `--surface` de `2`. Los 4 estilos de trazo/marcador se mantienen (1.4.1).
- Leyenda: chips (`li` con `padding: var(--space-1) var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-pill); background: var(--bg)`), swatch igual al trazo.
- `<figcaption>`: `--step--1`, `--muted`, margen superior `--space-3`.
- Tabla del historial: se mantiene, dentro de `.table-wrap` con borde y radio (`border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface)`). Encabezado `thead th` `--step--1`, `--muted`, mayúsculas no (es-AR), fondo `--sunken`, `border-block-end: 1px solid var(--border)`. Filas con filete `--line`, sin zebra. Primera columna (`th scope="row"` con la fecha) `position: sticky; inset-inline-start: 0; background: var(--surface)` para no perder la fecha al desplazar en mobile. Cifras `.num` alineadas a la derecha, `tabular-nums`. `font-size: var(--step--1)` en mobile.
- Estado `chart.insufficient`: usa `.notice` (3.8).

### 3.6 Pie de página: bloque de estado compacto

Reemplaza los 7 párrafos sueltos por dos bloques:

```html
<footer class="site-footer">
  <ul class="status-list">
    <li class="is-ok">Última medición válida: ...</li>
    <li class="is-ok">Todas las tiendas respondieron ...</li>      <!-- is-warn si hay tiendas con falla -->
    <li>Última ejecución: ...</li>
    <li>Inflación mensual 2,50% (...)</li>
    <li>Disponibilidad ... (si existe)</li>
    <li class="is-ok">Sin avisos operativos abiertos.</li>          <!-- is-warn si hay avisos -->
  </ul>
  <p class="disclaimer">Todos los importes están en pesos argentinos (ARS). Los precios se obtienen ...</p>
</footer>
```

- Sin claves nuevas: el texto de cada línea ya existe. Currency + disclaimer se unen en un solo `<p>` (dos claves concatenadas con un espacio).
- Fondo `--sunken`, `border-block-start: 1px solid var(--line)`; contenido en el mismo contenedor (`max-width`), `padding-block: var(--space-6)`.
- `.status-list`: `list-style: none; display: grid; gap: var(--space-2) var(--space-6); grid-template-columns: 1fr` y `repeat(2, minmax(0,1fr))` desde `40em`; `font-size: var(--step--1)`; color `--muted`.
- Indicador: `li::before` de `0.6rem` con `margin-inline-end`; `.is-ok::before` círculo `--good`; `.is-warn::before` triángulo (`clip-path: polygon(50% 0, 100% 100%, 0 100%)`) `--warn`; sin clase: guion `--border`. Es decorativo (el texto dice el estado), por eso forma distinta además de color.
- `.disclaimer`: `--step--1`, `--muted`, `max-width: 60ch`, `margin-block-start: var(--space-5)`, `padding-block-start: var(--space-4)`, `border-block-start: 1px dashed var(--line)`.

### 3.7 Enlaces y foco

- Global: `a { color: var(--accent); text-decoration-thickness: .08em; text-underline-offset: .2em }`. Subrayado solo en enlaces dentro de párrafos de texto (`p a`, `.notice a`, `figcaption a`) y siempre en hover. Marca, `h2 a`, idioma, chips y botones: `text-decoration: none`; deben distinguirse por forma/peso (borde, relleno o titular), no solo color (1.4.1 / 1.4.11).
- Chip externo `.store-link`: `display: inline-flex; align-items: center; min-block-size: 2rem; padding: 0 var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-pill); font-size: var(--step--1); font-weight: 600; text-decoration: none; color: var(--accent); background: var(--surface)`; hover `border-color: var(--accent)`.
- Volver a la lista: `display: inline-flex; min-block-size: 2.75rem; align-items: center; gap: var(--space-2); font-weight: 600; text-decoration: none`, con el texto; sin glifos nuevos.
- Foco: se mantiene `:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }`; para controles con relleno (idioma actual, botones) `outline-offset: 3px` para no confundirse con el relleno. `main:focus { outline: none }` y `.skip` se mantienen (el skip pasa a pill rellena `--accent`/`--on-accent`).
- `:hover` nunca es el único indicio; `@media (prefers-reduced-motion: no-preference)` solo para `transition: background-color, border-color .15s` en enlaces y botones (ya existe el bloque de scroll suave).

### 3.8 Vacíos, avisos y errores

- `.notice` (sin historial suficiente, config de respaldo): `background: var(--warn-bg); color: var(--text); border: 1px solid var(--warn); border-inline-start-width: 6px; border-radius: var(--radius); padding: var(--space-3) var(--space-4)`. El borde `--warn` aporta el 3:1 y el texto sigue en `--text`.
- Inicio sin productos (`home.empty.*`): tarjeta `--surface` centrada con borde `dashed var(--border)`, `padding: var(--space-8)`, h1 y el texto con `<code>` ya incluido en la clave (el nombre del archivo irá en `font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace` si se envuelve en `<code>` en `pages.js`; opcional).
- 404: misma tarjeta centrada con h1 `--font-display` `--step-3` y enlace al inicio (ya existe el texto); `--bad` solo para un filete superior de 4 px.
- Estados de oferta: ver 3.3 (`is-empty`, tags warn). Sin spinners ni animación.

## 4. Cambios por archivo

### `src/site/site.css` (reescritura por capas, mismo archivo)
Orden: tokens (`:root` claro, luego `@media dark`; respetar el contrato de 2) → reset (`box-sizing`, `margin`) → base (`body`, tipos, enlaces, foco, `.skip`, `.sr-only`) → layout (`.site-header`, `main`, `.site-footer`) → componentes (`.product`, `.verdict`, `.figures`, `.badge/.tag/.state`, `.store`, `.offers/.offer`, `.notice`, `.chart-card/.chart/.legend`, `.table-wrap/table`, `.status-list`, `.disclaimer`) → media queries `min-width: 48em` (y `40em` para el pie) → `prefers-reduced-motion`. Eliminar reglas de `table` de tienda (`tr.is-best`, columnas). Mobile first: el CSS base es la vista de 320 px. Mantener `max-width: 64rem`. Sin anidado, sin `@layer` (los tests parsean por texto), sin `oklch`/`color-mix` (valores ya calculados).

### `src/site/pages.js`
- `layout()`: `<header>` sin cambio estructural (clases `brand`, `updated`, `lang` iguales). Pie: reemplazar los `<p>` por `<ul class="status-list">` + `<p class="disclaimer">`; las clases `is-ok`/`is-warn` según `failing`, `openNotices`; nota: `availability` solo si existe.
- `homePage()`: `<article class="product v-${verdict}">` (verdict de `view.comparison.verdict`, o `none` si `best === null`); el enlace final pasa a `class="button"`; envolver el estado vacío en `<section class="empty">`.
- `detailPage()`: envolver `h1` + headline + tiendas en `<article class="product product-detail v-...">`; el historial queda fuera, en su `<section>`; el enlace "Volver" con `class="back"`.
- `historySection()`: `<figure class="chart-card">`; tabla igual (mantener `<tr><th scope="row"><time ...>` por el test).

### `src/site/views.js`
- `headline()`: devolver `<div class="verdict">` con `badge`, tag marginal, `<p class="verdict-best">` (usa claves nuevas), y `<dl class="figures">` con las 3 cifras (reemplaza el `<br />` + `.note`). Rama sin veredicto: `<div class="verdict">` con badge `.badge-none` y el motivo.
- `storeTable()`: sustituir por `storeOffers()` que genera la lista de 3.3. Reutilizar `priceCell`/`noNumber`/`verdictCell`/`differenceCells` adaptando la salida a `<p>`/`<dl>` en lugar de `<td>`. Mantener `level`, `nameId`, `externalHref`, `conditionText`. Calcular la fecha de medición de tienda (máximo `lastValidAt` de sus registros) para `.store-meta` y mostrar `cell.measured` por oferta solo cuando difiere. `detail` agrega `figures-sm` por oferta (diferencia nominal y valor presente) con el patrón `—` + `sr-only` cuando falta la cifra.
- Mantener sin cambios: `isStale`, escape con `html`, solo enteros y enumeraciones.

### `src/site/chart.js`
- Sin cambios de lógica ni de geometría. Cambios menores: marcador con `r="4.5"`, y `<g class="grid">` con clase para el trazo punteado desde CSS (ya la tiene). Mantener `role="img"`, `<title>`, `<desc>`, `STYLE_COUNT = 4`.

### `src/i18n/es-AR.json` y `src/i18n/en.json` (mismas claves y marcadores en ambos)
Agregar:

| Clave | es-AR | en |
|---|---|---|
| `product.best.cuotas` | `{card} en {store}` | `{card} at {store}` |
| `product.best.contado` | `Contado en {store}` | `Cash at {store}` |
| `product.best.n` | `{n} cuotas sin interés` | `{n} interest-free installments` |
| `product.fig.cash` | `Contado` | `Cash` |
| `product.fig.pv` | `Cuotas a valor presente` | `Installments, present value` |
| `product.fig.dif` | `Diferencia` | `Difference` |
| `cell.installments_label` | `{n} cuotas sin interés de` | `{n} interest-free installments of` |

Retirar (queda sin uso): `product.headline.contado`, `product.headline.cuotas`, `product.compare`, `cell.installments`, `col.option`, `col.price`, `col.verdict` (las tablas de tienda desaparecen; `col.dif` y `col.vp` se reutilizan como `dt` de `figures-sm`). `store.table` se usa como `aria-label` de la lista de ofertas. Comprobar que `i18n-site.test.js` no exija claves sin uso.

### Tests (actualizar, no relajar el criterio)
- `test/site/contrast.test.js`: agregar los tokens nuevos y los pares de 2.1 (ambos esquemas); mantener el parseo por texto.
- `test/site/a11y-site.test.js`: el recorrido de `scrollers` exige `>= 1` por página; en el inicio ya no hay `.table-wrap`, así que aplicar esa aserción solo a las páginas de detalle (o contar `>= 0` en el inicio). Actualizar el test de la sección de tienda (`<h3><span id=...>` se conserva) y de celdas vacías (el patrón `—`+`sr-only` sigue en `figures-sm` e historial).
- `test/site/site.test.js`: `<tr class="is-best">` pasa a `<li class="offer is-best">`; `class="state">Sin datos` sigue igual (4 casos con Megatone).
- `html-validate`: las listas usan `<p>` dentro de `<li>`; `<dl>` solo con grupos `<div><dt><dd>`; sin cambios en `.htmlvalidate.json`.

## 5. Contenido y formato (es-AR / en)

- Moneda: `fmt.money` actual (`$ 2.299.999` en es-AR; `ARS 2,299,999` en en); sin decimales para precios; porcentajes con coma decimal en es-AR (`-20,26%`), signo siempre explícito en diferencias (`signedPercent`).
- Fechas: `27/11/2026, 23:13` (es-AR, hora de Argentina), `11/27/2026, 23:13` en en. No abreviar meses.
- "Cuotas sin interés" siempre completo; nunca "s/i" ni símbolos.
- Cifras clave: máximo 3 en el hero; el resto está en el detalle.

## 6. Checklist de aceptación para el desarrollador

1. A 320 px, sin scroll horizontal en inicio y detalle salvo el gráfico y la tabla del historial (regiones con foco).
2. Claro y oscuro con los pares de 2.1 pasando `npm test`.
3. Navegación con teclado: orden lógico, foco visible de 3 px en cada enlace/chip/región; el skip link sigue funcionando.
4. Cada veredicto, mejor opción, desactualizado y "sin datos" comunicados con texto, no solo color.
5. Zoom 200 % y 400 % sin pérdida de contenido; objetivos táctiles >= 24 px (44 px en idioma y botones).
6. Sin recursos externos: CSP actual intacta; sin `@import`, `url()` externos ni fuentes.
7. Revisar cada propiedad CSS nueva contra Baseline Widely available (usadas: grid, flex, custom properties, `clamp()`, `text-wrap` como mejora progresiva, `clip-path`, `position: sticky`, `inset-inline-*`).
