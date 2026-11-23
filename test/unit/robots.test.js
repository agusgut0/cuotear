import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isAllowed, matchesPattern, parseRobots } from '../../src/http/robots.js';

/** On City robots.txt rules relied on by the project (DRT 5.1), as verified on 2026-11-22. */
const ONCITY = `
User-agent: *
Disallow: /*checkout*
Disallow: /*?q=*
Disallow: /*test*
Disallow: /*prueba*
`;

describe('robots.txt parsing (RFC 9309)', () => {
  test('uses the cuotear group when present, otherwise the * group', () => {
    const text = 'User-agent: *\nDisallow: /a\n\nUser-agent: CuoTear\nDisallow: /b\n';
    assert.deepEqual(parseRobots(text), [{ allow: false, pattern: '/b' }]);
    assert.deepEqual(parseRobots('User-agent: *\nDisallow: /a\n'), [{ allow: false, pattern: '/a' }]);
    assert.deepEqual(parseRobots('User-agent: other\nDisallow: /a\n'), []);
  });

  test('merges consecutive User-agent lines and repeated groups for the same agent', () => {
    const text = 'User-agent: foo\nUser-agent: cuotear\nDisallow: /x\n\nUser-agent: cuotear\nAllow: /y\n';
    assert.deepEqual(parseRobots(text), [
      { allow: false, pattern: '/x' },
      { allow: true, pattern: '/y' },
    ]);
  });

  test('ignores comments, blank rules, unknown directives, rules before any group and CRLF/BOM', () => {
    const text = String.fromCharCode(0xfeff) + 'Disallow: /before\r\nUser-agent: * # everyone\r\nDisallow:\r\nSitemap: https://x/s.xml\r\nDisallow: /p # private\r\n';
    assert.deepEqual(parseRobots(text), [{ allow: false, pattern: '/p' }]);
  });
});

describe('robots.txt matching', () => {
  test('prefix, * wildcard and $ anchor', () => {
    assert.equal(matchesPattern('/api/', '/api/catalog'), true);
    assert.equal(matchesPattern('/api/', '/apis'), false);
    assert.equal(matchesPattern('/*checkout*', '/api/checkout/pub/orderForms/simulation'), true);
    assert.equal(matchesPattern('/*.pdf$', '/files/a.pdf'), true);
    assert.equal(matchesPattern('/*.pdf$', '/files/a.pdf?x=1'), false);
    assert.equal(matchesPattern('/exact$', '/exact'), true);
    assert.equal(matchesPattern('/exact$', '/exact/more'), false);
    assert.equal(matchesPattern('/a*b*c', '/a-b-c'), true);
    assert.equal(matchesPattern('/a*b*c', '/a-c-b'), false);
  });

  test('the longest matching rule wins and a tie goes to Allow', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /shop\nAllow: /shop/public\nDisallow: /tie\nAllow: /tie\n');
    assert.equal(isAllowed(rules, '/shop/private'), false);
    assert.equal(isAllowed(rules, '/shop/public/item'), true);
    assert.equal(isAllowed(rules, '/tie'), true);
    assert.equal(isAllowed(rules, '/other'), true);
  });

  test('a pathological wildcard pattern is evaluated without backtracking', () => {
    const started = Date.now();
    assert.equal(matchesPattern('/*a*a*a*a*a*a*a*a*a*a*a*a*a*a*b', `/${'a'.repeat(5000)}`), false);
    assert.ok(Date.now() - started < 1000);
  });

  test('On City: catalog API is allowed, checkout simulation and search/test paths are not', () => {
    const rules = parseRobots(ONCITY);
    assert.equal(isAllowed(rules, '/api/catalog_system/pub/products/search/smart-tv-tcl-75/p'), true);
    assert.equal(isAllowed(rules, '/api/catalog_system/pub/products/search?ft=75t6c'), true);
    assert.equal(isAllowed(rules, '/api/checkout/pub/orderForms/simulation'), false);
    assert.equal(isAllowed(rules, '/api/catalog_system/pub/products/search/mi-test-tv/p'), false);
    assert.equal(isAllowed(rules, '/busqueda?q=tv'), false);
  });
});
