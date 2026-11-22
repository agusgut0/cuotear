import { LineCounter, isMap, isSeq, parseDocument } from 'yaml';

/** @typedef {(string|number)[]} Path */

/**
 * @typedef {Object} Position
 * @property {number} line
 * @property {number} column
 */

/**
 * Formats a path as `productos[2].urls.oncity`.
 * @param {Path} path
 * @returns {string}
 */
export function formatPath(path) {
  return path.reduce(
    /** @param {string} out @param {string|number} seg */
    (out, seg) => (typeof seg === 'number' ? `${out}[${seg}]` : out === '' ? seg : `${out}.${seg}`),
    '',
  );
}

/**
 * Parses YAML 1.2 text (duplicate keys are errors) and exposes a function
 * that resolves a path in the document to a line and column.
 * @param {string} text
 * @returns {{
 *   data: unknown,
 *   parseErrors: { code: string, message: string, position: Position }[],
 *   locate: (path: Path, atKey?: boolean) => Position,
 * }}
 */
export function parseSource(text) {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { uniqueKeys: true, lineCounter });

  const parseErrors = doc.errors.map((error) => ({
    code: error.code,
    message: error.message.split('\n')[0] ?? error.message,
    position: { line: error.linePos?.[0].line ?? 1, column: error.linePos?.[0].col ?? 1 },
  }));

  /** @type {(path: Path, atKey?: boolean) => Position} */
  const locate = (path, atKey = false) => {
    /** @type {unknown} */
    let node = doc.contents;
    /** @type {unknown} */
    let keyNode = null;
    for (const segment of path) {
      if (isMap(node)) {
        const pair = node.items.find((item) => String(/** @type {{ value?: unknown }} */ (item.key).value) === String(segment));
        if (!pair) break;
        keyNode = pair.key;
        node = pair.value;
      } else if (isSeq(node)) {
        const item = node.items[Number(segment)];
        if (item === undefined) break;
        keyNode = null;
        node = item;
      } else {
        break;
      }
    }
    const target = atKey && keyNode ? keyNode : node;
    const offset = /** @type {{ range?: number[] } | null} */ (target)?.range?.[0] ?? 0;
    const { line, col } = lineCounter.linePos(offset);
    return { line, column: col };
  };

  return { data: doc.errors.length === 0 ? doc.toJS() : null, parseErrors, locate };
}
