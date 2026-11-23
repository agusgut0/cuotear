import { looksLikeSecret } from './secrets.js';
import { formatPath } from './source.js';

/**
 * @typedef {import('./source.js').Path} Path
 * @typedef {{ path: Path, atKey: boolean, message: string }} SemanticIssue
 * @typedef {readonly import('../stores/index.js').StoreRegistration[]} Registry
 */

/**
 * Walks every value of the configuration looking for secret-shaped strings
 * (secret-named keys are already rejected by the schema).
 * @param {unknown} value
 * @param {Path} path
 * @returns {SemanticIssue[]}
 */
function findSecrets(value, path) {
  if (typeof value === 'string') {
    return looksLikeSecret(value)
      ? [{ path, atKey: false, message: 'el valor parece un secreto o un correo electrónico; no se admiten en la configuración' }]
      : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findSecrets(item, [...path, index]));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => findSecrets(item, [...path, key]));
  }
  return [];
}

/**
 * Checks one store URL against its adapter; returns the canonical URL or an issue message.
 * @param {string} raw
 * @param {import('../stores/index.js').StoreRegistration} adapter
 * @returns {{ canonical: string } | { error: string }}
 */
function checkUrl(raw, adapter) {
  /** @type {URL} */
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { error: 'URL malformada' };
  }
  if (url.protocol !== 'https:') return { error: 'la URL debe usar https' };
  if (url.username !== '' || url.password !== '') return { error: 'la URL no puede incluir usuario ni contraseña' };
  if (url.port !== '') return { error: 'la URL no puede incluir un puerto' };
  if (!adapter.hosts.includes(url.hostname)) {
    return { error: `dominio no permitido para ${adapter.displayName} (permitido: ${adapter.hosts.join(', ')})` };
  }
  const result = adapter.validateUrl(url);
  return result.ok ? { canonical: result.canonical } : { error: result.reason };
}

/**
 * @param {import('./types.js').AlertRules | undefined} rules
 * @param {Path} path
 * @returns {SemanticIssue[]}
 */
function ruleWarnings(rules, path) {
  if (rules?.aplica_a !== undefined && rules.precio_objetivo === undefined) {
    return [{ path: [...path, 'aplica_a'], atKey: true, message: '"aplica_a" no tiene efecto sin "precio_objetivo" en el mismo nivel' }];
  }
  return [];
}

/**
 * Validation that depends on the store-adapter registry and on cross-field
 * rules; runs only on a configuration that already passed the schema.
 * @param {import('./types.js').Config} config
 * @param {Registry} registry
 * @returns {{ errors: SemanticIssue[], warnings: SemanticIssue[] }}
 */
export function validateSemantics(config, registry) {
  /** @type {SemanticIssue[]} */
  const errors = [];
  /** @type {Map<string, number>} */
  const productIds = new Map();
  /** @type {Map<string, string>} */
  const canonicalUrls = new Map();

  config.productos.forEach((product, index) => {
    const base = ['productos', index];

    if (Object.hasOwn(Object.prototype, product.id)) {
      // Ids become keys of plain objects in the run state: these names would read or shadow Object.prototype.
      errors.push({
        path: [...base, 'id'],
        atKey: false,
        message: `id de producto reservado "${product.id}" (coincide con una propiedad interna de JavaScript; elegí otro id)`,
      });
    }

    const firstIndex = productIds.get(product.id);
    if (firstIndex === undefined) {
      productIds.set(product.id, index);
    } else {
      errors.push({
        path: [...base, 'id'],
        atKey: false,
        message: `id de producto duplicado "${product.id}" (ya usado en productos[${firstIndex}])`,
      });
    }

    for (const [storeId, rawUrl] of Object.entries(product.urls)) {
      const path = [...base, 'urls', storeId];
      const adapter = registry.find((store) => store.id === storeId);
      if (!adapter) {
        const allowed = registry.map((store) => store.id).join(', ');
        errors.push({ path, atKey: true, message: `tienda no permitida (vigentes: ${allowed})` });
        continue;
      }
      const checked = checkUrl(rawUrl, adapter);
      if ('error' in checked) {
        errors.push({ path, atKey: false, message: checked.error });
        continue;
      }
      const firstUse = canonicalUrls.get(checked.canonical);
      if (firstUse === undefined) {
        canonicalUrls.set(checked.canonical, formatPath(path));
      } else {
        errors.push({ path, atKey: false, message: `URL duplicada (ya usada en ${firstUse})` });
      }
    }
  });

  errors.push(...findSecrets(config, []));

  const warnings = [
    ...ruleWarnings(config.alertas?.reglas, ['alertas', 'reglas']),
    ...config.productos.flatMap((product, index) => ruleWarnings(product.reglas, ['productos', index, 'reglas'])),
  ];
  return { errors, warnings };
}
