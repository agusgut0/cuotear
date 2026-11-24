import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

  test('an invalid inflation value alone is dropped: the rest of the state is kept and nothing is rebuilt', () => {
    for (const inflation of [{ fuente: 'rem', anualPct: 1001, fecha: '2026-10-31', obtainedAt: '2026-11-22T12:17:41Z' }, { fuente: 'rem', anualPct: 5 }, 'x']) {
      withStateFile((path) => {
        saveState(emptyState(), path);
        writeFileSync(path, JSON.stringify({ ...fullState(), inflation }));
        const loaded = loadState(path);
        assert.equal(loaded.rebuilt, false);
        assert.equal(loaded.state.inflation, undefined);
        const expected = { ...fullState() };
        delete expected.inflation;
        assert.deepEqual({ ...loaded.state }, expected);
      });
    }
    // another invalid field next to a bad inflation still rebuilds
    withStateFile((path) => {
      saveState(emptyState(), path);
      writeFileSync(path, JSON.stringify({ ...fullState(), series: { k: { failures: -1 } }, inflation: 'x' }));
      assert.equal(loadState(path).reason, 'invalid_schema');
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

describe('run state: bounds and patterns of what a cache can inject (S1, S3)', () => {
  /** @param {Partial<import('../../src/state/schema.js').RunState>} extra @returns {import('../../src/state/schema.js').RunState} */
  const withExtra = (extra) => ({ ...fullState(), ...extra });

  test('S1: every valid cause key is accepted in ops.lastCauses', () => {
    const causes = ['todas-tiendas-fallan', 'secretos-canal', 'config-invalida', 'config-ausente', 'historial-45mb', 'historial-100mb', 'commit-conflicto', 'inactividad', 'disponibilidad', 'robots:oncity', 'robots:mega-tone2'];
    assert.equal(isRunState(withExtra({ ops: { lastCauses: causes, measuredStores: ['oncity', 'carrefour'] } })), true);
  });

  test('S1: a cause that is not a known key (or carries a line break or a workflow command) invalidates the state', () => {
    for (const cause of ['robots:x\n::error::pwned', '::error::x', 'inactividad\n', 'robots:UPPER', 'robots:a', 'robots:' + 'a'.repeat(31), 'desconocida', '']) {
      assert.equal(isRunState(withExtra({ ops: { lastCauses: [cause] } })), false, JSON.stringify(cause));
    }
  });

  test('S1: measuredStores must be store ids', () => {
    for (const store of ['x\n::error::bad', 'A', 'a', 'a'.repeat(31), 'with space']) {
      assert.equal(isRunState(withExtra({ ops: { lastCauses: [], measuredStores: [store] } })), false, JSON.stringify(store));
    }
  });

  test('S1: a state with a forged cause loads as lost (rebuilt), like any other invalid state', () => {
    withStateFile((path) => {
      saveState(fullState(), path);
      const forged = { ...fullState(), ops: { lastCauses: ['robots:x\n::error::pwned'] } };
      writeFileSync(path, JSON.stringify(forged));
      const loaded = loadState(path);
      assert.equal(loaded.rebuilt, true);
      assert.equal(loaded.reason, 'invalid_schema');
      assert.deepEqual(loaded.state.ops.lastCauses, []);
    });
  });

  test('S2: sentAlertIds ids must be safe to log', () => {
    assert.equal(isRunState(withExtra({ sentAlertIds: [{ id: 'a'.repeat(64), at: '2026-11-22T12:17:41Z' }] })), true);
    for (const id of ['', 'a\nb', 'a b', 'a'.repeat(101), '<b>']) {
      assert.equal(isRunState(withExtra({ sentAlertIds: [{ id, at: '2026-11-22T12:17:41Z' }] })), false, JSON.stringify(id));
    }
  });

  test('S3: pendingAlerts holds at most 200 and sentAlertIds at most 2000', () => {
    assert.equal(isRunState(withExtra({ pendingAlerts: Array.from({ length: 200 }, () => ({})) })), true);
    assert.equal(isRunState(withExtra({ pendingAlerts: Array.from({ length: 201 }, () => ({})) })), false);
    const sent = (/** @type {number} */ count) => Array.from({ length: count }, (_, index) => ({ id: `id${index}`, at: '2026-11-22T12:17:41Z' }));
    assert.equal(isRunState(withExtra({ sentAlertIds: sent(2000) })), true);
    assert.equal(isRunState(withExtra({ sentAlertIds: sent(2001) })), false);
  });

  test('a state saved before F4 (no products, no availability) still loads and is not rebuilt', () => {
    withStateFile((path) => {
      const old = /** @type {Record<string, unknown>} */ ({ ...fullState() });
      delete old.products;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(old));
      const loaded = loadState(path);
      assert.equal(loaded.rebuilt, false);
      assert.equal(loaded.state.products, undefined);
    });
  });
});
