/**
 * robots.txt parsing and matching per RFC 9309 (DRT 5.1, ADR-0007).
 *
 * The robots.txt body is untrusted data: it is only tokenized, never
 * evaluated. Pattern matching is done without regular expressions so a
 * hostile pattern cannot cause catastrophic backtracking.
 *
 * @typedef {{ allow: boolean, pattern: string }} RobotsRule
 */

/** RFC 9309 section 2.5: parsers must process at least 500 KiB. */
const MAX_ROBOTS_CHARS = 500 * 1024;

/** Agent token matched case-insensitively against `User-agent` lines. */
export const ROBOTS_AGENT = 'cuotear';

/** Rules that forbid everything (used when robots.txt is unreachable and uncached). */
export const DISALLOW_ALL = /** @type {readonly RobotsRule[]} */ (Object.freeze([{ allow: false, pattern: '/' }]));

/** @param {string} text */
const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/**
 * Parses a robots.txt body and returns the rules that apply to the agent: the
 * merged groups naming `agent`, otherwise the merged `*` groups, otherwise none.
 * @param {string} text
 * @param {string} [agent]
 * @returns {RobotsRule[]}
 */
export function parseRobots(text, agent = ROBOTS_AGENT) {
  const token = agent.toLowerCase();
  /** @type {{ agents: string[], rules: RobotsRule[] }[]} */
  const groups = [];
  /** @type {{ agents: string[], rules: RobotsRule[] } | null} */
  let current = null;
  let lastWasAgent = false;

  for (const rawLine of stripBom(text).slice(0, MAX_ROBOTS_CHARS).split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === 'user-agent') {
      if (!lastWasAgent || current === null) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if ((key === 'allow' || key === 'disallow') && current !== null && value !== '') {
      current.rules.push({ allow: key === 'allow', pattern: value });
    }
  }

  const named = groups.filter((group) => group.agents.includes(token));
  const selected = named.length > 0 ? named : groups.filter((group) => group.agents.includes('*'));
  return selected.flatMap((group) => group.rules);
}

/**
 * Matches one robots.txt pattern (`*` wildcard, trailing `$` anchor) against a
 * path-with-query, from the start of the path.
 * @param {string} pattern
 * @param {string} path
 * @returns {boolean}
 */
export function matchesPattern(pattern, path) {
  const anchored = pattern.endsWith('$');
  const parts = (anchored ? pattern.slice(0, -1) : pattern).split('*');
  const head = parts[0] ?? '';
  if (!path.startsWith(head)) return false;
  let position = head.length;
  if (parts.length === 1) return anchored ? path.length === position : true;

  const tail = parts[parts.length - 1] ?? '';
  for (let i = 1; i < parts.length - 1; i += 1) {
    const found = path.indexOf(parts[i] ?? '', position);
    if (found < 0) return false;
    position = found + (parts[i] ?? '').length;
  }
  if (anchored) return path.length - tail.length >= position && path.endsWith(tail);
  return path.indexOf(tail, position) >= 0;
}

/**
 * Decides whether a request path (with query string) is allowed: the longest
 * matching pattern wins and a tie goes to Allow; no match means allowed.
 * @param {readonly RobotsRule[]} rules
 * @param {string} pathWithQuery e.g. `/api/x?y=1`
 * @returns {boolean}
 */
export function isAllowed(rules, pathWithQuery) {
  /** @type {RobotsRule | null} */
  let best = null;
  for (const rule of rules) {
    if (!matchesPattern(rule.pattern, pathWithQuery)) continue;
    if (best === null || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)) {
      best = rule;
    }
  }
  return best === null || best.allow;
}
