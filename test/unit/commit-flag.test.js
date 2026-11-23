import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { emptyState } from '../../src/state/schema.js';
import { recordCommitConflict } from '../../src/state/commit-flag.js';

/** @param {boolean} rebuilt */
const loaded = (rebuilt) => /** @type {import('../../src/state/store.js').LoadResult} */ (
  rebuilt ? { state: emptyState(), rebuilt: true, reason: 'missing', notice: 'x' } : { state: emptyState(), rebuilt: false, reason: null, notice: null }
);

describe('Q7: recording the commit outcome in the run state', () => {
  test('writes ops.commitConflict for an unpushed commit and clears it for a pushed one', () => {
    /** @type {import('../../src/state/schema.js').RunState[]} */
    const saved = [];
    assert.equal(recordCommitConflict({ unpushed: true, load: () => loaded(false), save: (state) => saved.push(state), log: () => {} }), true);
    assert.equal(recordCommitConflict({ unpushed: false, load: () => loaded(false), save: (state) => saved.push(state), log: () => {} }), true);
    assert.deepEqual(saved.map((state) => state.ops.commitConflict), [true, false]);
  });

  test('a rebuilt (lost) state is not written', () => {
    let writes = 0;
    assert.equal(recordCommitConflict({ unpushed: true, load: () => loaded(true), save: () => { writes += 1; }, log: () => {} }), false);
    assert.equal(writes, 0);
  });

  test('a loadState that throws is logged by name only and never propagates', () => {
    const lines = /** @type {string[]} */ ([]);
    const secret = new RangeError('/secret/path with content');
    const ok = recordCommitConflict({ unpushed: true, load: () => { throw secret; }, save: () => {}, log: (line) => lines.push(line) });
    assert.equal(ok, false);
    assert.equal(lines.length, 1);
    assert.match(lines[0] ?? '', /RangeError/);
    assert.ok(!(lines[0] ?? '').includes('secret'));
  });

  test('a saveState that throws is logged by name only and never propagates', () => {
    const lines = /** @type {string[]} */ ([]);
    const ok = recordCommitConflict({ unpushed: false, load: () => loaded(false), save: () => { throw new TypeError('refusing to save an invalid run state'); }, log: (line) => lines.push(line) });
    assert.equal(ok, false);
    assert.match(lines.join('\n'), /TypeError/);
    assert.ok(!lines.join('\n').includes('refusing'));
  });

  test('a thrown non-Error value is handled', () => {
    const lines = /** @type {string[]} */ ([]);
    assert.equal(recordCommitConflict({ unpushed: true, load: () => { throw 'plain string'; }, log: (line) => lines.push(line) }), false);
    assert.match(lines.join('\n'), /Error/);
  });
});
