# ADR-0008: Alertas por Telegram Bot API con HTTP directo; email diferido

- Estado: Aceptado
- Fecha: 2026-11-22
- Requisitos: RF-01, RF-23, RN-01, RNF-11, RNF-14, S-11 · DAF Q-4 · DRT sección 13.5

## Contexto

RF-23 pide Telegram y/o email desde GitHub Actions, mensaje agrupado y dividido si excede el límite, reintento sin duplicados, secretos solo en Actions y aviso operativo si faltan. S-11 propone Telegram como principal.

## Decisión

- Telegram como **único canal implementado en v1**, vía `fetch` a `https://api.telegram.org/bot<token>/sendMessage` (sin librería).
- Secretos `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` solo en el paso `notify.js`; nunca se registran la URL ni el cuerpo de la petición.
- `parse_mode: HTML`, escape de `& < > "` en todo texto variable, solo etiquetas `<b>`, `<i>`, `<a href>` con URLs validadas; vista previa de enlaces desactivada. Ningún texto de tiendas entra al mensaje.
- Partición en ≤ 3.800 caracteres en límites de alerta (límite oficial 4.096), envío en serie con ≥ 1,1 s entre mensajes (FAQ: 1 msg/s por chat), respeto de `retry_after` ante 429.
- Idempotencia con `alertId` (hash de producto, serie, punto previo, valores, reglas) y `sentAlertIds` en el estado (14 días); pendientes reintentados hasta 48 h.
- Secreto faltante o 401 ⇒ sin envío, aviso `secretos-canal`.
- Email: **diferido** (disparador: pedido del dueño o Telegram inutilizable); cuando se haga, `nodemailer` + SMTP con credenciales en secretos.

## Consecuencias

- Cero dependencias para alertas; entrega casi instantánea y gratuita.
- Entrega "al menos una vez": un timeout tras la aceptación puede duplicar un mensaje (aceptado).
- RF-23 queda cumplido por la rama "Telegram"; el email figura como brecha parcial en la trazabilidad.

## Alternativas consideradas

- **Librería de bots (Telegraf, node-telegram-bot-api):** dependencias para una sola llamada HTTP.
- **Acción de terceros para Telegram/email:** recibiría el token; riesgo de cadena de suministro.
- **Email como principal:** requiere SMTP o proveedor con dominio, más secretos y entregabilidad incierta.
- **MarkdownV2:** escape más complejo (muchos caracteres reservados) que HTML.
