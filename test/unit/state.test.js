import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { emptyState, isRunState } from '../../src/state/schema.js';
import { loadState, saveState } from '../../src/state/store.js';

/** @param {(path: string) => void} fn */
function withStateFile(fn) {
  const directory = mkdtempSync(join(tmpdir(), 'cuotear-state-'));
  try {
    fn(join(directory, '.state', 'state.json'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** @returns {import('../../src/state/schema.js').RunState} */
function fullState() {
  return {
    schemaVersion: 1,
    lastRunAt: '2026-11-22T12:17:41Z',
    lastValidConfig: { hash: `sha256:${'a'.repeat(64)}`, config: { version: 1, productos: [] } },
    series: { 'tcl-75t6c|oncity/visa:15': { failures: 2, lastValidAt: '2026-11-22T06:17:41Z' }, 'tcl-75t6c|oncity/contado': { failures: 0 } },
    eligible: { 'tcl-75t6c': ['oncity/contado', 'oncity/visa:15'] },
    prevBest: { 'tcl-75t6c': { tipo: 'cuotas', tienda: 'oncity', serie: 'mastercard:18', valorCents: 0, r: 0.0165 } },
    inflation: { fuente: 'manual', anualPct: 21.8, fecha: '2026-10-31', obtainedAt: '2026-11-22T12:17:41Z' },
    robots: { 'www.oncity.com': { fetchedAt: '2026-11-22T12:17:41Z', status: 200, rules: [{ allow: false, pattern: '/*checkout*' }] } },
    pendingAlerts: [{ id: 'x' }],
    sentAlertIds: [{ id: 'abc', at: '2026-11-22T12:17:41Z' }],
    ops: { lastCauses: ['robots:oncity'] },
  };
}

describe('run state (DRT 9, ADR-0004)', () => {
  test('the empty state is valid and has version 1', () => {
    assert.equal(isRunState(emptyState()), true);
    assert.equal(emptyState().schemaVersion, 1);
  });

  test('a full state round-trips through save and load', () => {
    withStateFile((path) => {
      saveState(fullState(), path);
      const loaded = loadState(path);
      assert.equal(loaded.rebuilt, false);
      assert.deepEqual(loaded.state, fullState());
      assert.equal(readFileSync(path, 'utf8').endsWith('\n'), true);
    });
  });

  test('saving creates the .state directory and refuses an invalid state', () => {
    withStateFile((path) => {
      saveState(emptyState(), path);
      assert.equal(loadState(path).rebuilt, false);
      assert.throws(() => saveState(/** @type {any} */ ({ schemaVersion: 1 }), path), TypeError);
    });
  });

  test('S-25: a missing state starts clean and says so', () => {
    withStateFile((path) => {
      const loaded = loadState(path);
      assert.equal(loaded.rebuilt, true);
      assert.equal(loaded.reason, 'missing');
      assert.deepEqual(loaded.state, emptyState());
      assert.match(loaded.notice ?? '', /^::notice::/);
    });
  });

  test('S-25: a rebuilt state has zero counters and no best-option memory', () => {
    withStateFile((path) => {
      const { state } = loadState(path);
      assert.deepEqual(state.series, {});
      assert.deepEqual(state.prevBest, {});
      assert.deepEqual(state.eligible, {});
      assert.deepEqual(state.pendingAlerts, []);
      assert.deepEqual(state.sentAlertIds, []);
      assert.equal(state.lastValidConfig, undefined);
      assert.deepEqual(state.robots, {});
    });
  });

  test('corruption is treated as a loss, never thrown: invalid JSON, wrong shape, unknown version, bad values', () => {
    /** @type {[string, string, string][]} */
    const cases = [
      ['truncated JSON', '{"schemaVersion": 1, "series": {', 'invalid_json'],
      ['not an object', '[1, 2]', 'invalid_schema'],
      ['null', 'null', 'invalid_schema'],
      ['future version', JSON.stringify({ ...fullState(), schemaVersion: 2 }), 'unknown_version'],
      ['no version', JSON.stringify({ series: {} }), 'unknown_version'],
      ['negative counter', JSON.stringify({ ...fullState(), series: { k: { failures: -1 } } }), 'invalid_schema'],
      ['extra top-level key', JSON.stringify({ ...fullState(), surprise: true }), 'invalid_schema'],
      ['bad hash', JSON.stringify({ ...fullState(), lastValidConfig: { hash: 'md5:x', config: {} } }), 'invalid_schema'],
      ['bad timestamp', JSON.stringify({ ...fullState(), lastRunAt: 'yesterday' }), 'invalid_schema'],
      ['empty file', '', 'invalid_json'],
    ];
    for (const [label, content, reason] of cases) {
      withStateFile((path) => {
        saveState(emptyState(), path);
        writeFileSync(path, content);
        const loaded = loadState(path);
        assert.equal(loaded.rebuilt, true, label);
        assert.equal(loaded.reason, reason, label);
        assert.deepEqual(loaded.state, emptyState(), label);
      });
    }
  });

  test('an unreadable path (a directory) is a loss too', () => {
    withStateFile((path) => {
      saveState(emptyState(), path);
      const loaded = loadState(join(path, '..'));
      assert.equal(loaded.rebuilt, true);
      assert.equal(loaded.reason, 'unreadable');
    });
  });

  test('loading never mutates a shared empty state', () => {
    const first = loadState('does/not/exist.json').state;
    first.series['x|y/contado'] = { failures: 9 };
    assert.deepEqual(loadState('does/not/exist.json').state.series, {});
  });
});

describe('run state: fields added in F4 (compatible extension of version 1)', () => {
  const hash = `sha256:${'b'.repeat(64)}`;

  test('products and the new ops fields round-trip', () => {
    withStateFile((path) => {
      const state = {
        ...fullState(),
        products: { 'tcl-75t6c': { configHash: hash, s: 1, r: 0.025 }, 'sin-tasa': { configHash: hash, s: 0, r: null } },
        ops: { lastCauses: ['inactividad'], measuredStores: ['oncity'], commitConflict: false, channelBroken: true, availability: { value: 97.5, at: '2026-11-22T12:17:41Z' } },
      };
      saveState(/** @type {any} */ (state), path);
      assert.deepEqual(loadState(path).state, state);
    });
  });

  test('a state written before F4 (no products, plain ops) still loads, and the product memory is simply absent', () => {
    withStateFile((path) => {
      saveState(fullState(), path);
      const loaded = loadState(path);
      assert.equal(loaded.rebuilt, false);
      assert.equal(loaded.state.products, undefined);
      assert.equal(loaded.state.eligible['tcl-75t6c']?.length, 2, 'the rest of the state is kept');
    });
  });

  test('invalid values are refused (a hand-edited or corrupt cache is a loss, never trusted)', () => {
    const valid = { ...fullState(), products: { a: { configHash: hash, s: 1, r: 0.01 } } };
    assert.equal(isRunState(valid), true);
    assert.equal(isRunState({ ...valid, products: { a: { configHash: 'x', s: 1, r: 0.01 } } }), false);
    assert.equal(isRunState({ ...valid, products: { a: { configHash: hash, s: 2, r: 0.01 } } }), false);
    assert.equal(isRunState({ ...valid, products: { a: { configHash: hash, s: 1, r: -1 } } }), false);
    assert.equal(isRunState({ ...valid, products: { a: { configHash: hash, s: 1 } } }), false);
    assert.equal(isRunState({ ...valid, ops: { lastCauses: [], availability: { value: 101, at: '2026-11-22T12:17:41Z' } } }), false);
    assert.equal(isRunState({ ...valid, ops: { lastCauses: [], extra: 1 } }), false);
  });
});
