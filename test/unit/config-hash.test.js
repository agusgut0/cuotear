import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';
import { canonicalJson, productConfigHash } from '../../src/pipeline/config-hash.js';

/** @param {string} text */
const sha = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`;

describe('Q5: canonical serialization of a product (DRT 13.2)', () => {
  const product = { id: 'tv', nombre: 'Smart TV', urls: { oncity: 'https://www.oncity.com/a/p', megatone: 'https://www.megatone.net/b/p' }, reglas: { baja_minima_pct: 5, cambio_mejor_opcion: true } };
  const reordered = { reglas: { cambio_mejor_opcion: true, baja_minima_pct: 5 }, urls: { megatone: 'https://www.megatone.net/b/p', oncity: 'https://www.oncity.com/a/p' }, nombre: 'Smart TV', id: 'tv' };

  test('the text has sorted keys at every depth', () => {
    assert.equal(
      canonicalJson(product),
      '{"id":"tv","nombre":"Smart TV","reglas":{"baja_minima_pct":5,"cambio_mejor_opcion":true},"urls":{"megatone":"https://www.megatone.net/b/p","oncity":"https://www.oncity.com/a/p"}}',
    );
  });

  test('reordering keys, in any object, does not change the hash', () => {
    assert.equal(productConfigHash(reordered), productConfigHash(product));
  });

  test('the hash is the sha256 of the canonical text', () => {
    assert.equal(productConfigHash(product), sha('{"id":"tv","nombre":"Smart TV","reglas":{"baja_minima_pct":5,"cambio_mejor_opcion":true},"urls":{"megatone":"https://www.megatone.net/b/p","oncity":"https://www.oncity.com/a/p"}}'));
    assert.match(productConfigHash(product), /^sha256:[0-9a-f]{64}$/);
  });

  test('a change of value, of a URL or of the order of an array changes the hash', () => {
    assert.notEqual(productConfigHash({ ...product, nombre: 'Televisor' }), productConfigHash(product));
    assert.notEqual(productConfigHash({ ...product, urls: { oncity: 'https://www.oncity.com/other/p' } }), productConfigHash(product));
    assert.notEqual(canonicalJson({ list: [1, 2] }), canonicalJson({ list: [2, 1] }));
  });

  test('a key named __proto__ is kept as data and serialized in order', () => {
    const parsed = JSON.parse('{"b":1,"__proto__":{"x":1},"a":2}');
    assert.equal(canonicalJson(parsed), '{"__proto__":{"x":1},"a":2,"b":1}');
  });

  test('null, numbers and nested arrays of objects are handled', () => {
    assert.equal(canonicalJson({ b: null, a: [{ z: 1, y: 2 }] }), '{"a":[{"y":2,"z":1}],"b":null}');
  });
});
