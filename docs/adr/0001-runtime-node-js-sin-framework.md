# ADR-0001: Node.js 24 LTS, JavaScript ESM sin framework y dependencias mínimas

- Estado: Aceptado
- Fecha: 2026-11-22
- Requisitos: RNF-01, RNF-11, RN-01, RF-05 · DRT sección 2

## Contexto

cuotear corre en GitHub Actions (medición, motor, generación del sitio) y publica un sitio estático. El spike de acceso a tiendas ya es un script Node sin dependencias que funcionó en el runner `ubuntu-24.04` con Node 22. El proyecto es personal, de costo cero y con superficie de ataque mínima: cada dependencia es riesgo de cadena de suministro.

## Decisión

- Node.js **24 LTS** (`.nvmrc`, `engines: ">=24 <25"`), JavaScript ESM con tipos JSDoc verificados por `tsc --noEmit` (`checkJs`). Sin framework.
- Librería estándar para HTTP (`fetch`), tests (`node:test`), hashing (`node:crypto`), fechas y números (`Intl`).
- Dependencias de ejecución: solo `yaml` y `ajv` (tope de 3 directas). Desarrollo: `eslint`, `@eslint/js`, `globals`, `typescript`, `html-validate`.
- Postura de cadena de suministro: lockfile commiteado, `npm ci --ignore-scripts`, Dependabot semanal (npm y github-actions), acciones solo de la organización `actions/` fijadas por SHA completo, `npm audit --omit=dev` en CI, secret scanning y push protection.

## Consecuencias

- Un solo lenguaje para todo (medición, motor, sitio, tests); continuidad con el spike.
- Sin paso de build: el código que se revisa es el que corre.
- Hay que escribir a mano utilidades pequeñas (escape HTML, parser de robots.txt, cola por host) con tests.
- Migración a Node 26 LTS antes de 2028-01 (fin de vida esperado de Node 24: 2028-04-30, no verificado en `schedule.json`).

## Alternativas consideradas

- **Python:** buen soporte de scraping, pero un segundo ecosistema si el sitio necesita JS y sin ventaja en el runner.
- **TypeScript compilado:** tipos más fuertes a cambio de un paso de build; JSDoc + `tsc --noEmit` da el chequeo sin transpilar.
- **Deno/Bun:** menos "aburridos" en Actions y en el ecosistema de acciones.
- **Generadores de sitios (Astro, Eleventy):** decenas de dependencias transitivas para dos plantillas (ver ADR-0011).
