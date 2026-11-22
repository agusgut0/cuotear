import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { formatIssue, validateConfig, validateConfigFile } from '../../src/config/validate.js';
import { checkVtexProductUrl } from '../../src/stores/url.js';

/** @param {number} i */
const productYaml = (i) => `  - id: producto-${i}
    nombre: Producto ${i}
    urls:
      oncity: https://www.oncity.com/producto-${i}/p
`;

/**
 * @param {number} count
 * @param {string} [extraTopLevel] YAML placed before `productos`
 */
const configWith = (count, extraTopLevel = '') =>
  `version: 1\n${extraTopLevel}productos:\n${Array.from({ length: count }, (_, i) => productYaml(i + 1)).join('')}`;

/** @param {string} yaml */
const errorsOf = (yaml) => validateConfig(yaml).errors;

/** @param {string} yaml @param {RegExp} message */
function assertFails(yaml, message) {
  const result = validateConfig(yaml);
  assert.equal(result.ok, false);
  assert.equal(result.config, null);
  assert.ok(
    result.errors.some((error) => message.test(error.message)),
    `expected an error matching ${message}, got: ${result.errors.map(formatIssue).join(' | ')}`,
  );
}

/** @param {string} id */
const fakeStore = (id) => ({
  id,
  displayName: id,
  hosts: [`www.${id}.com`],
  status: /** @type {const} */ ('vigente'),
  validateUrl: checkVtexProductUrl,
});

describe('RF-19: base configuration', () => {
  test('the example config in the repo is valid', () => {
    const result = validateConfigFile('config/cuotear.yaml');
    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
    assert.equal(result.config?.productos[0]?.id, 'tcl-75t6c');
  });

  test('a minimal config (empty product list) is valid', () => {
    assert.equal(validateConfig('version: 1\nproductos: []\n').ok, true);
  });

  test('unknown field fails and points at the field', () => {
    const [error] = errorsOf('version: 1\nfoo: 1\nproductos: []\n');
    assert.equal(error?.message, 'campo desconocido "foo"');
    assert.deepEqual([error?.line, error?.column, error?.path], [2, 1, 'foo']);
  });

  test('missing required field fails', () => {
    assertFails('version: 1\n', /falta el campo obligatorio "productos"/);
    assertFails(configWith(1).replace('    nombre: Producto 1\n', ''), /falta el campo obligatorio "nombre"/);
  });

  test('wrong version fails', () => {
    assertFails('version: 2\nproductos: []\n', /el valor debe ser 1/);
  });

  test('YAML syntax errors are reported with position', () => {
    const result = validateConfig('version: 1\nproductos: [\n');
    assert.equal(result.ok, false);
    assert.match(result.errors[0]?.message ?? '', /^YAML inválido/);
    assert.equal(result.errors[0]?.line, 3);
  });

  test('error messages are formatted as file:line:column path: message', () => {
    const yaml = 'version: 1\nproductos:\n  - id: a\n    nombre: A\n    urls:\n      fravega: https://www.fravega.com/x/p\n';
    const [error] = errorsOf(yaml);
    assert.equal(
      error && formatIssue(error),
      'config/cuotear.yaml:6:7 productos[0].urls.fravega: tienda no permitida (vigentes: oncity)',
    );
  });
});

describe('RF-02: product limit', () => {
  test('exactly 10 products is valid', () => {
    assert.equal(validateConfig(configWith(10)).ok, true);
  });

  test('11 products fails and states the limit', () => {
    const result = validateConfig(configWith(11));
    assert.equal(result.ok, false);
    assert.equal(result.errors[0]?.message, 'máximo 10 productos (hay 11)');
    assert.equal(result.errors[0]?.path, 'productos');
  });

  test('a product with one URL per store of the registry counts as 1 product', () => {
    const ids = ['oncity', 'carrefour', 'naldo', 'megatone', 'cetrogar'];
    const urls = ids.map((id) => `      ${id}: https://www.${id}.com/producto-1/p\n`).join('');
    const yaml = `version: 1\nproductos:\n  - id: p1\n    nombre: P1\n    urls:\n${urls}`;
    const result = validateConfig(yaml, { registry: ids.map(fakeStore) });
    assert.deepEqual(result.errors, []);
    assert.equal(result.config?.productos.length, 1);
  });
});

describe('RF-19: URLs and stores', () => {
  test('the same URL repeated across products fails', () => {
    const yaml = configWith(2).replace('producto-2/p', 'producto-1/p');
    assertFails(yaml, /URL duplicada \(ya usada en productos\[0\]\.urls\.oncity\)/);
  });

  test('the same URL repeated with a trailing slash or fragment still fails', () => {
    const yaml = configWith(2).replace('producto-2/p', 'producto-1/p/#top');
    assertFails(yaml, /URL duplicada/);
  });

  test('more than one URL of the same store in a product fails (duplicate key)', () => {
    const yaml = `version: 1
productos:
  - id: p1
    nombre: P1
    urls:
      oncity: https://www.oncity.com/uno/p
      oncity: https://www.oncity.com/dos/p
`;
    const result = validateConfig(yaml);
    assert.equal(result.ok, false);
    assert.match(result.errors[0]?.message ?? '', /clave duplicada/);
    assert.equal(result.errors[0]?.line, 7);
  });

  test('a list of URLs for one store fails', () => {
    const yaml = configWith(1).replace(
      'oncity: https://www.oncity.com/producto-1/p',
      'oncity: [https://www.oncity.com/a/p, https://www.oncity.com/b/p]',
    );
    assertFails(yaml, /debe ser un texto/);
  });

  test('a store that is not in the registry fails', () => {
    assertFails(configWith(1).replace('oncity:', 'fravega:'), /tienda no permitida \(vigentes: oncity\)/);
  });

  test('a domain that is not in the adapter allowlist fails', () => {
    assertFails(
      configWith(1).replace('www.oncity.com', 'www.fravega.com'),
      /dominio no permitido para On City \(permitido: www\.oncity\.com\)/,
    );
    assertFails(configWith(1).replace('www.oncity.com', 'oncity.com.evil.example'), /dominio no permitido/);
    assertFails(configWith(1).replace('www.oncity.com', '127.0.0.1'), /dominio no permitido/);
  });

  test('malformed, non-https, credentialed and ported URLs fail', () => {
    assertFails(configWith(1).replace('https://www.oncity.com/producto-1/p', 'https://www.onc ity.com/p/p'), /URL malformada/);
    assertFails(configWith(1).replace('https://', 'http://'), /formato inválido/);
    assertFails(configWith(1).replace('https://', 'https://user:pw@'), /usuario ni contraseña/);
    assertFails(configWith(1).replace('oncity.com', 'oncity.com:8443'), /puerto/);
  });

  test('search URLs and non-product paths fail', () => {
    assertFails(configWith(1).replace('producto-1/p', 'p/p?q=tv'), /búsqueda/);
    assertFails(configWith(1).replace('producto-1/p', 'busca/tv'), /ficha de producto/);
  });

  test('duplicate product ids fail', () => {
    assertFails(configWith(2).replace('id: producto-2', 'id: producto-1'), /id de producto duplicado "producto-1"/);
  });

  test('invalid product ids fail', () => {
    assertFails(configWith(1).replace('id: producto-1', 'id: Producto_1'), /formato inválido/);
  });
});

describe('RF-19: comparison parameters', () => {
  /** @param {number|string} pct @param {'mensual'|'anual'} [periodo] */
  const manual = (pct, periodo = 'mensual') =>
    configWith(1, `comparacion:\n  inflacion:\n    fuente: manual\n    manual:\n      periodo: ${periodo}\n      pct: ${pct}\n`);

  test('manual inflation r < 0 fails, r = 0 passes', () => {
    assertFails(manual(-0.5), /debe ser mayor o igual que 0/);
    assertFails(manual(-1, 'anual'), /debe ser mayor o igual que 0/);
    assert.equal(validateConfig(manual(0)).ok, true);
    assert.equal(validateConfig(manual(2.5)).ok, true);
  });

  test('manual source without a manual block fails', () => {
    assertFails(configWith(1, 'comparacion:\n  inflacion:\n    fuente: manual\n'), /falta el campo obligatorio "manual"/);
  });

  test('s = 0 and s = 1 pass; anything else fails', () => {
    for (const s of [0, 1]) assert.equal(validateConfig(configWith(1, `comparacion:\n  s: ${s}\n`)).ok, true);
    for (const s of [2, -1, 0.5, '"1"']) {
      assertFails(configWith(1, `comparacion:\n  s: ${s}\n`), /valor no permitido \(valores válidos: 0, 1\)/);
    }
  });
});

describe('RF-19: alert rules', () => {
  /** @param {string} lines lines under `alertas.reglas` */
  const rules = (lines) => configWith(1, `alertas:\n  reglas:\n${lines}`);

  test('valid rules pass, including disabled rules (false and "no")', () => {
    const yaml = rules(
      '    baja_minima_pct: 5\n    baja_minima_monto: 10000\n    precio_objetivo: 2000000\n    aplica_a: mejor_vp\n    cambio_mejor_opcion: true\n',
    );
    assert.deepEqual(errorsOf(yaml), []);
    const disabled = rules('    baja_minima_pct: false\n    baja_minima_monto: "no"\n    precio_objetivo: no\n');
    assert.equal(validateConfig(disabled).ok, true);
  });

  test('invalid values fail', () => {
    for (const bad of [
      '    baja_minima_pct: 0\n',
      '    baja_minima_pct: -5\n',
      '    baja_minima_pct: 101\n',
      '    baja_minima_pct: abc\n',
      '    baja_minima_pct: true\n',
      '    baja_minima_monto: -1\n',
      '    precio_objetivo: 0\n',
    ]) {
      assertFails(rules(bad), /valor inválido: se esperaba un número positivo, false o "no"/);
    }
    assertFails(rules('    aplica_a: otro\n'), /valor no permitido \(valores válidos: contado, total_cuotas, mejor_vp\)/);
    assertFails(rules('    cambio_mejor_opcion: si\n'), /debe ser verdadero o falso/);
    assertFails(rules('    baja_minima_porcentaje: 5\n'), /campo desconocido "baja_minima_porcentaje"/);
  });

  test('oneOf branch noise is collapsed into one error per bad value', () => {
    assert.equal(errorsOf(rules('    baja_minima_pct: -5\n')).length, 1);
  });

  test('per-product rules are validated too', () => {
    const yaml = configWith(1).replace('    urls:', '    reglas:\n      baja_minima_pct: 500\n    urls:');
    assertFails(yaml, /valor inválido/);
  });

  test('aplica_a without precio_objetivo at the same level is a warning, not an error', () => {
    const result = validateConfig(rules('    aplica_a: contado\n'));
    assert.equal(result.ok, true);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0]?.path, 'alertas.reglas.aplica_a');
  });

  test('channel and language are restricted', () => {
    assertFails(configWith(1, 'alertas:\n  canal: email\n'), /valor no permitido \(valores válidos: telegram, ninguno\)/);
    assertFails(configWith(1, 'alertas:\n  idioma: fr\n'), /valor no permitido/);
  });
});

describe('RF-19: no secrets in the configuration', () => {
  test('secret-named fields are rejected', () => {
    assertFails(configWith(1, 'alertas:\n  token: abc\n'), /el campo "token" no está permitido: los secretos no van en la configuración/);
    assertFails(configWith(1, 'alertas:\n  chat_id: 1\n'), /los secretos no van en la configuración/);
    assertFails(configWith(1, 'alertas:\n  smtp_password: x\n'), /los secretos no van en la configuración/);
  });

  test('token-shaped and email-shaped values are rejected', () => {
    const token = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw_x';
    assertFails(configWith(1).replace('Producto 1', token), /parece un secreto/);
    assertFails(configWith(1).replace('Producto 1', 'dueño@example.com'), /parece un secreto/);
  });
});
