import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { commitHistory, MAX_ATTEMPTS } from '../../src/git/commit-history.js';

const NOW = new Date('2026-11-22T12:17:41Z');

/**
 * Scripted git: `replies` maps the first argument(s) to results served in
 * order; unknown commands succeed with empty output.
 * @param {Record<string, { code?: number, stdout?: string }[]>} replies
 */
function fakeGit(replies) {
  /** @type {string[][]} */
  const calls = [];
  /** @type {import('../../src/git/commit-history.js').GitRunner} */
  const git = async (args) => {
    calls.push(args);
    const key = args.find((arg) => !arg.startsWith('-') && !arg.includes('=')) ?? '';
    const next = replies[key]?.shift();
    return { code: next?.code ?? 0, stdout: next?.stdout ?? '', stderr: '' };
  };
  const verbs = () => calls.map((args) => args.find((arg) => !arg.startsWith('-') && !arg.includes('=')));
  return { git, calls, verbs };
}

/** @param {string[]} lines */
const logger = (lines) => (/** @type {string} */ line) => {
  lines.push(line);
};

describe('commitHistory', () => {
  test('no changes: no add, no commit, no push', async () => {
    const { git, verbs } = fakeGit({ status: [{ stdout: '' }] });
    const outcome = await commitHistory({ git, branch: 'main', now: NOW, log: () => {} });
    assert.deepEqual(outcome, { status: 'no_changes' });
    assert.deepEqual(verbs(), ['status']);
  });

  test('only data/history is looked at and staged', async () => {
    const { git, calls } = fakeGit({ status: [{ stdout: ' M data/history/tv.jsonl\n' }], diff: [{ stdout: '2\t0\tdata/history/tv.jsonl\n' }] });
    await commitHistory({ git, branch: 'main', now: NOW, log: () => {} });
    assert.deepEqual(calls[0], ['status', '--porcelain', '--', 'data/history']);
    assert.deepEqual(calls[1], ['add', '--', 'data/history']);
  });

  test('one commit as the bot with a conventional message, then a push', async () => {
    const { git, calls, verbs } = fakeGit({ status: [{ stdout: ' M data/history/tv.jsonl\n' }], diff: [{ stdout: '1\t0\tdata/history/tv.jsonl\n' }] });
    const outcome = await commitHistory({ git, branch: 'main', now: NOW, log: () => {} });
    assert.deepEqual(outcome, { status: 'committed', pushed: true, attempts: 1 });
    assert.deepEqual(verbs(), ['status', 'add', 'diff', 'commit', 'push']);
    const commit = calls[3] ?? [];
    assert.ok(commit.includes('user.name=github-actions[bot]'));
    assert.equal(commit[commit.indexOf('-m') + 1], 'chore(data): record price changes (2026-11-22 12:17 UTC)');
    assert.deepEqual(commit.slice(-2), ['--', 'data/history'], 'the commit is limited to data/history');
    assert.deepEqual(calls[4], ['push', 'origin', 'HEAD:main']);
  });

  test('a purge (only deletions) gets the purge message', async () => {
    const { git, calls } = fakeGit({ status: [{ stdout: ' M data/history/tv.jsonl\n' }], diff: [{ stdout: '0\t3\tdata/history/tv.jsonl\n' }] });
    await commitHistory({ git, branch: 'main', now: NOW, log: () => {} });
    const purge = calls[3] ?? [];
    assert.equal(purge[purge.indexOf('-m') + 1], 'chore(data): purge price history (2026-11-22 12:17 UTC)');
  });

  test('a rejected push is retried after fetch and rebase', async () => {
    const waits = /** @type {number[]} */ ([]);
    const { git, verbs } = fakeGit({ status: [{ stdout: ' M x\n' }], diff: [{ stdout: '1\t0\tx\n' }], push: [{ code: 1 }, { code: 0 }] });
    const outcome = await commitHistory({ git, branch: 'main', now: NOW, sleep: async (ms) => void waits.push(ms), log: () => {} });
    assert.deepEqual(outcome, { status: 'committed', pushed: true, attempts: 2 });
    assert.deepEqual(verbs(), ['status', 'add', 'diff', 'commit', 'push', 'fetch', 'rebase', 'push']);
    assert.deepEqual(waits, [5000]);
  });

  test('gives up after three push attempts with a warning and no error', async () => {
    const lines = /** @type {string[]} */ ([]);
    const { git, verbs } = fakeGit({ status: [{ stdout: ' M x\n' }], diff: [{ stdout: '1\t0\tx\n' }], push: [{ code: 1 }, { code: 1 }, { code: 1 }] });
    const outcome = await commitHistory({ git, branch: 'main', now: NOW, sleep: async () => {}, log: logger(lines) });
    assert.deepEqual(outcome, { status: 'unpushed', reason: 'push_failed' });
    assert.equal(verbs().filter((verb) => verb === 'push').length, MAX_ATTEMPTS);
    assert.ok(lines.some((line) => line.startsWith('::warning::')));
  });

  test('a rebase conflict aborts the rebase, warns and stops retrying', async () => {
    const lines = /** @type {string[]} */ ([]);
    const { git, verbs } = fakeGit({ status: [{ stdout: ' M x\n' }], diff: [{ stdout: '1\t0\tx\n' }], push: [{ code: 1 }], rebase: [{ code: 1 }, { code: 0 }] });
    const outcome = await commitHistory({ git, branch: 'main', now: NOW, sleep: async () => {}, log: logger(lines) });
    assert.deepEqual(outcome, { status: 'unpushed', reason: 'conflict' });
    assert.deepEqual(verbs().slice(-3), ['fetch', 'rebase', 'rebase']);
    assert.ok(lines.some((line) => line.startsWith('::warning::') && line.includes('conflicts')));
  });

  test('an unexpected git failure while staging is an error', async () => {
    const { git } = fakeGit({ status: [{ stdout: ' M x\n' }], add: [{ code: 128 }] });
    await assert.rejects(commitHistory({ git, branch: 'main', now: NOW, log: () => {} }), /git add failed/);
  });
});
