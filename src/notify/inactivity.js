import { execFile } from 'node:child_process';

/**
 * Early warning before GitHub suspends the cron of an inactive repo (R-04,
 * ADR-0013, DRT 10.3): the last commit of `origin/main` older than 45 days =>
 * cause `inactividad`. Unreadable or invalid date => unknown, no cause.
 */

export const INACTIVITY_DAYS = 45;
const DAY_MS = 86_400_000;

/**
 * Last commit date (ISO 8601) through a fixed git command; no user input in argv.
 * @returns {Promise<string>}
 */
export function readLastCommitDate() {
  return new Promise((resolve, reject) => {
    execFile('git', ['log', '-1', '--format=%cI', 'origin/main'], { timeout: 10_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error === null) resolve(stdout.trim());
      else reject(new Error('git log failed'));
    });
  });
}

/**
 * @param {{
 *   lastCommitDate?: () => Promise<string>,
 *   now?: Date,
 *   log?: (line: string) => void,
 * }} [input]
 * @returns {Promise<{ days: number | null, cause: 'inactividad' | null }>}
 */
export async function checkInactivity({ lastCommitDate = readLastCommitDate, now = new Date(), log = console.log } = {}) {
  try {
    const last = new Date((await lastCommitDate()).trim());
    if (Number.isNaN(last.getTime())) {
      log('[cuotear] inactivity: the last commit date is not valid; unknown');
      return { days: null, cause: null };
    }
    const elapsed = now.getTime() - last.getTime();
    const days = Math.floor(elapsed / DAY_MS);
    return { days, cause: elapsed > INACTIVITY_DAYS * DAY_MS ? 'inactividad' : null };
  } catch {
    log('[cuotear] inactivity: could not read the last commit date; unknown');
    return { days: null, cause: null };
  }
}
