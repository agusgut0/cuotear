import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { checkInactivity, INACTIVITY_DAYS } from '../../src/notify/inactivity.js';

const NOW = new Date('2026-11-23T12:00:00Z');
const DAY = 86_400_000;
/** @param {number} ms */
const ago = (ms) => async () => new Date(NOW.getTime() - ms).toISOString();

describe('checkInactivity', () => {
  test('44 days: no cause', async () => {
    assert.deepEqual(await checkInactivity({ lastCommitDate: ago(44 * DAY), now: NOW }), { days: 44, cause: null });
  });
  test('exactly 45 days: no cause (strictly greater)', async () => {
    assert.deepEqual(await checkInactivity({ lastCommitDate: ago(INACTIVITY_DAYS * DAY), now: NOW }), { days: 45, cause: null });
  });
  test('45 days and one second: inactividad', async () => {
    assert.equal((await checkInactivity({ lastCommitDate: ago(INACTIVITY_DAYS * DAY + 1000), now: NOW })).cause, 'inactividad');
  });
  test('a commit dated in the future is not inactivity', async () => {
    assert.equal((await checkInactivity({ lastCommitDate: ago(-DAY), now: NOW })).cause, null);
  });
  test('accepts the offset form that `git log --format=%cI` prints', async () => {
    const result = await checkInactivity({ lastCommitDate: async () => '2026-09-01T10:00:00-03:00\n', now: NOW });
    assert.equal(result.cause, 'inactividad');
  });
  test('git failure or an invalid date is unknown: no cause, no throw', async () => {
    /** @type {string[]} */
    const lines = [];
    const log = (/** @type {string} */ line) => lines.push(line);
    assert.deepEqual(await checkInactivity({ lastCommitDate: async () => { throw new Error('no origin/main'); }, now: NOW, log }), { days: null, cause: null });
    assert.deepEqual(await checkInactivity({ lastCommitDate: async () => 'not a date', now: NOW, log }), { days: null, cause: null });
    assert.deepEqual(await checkInactivity({ lastCommitDate: async () => '', now: NOW, log }), { days: null, cause: null });
    assert.equal(lines.length, 3);
  });
});
