import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { changedPoints, lastOkPoint, lastPoints, parseHistory, purge, serializeHistory } from '../../src/core/history.js';
import { historyPath, readHistory, removeHistory, writeHistory } from '../../src/core/history-files.js';
import { recordProduct } from '../../src/core/record.js';

const NOW = new Date('2026-11-22T12:00:00Z');
const T0 = '2025-10-22T12:00:00Z'; // 13 months before NOW

/** @type {(overrides?: Partial<import('../../src/stores/types.js').StoreResult>) => import('../../src/stores/types.js').StoreResult} */
const ok = (overrides = {}) => ({
  outcome: 'ok',
  listaCents: 100_000_00,
  contado: { valorCents: 100_000_00, medio: 'debito', descuentoPct: 0 },
  tarjetas: { visa: { n: 12, cuotaCents: 8_333_33, totalCents: 100_000_00 }, mastercard: null, naranja: null },
  meta: { requests: 1, ms: 1 },
  ...overrides,
});
/** @type {import('../../src/stores/types.js').StoreResult} */
const FAILED = { outcome: 'falla', failure: { kind: 'blocked', detail: 'x' }, meta: { requests: 1, ms: 1 } };

/**
 * @param {string} t
 * @param {string} serie
 * @param {Partial<import('../../src/core/history.js').HistoryPoint>} [fields]
 * @returns {import('../../src/core/history.js').HistoryPoint}
 */
const point = (t, serie, fields = {}) => ({ t, tienda: 'oncity', serie, estado: 'sin_stock', ...fields });

/**
 * Runs a sequence of measurements for one product and store, one every 6 hours.
 * @param {import('../../src/stores/types.js').StoreResult[]} results
 */
function simulate(results) {
  /** @type {import('../../src/core/history.js').HistoryPoint[]} */
  let points = [];
  /** @type {import('../../src/core/series.js').Counters} */
  let counters = {};
  const addedPerRun = [];
  for (const [index, result] of results.entries()) {
    const now = new Date(NOW.getTime() + index * 6 * 3600_000);
    const run = recordProduct({ productId: 'tv', points, measurements: [{ store: 'oncity', result }], counters, now });
    points = run.points;
    counters = run.counters;
    addedPerRun.push(run.added);
  }
  return { points, counters, addedPerRun };
}

describe('RF-24: when a point is appended', () => {
  test('the first measurement appends cash and the card series', () => {
    const { addedPerRun } = simulate([ok()]);
    assert.deepEqual(addedPerRun[0]?.map((p) => [p.serie, p.estado]), [['contado', 'ok'], ['visa:12', 'ok']]);
    assert.deepEqual(addedPerRun[0]?.[0], { t: '2026-11-22T12:00:00Z', tienda: 'oncity', serie: 'contado', estado: 'ok', valor: 100_000_00, lista: 100_000_00, medio: 'debito', desc: 0 });
  });

  test('a run with no changes appends nothing (zero history writes)', () => {
    const { addedPerRun } = simulate([ok(), ok(), ok(), ok()]);
    assert.deepEqual(addedPerRun.slice(1).map((added) => added.length), [0, 0, 0]);
  });

  test('a change of value, condition, list price or installments appends one point to that series', () => {
    const base = ok();
    const variants = [
      ['value', ok({ contado: { valorCents: 90_000_00, medio: 'debito', descuentoPct: 10 } }), 'contado'],
      ['condition', ok({ contado: { valorCents: 100_000_00, medio: 'transferencia', descuentoPct: 0 } }), 'contado'],
      ['list', ok({ listaCents: 110_000_00 }), 'contado'],
      ['installment', ok({ tarjetas: { visa: { n: 12, cuotaCents: 8_000_00, totalCents: 96_000_00 }, mastercard: null, naranja: null } }), 'visa:12'],
    ];
    for (const [label, changed, serie] of variants) {
      const { addedPerRun } = simulate([base, /** @type {import('../../src/stores/types.js').StoreResult} */ (changed)]);
      assert.deepEqual(addedPerRun[1]?.map((p) => p.serie), [serie], String(label));
    }
  });

  test('ok -> sin_stock -> ok appends a point per state change, and repeated sin_stock appends none (RN-06)', () => {
    const noStock = /** @type {import('../../src/stores/types.js').StoreResult} */ ({ outcome: 'sin_stock', meta: { requests: 1, ms: 1 } });
    const { addedPerRun, points } = simulate([ok(), noStock, noStock, ok()]);
    assert.deepEqual(addedPerRun.map((added) => added.map((p) => `${p.serie}:${p.estado}`)), [
      ['contado:ok', 'visa:12:ok'],
      ['contado:sin_stock', 'visa:12:sin_stock'],
      [],
      ['contado:ok', 'visa:12:ok'],
    ]);
    assert.equal(lastOkPoint(points, 'oncity', 'contado')?.valor, 100_000_00);
  });

  test('RN-06: on restock the last valid value is still available to compare against', () => {
    const noStock = /** @type {import('../../src/stores/types.js').StoreResult} */ ({ outcome: 'sin_stock', meta: { requests: 1, ms: 1 } });
    const cheaper = ok({ contado: { valorCents: 80_000_00, medio: 'debito', descuentoPct: 20 } });
    const { points } = simulate([ok(), noStock, noStock]);
    assert.equal(lastOkPoint(points, 'oncity', 'contado')?.valor, 100_000_00, 'the valid value survives the out-of-stock points');
    const { points: after } = simulate([ok(), noStock, cheaper]);
    assert.equal(lastOkPoint(after, 'oncity', 'contado')?.valor, 80_000_00);
  });

  test('a product that is not offered appends sin_oferta once', () => {
    const none = /** @type {import('../../src/stores/types.js').StoreResult} */ ({ outcome: 'sin_oferta', meta: { requests: 1, ms: 1 } });
    const { addedPerRun } = simulate([none, none]);
    assert.deepEqual(addedPerRun.map((a) => a.map((p) => `${p.serie}:${p.estado}`)), [['contado:sin_oferta'], []]);
  });

  test('10 consecutive failures produce no history points and no commit-worthy change', () => {
    const { addedPerRun, counters, points } = simulate([ok(), ...Array.from({ length: 10 }, () => FAILED)]);
    assert.deepEqual(addedPerRun.slice(1).map((added) => added.length), Array(10).fill(0));
    assert.equal(points.length, 2, 'only the two points of the first successful run exist');
    assert.equal(counters['tv|oncity/contado'] && 'failures' in counters['tv|oncity/contado'] ? counters['tv|oncity/contado'].failures : 0, 10);
  });

  test('a failure followed by a recovery at the same value appends nothing; at a lower value appends one point', () => {
    const lower = ok({ contado: { valorCents: 95_000_00, medio: 'debito', descuentoPct: 5 } });
    const same = simulate([ok(), FAILED, FAILED, ok()]);
    assert.equal(same.addedPerRun[3]?.length, 0);
    const lowered = simulate([ok(), FAILED, lower]);
    assert.deepEqual(lowered.addedPerRun[2]?.map((p) => p.serie), ['contado']);
  });

  test('RN-08: a change of n closes the series and opens another; with 3 changes there are 4 series for the card', () => {
    const withN = (/** @type {number} */ n) => ok({ tarjetas: { visa: { n, cuotaCents: Math.round(100_000_00 / n), totalCents: 100_000_00 }, mastercard: null, naranja: null } });
    const { points, addedPerRun } = simulate([withN(12), withN(12), withN(9), withN(6), withN(3)]);
    assert.deepEqual(addedPerRun[2]?.map((p) => `${p.serie}:${p.estado}`), ['visa:12:cerrada', 'visa:9:ok']);
    const visaSeries = new Set(points.filter((p) => p.serie.startsWith('visa')).map((p) => p.serie));
    assert.deepEqual([...visaSeries].sort(), ['visa:12', 'visa:3', 'visa:6', 'visa:9']);
    const open = [...lastPoints(points).values()].filter((p) => p.serie.startsWith('visa') && p.estado !== 'cerrada');
    assert.deepEqual(open.map((p) => p.serie), ['visa:3'], 'only the current series is open');
  });
});

describe('RF-24: retention', () => {
  test('a series stable for 13 months keeps its last (only) point', () => {
    const points = [point(T0, 'contado', { estado: 'ok', valor: 1, lista: 1, medio: 'ninguno', desc: null })];
    const result = purge(points, NOW, 12);
    assert.deepEqual(result.points, points);
    assert.equal(result.removed, 0);
  });

  test('points of 14 and 13 months plus one of 2 months: only the recent one remains', () => {
    const points = [point('2025-09-22T12:00:00Z', 'contado'), point(T0, 'contado'), point('2026-09-22T12:00:00Z', 'contado')];
    assert.deepEqual(purge(points, NOW, 12).points.map((p) => p.t), ['2026-09-22T12:00:00Z']);
  });

  test('points of 14 and 13 months only: the 13-month one (the last) remains', () => {
    const points = [point('2025-09-22T12:00:00Z', 'contado'), point(T0, 'contado')];
    assert.deepEqual(purge(points, NOW, 12).points.map((p) => p.t), [T0]);
  });

  test('every series keeps its own last point', () => {
    const points = [point('2025-01-01T00:00:00Z', 'contado'), point('2025-01-01T00:00:00Z', 'visa:12'), point('2026-11-01T00:00:00Z', 'contado')];
    assert.deepEqual(purge(points, NOW, 12).points.map((p) => `${p.serie}@${p.t}`), ['visa:12@2025-01-01T00:00:00Z', 'contado@2026-11-01T00:00:00Z']);
  });

  test('a series closed 14 months ago keeps its closing point', () => {
    const points = [point('2025-09-22T12:00:00Z', 'visa:6', { estado: 'cerrada' })];
    assert.equal(purge(points, NOW, 12).points.length, 1);
  });

  test('the 12-month boundary is inclusive and the months are configurable', () => {
    const edge = point('2025-11-22T12:00:00Z', 'contado');
    const newer = point('2026-01-01T00:00:00Z', 'contado');
    assert.equal(purge([edge, newer], NOW, 12).points.length, 2);
    assert.equal(purge([point('2025-11-22T11:59:59Z', 'contado'), newer], NOW, 12).points.length, 1);
    assert.equal(purge([point('2026-04-01T00:00:00Z', 'contado'), newer], NOW, 6).points.length, 1);
  });

  test('a run that purges removes lines only: the new file is the old one minus lines', () => {
    const old = [point('2025-09-22T12:00:00Z', 'contado'), point('2025-09-22T12:00:00Z', 'visa:12'), point('2026-11-01T00:00:00Z', 'contado')];
    const before = serializeHistory(old).trimEnd().split('\n');
    const after = serializeHistory(purge(old, NOW, 12).points).trimEnd().split('\n');
    assert.ok(after.every((line) => before.includes(line)));
  });
});

describe('RF-24: deterministic JSON Lines', () => {
  const sample = [
    { estado: 'ok', serie: 'contado', tienda: 'oncity', t: '2026-11-22T12:17:41Z', desc: 0, medio: 'debito', lista: 229999900, valor: 229999900 },
    { n: 15, cuota: 15333326, total: 229999900, estado: 'ok', serie: 'visa:15', tienda: 'oncity', t: '2026-11-22T12:17:41Z' },
    { t: '2026-11-23T00:17:09Z', tienda: 'oncity', serie: 'visa:15', estado: 'cerrada' },
  ];

  test('stable key order, one line per point, trailing newline', () => {
    const text = serializeHistory(/** @type {any} */ (sample));
    assert.equal(
      text,
      '{"t":"2026-11-22T12:17:41Z","tienda":"oncity","serie":"contado","estado":"ok","valor":229999900,"lista":229999900,"medio":"debito","desc":0}\n' +
        '{"t":"2026-11-22T12:17:41Z","tienda":"oncity","serie":"visa:15","estado":"ok","total":229999900,"cuota":15333326,"n":15}\n' +
        '{"t":"2026-11-23T00:17:09Z","tienda":"oncity","serie":"visa:15","estado":"cerrada"}\n',
    );
    assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'));
  });

  test('serialization is independent of the input order and round-trips', () => {
    const forward = serializeHistory(/** @type {any} */ (sample));
    const backward = serializeHistory(/** @type {any} */ ([...sample].reverse()));
    assert.equal(forward, backward);
    const parsed = parseHistory(forward);
    assert.equal(parsed.ignored, 0);
    assert.equal(serializeHistory(parsed.points), forward);
  });

  test('appending a point adds exactly one line at the end (minimal diff)', () => {
    const before = serializeHistory(/** @type {any} */ (sample));
    const added = point('2026-11-24T00:00:00Z', 'contado', { estado: 'ok', valor: 1, lista: 1, medio: 'ninguno', desc: null });
    const after = serializeHistory([.../** @type {any[]} */ (sample), added]);
    assert.ok(after.startsWith(before));
    assert.equal(after.slice(before.length).split('\n').length, 2);
  });

  test('an empty history is the empty string; money is integer centavos', () => {
    assert.equal(serializeHistory([]), '');
    const bad = '{"t":"2026-11-22T12:17:41Z","tienda":"oncity","serie":"contado","estado":"ok","valor":2299999.5,"lista":1,"medio":"debito","desc":0}';
    assert.deepEqual(parseHistory(bad), { points: [], ignored: 1 });
  });

  test('invalid lines are ignored and counted, never thrown', () => {
    const good = serializeHistory([point('2026-11-22T12:00:00Z', 'contado')]);
    const text = [
      good.trim(),
      '{not json',
      '{"t":"2026-11-22T12:00:00Z","tienda":"oncity","serie":"contado","estado":"ok"}',
      '{"t":"2026-11-22T12:00:00Z","tienda":"oncity","serie":"visa:12","estado":"ok","total":1,"cuota":1,"n":6}',
      '{"t":"2026-11-22T12:00:00Z","tienda":"oncity","serie":"contado","estado":"sin_stock","extra":1}',
      '{"t":"yesterday","tienda":"oncity","serie":"contado","estado":"sin_stock"}',
      '[]',
      '',
    ].join('\n');
    const parsed = parseHistory(text);
    assert.equal(parsed.points.length, 1);
    assert.equal(parsed.ignored, 6);
  });
});

describe('history files (the only I/O)', () => {
  /** @param {(directory: string) => void} fn */
  const withTempDir = (fn) => {
    const directory = mkdtempSync(join(tmpdir(), 'cuotear-history-'));
    try {
      fn(directory);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };

  test('write/read round trip; an unchanged history is not rewritten (zero writes, zero commits)', () => {
    withTempDir((directory) => {
      const run = recordProduct({ productId: 'tv', points: [], measurements: [{ store: 'oncity', result: ok() }], counters: {}, now: NOW });
      assert.equal(writeHistory(directory, 'tv', run.points), true);
      const path = historyPath(directory, 'tv');
      const before = { text: readFileSync(path, 'utf8'), mtime: statSync(path).mtimeMs };

      const loaded = readHistory(directory, 'tv');
      const again = recordProduct({ productId: 'tv', points: loaded.points, measurements: [{ store: 'oncity', result: ok() }], counters: run.counters, now: new Date(NOW.getTime() + 6 * 3600_000) });
      assert.equal(again.added.length, 0);
      assert.equal(writeHistory(directory, 'tv', again.points), false);
      assert.deepEqual({ text: readFileSync(path, 'utf8'), mtime: statSync(path).mtimeMs }, before);
    });
  });

  test('a missing file is an empty history and writing nothing creates no file', () => {
    withTempDir((directory) => {
      assert.deepEqual(readHistory(directory, 'nothing'), { points: [], ignored: 0 });
      assert.equal(writeHistory(directory, 'nothing', []), false);
      assert.equal(removeHistory(directory, 'nothing'), false);
    });
  });

  test('a removed product deletes its file (S-33)', () => {
    withTempDir((directory) => {
      writeHistory(directory, 'tv', [point('2026-11-22T12:00:00Z', 'contado')]);
      assert.equal(removeHistory(directory, 'tv'), true);
      assert.equal(readHistory(directory, 'tv').points.length, 0);
    });
  });

  test('a corrupt line in the file does not break reading', () => {
    withTempDir((directory) => {
      writeHistory(directory, 'tv', [point('2026-11-22T12:00:00Z', 'contado')]);
      writeFileSync(historyPath(directory, 'tv'), `${readFileSync(historyPath(directory, 'tv'), 'utf8')}garbage\n`);
      const loaded = readHistory(directory, 'tv');
      assert.equal(loaded.points.length, 1);
      assert.equal(loaded.ignored, 1);
    });
  });

  test('product ids cannot escape the directory', () => {
    for (const id of ['../x', 'a/b', '', 'A', '..']) assert.throws(() => historyPath('data/history', id), RangeError);
  });
});

describe('recordProduct: statuses and retention together', () => {
  test('after 3 failures the series are "fallida"; at the 4th "sin_datos"; ineligible both times (S-26)', () => {
    const first = simulate([ok(), FAILED, FAILED, FAILED]);
    const run = recordProduct({ productId: 'tv', points: first.points, measurements: [{ store: 'oncity', result: FAILED }], counters: first.counters, now: new Date('2026-12-01T00:00:00Z') });
    assert.ok(run.series.every((s) => s.status === 'sin_datos' && !s.eligible));
    const before = recordProduct({ productId: 'tv', points: first.points.slice(0, 2), measurements: [], counters: first.counters, now: NOW });
    assert.ok(before.series.every((s) => s.status === 'fallida' && !s.eligible));
  });

  test('a valid run makes every offered series eligible; a closed one is not', () => {
    const withN = (/** @type {number} */ n) => ok({ tarjetas: { visa: { n, cuotaCents: Math.round(100_000_00 / n), totalCents: 100_000_00 }, mastercard: null, naranja: null } });
    const { points, counters } = simulate([withN(12), withN(6)]);
    const series = recordProduct({ productId: 'tv', points, measurements: [], counters, now: NOW }).series;
    assert.deepEqual(series.map((s) => [s.serie, s.status, s.eligible]), [
      ['contado', 'valida', true],
      ['visa:12', 'cerrada', false],
      ['visa:6', 'valida', true],
    ]);
  });

  test('retention runs inside the run and keeps the last point of each series', () => {
    const old = [point('2025-01-01T00:00:00Z', 'contado', { estado: 'ok', valor: 5, lista: 5, medio: 'ninguno', desc: null })];
    const run = recordProduct({ productId: 'tv', points: old, measurements: [{ store: 'oncity', result: ok() }], counters: {}, now: NOW });
    assert.equal(run.removed, 1, 'the old contado point is dropped because a newer one exists');
    assert.ok(run.points.every((p) => p.t >= '2025-11-22'));
  });

  test('changedPoints ignores failures and compares only against the previous point of the same series', () => {
    const previous = lastPoints([point('2026-11-01T00:00:00Z', 'contado', { estado: 'ok', valor: 1, lista: 1, medio: 'ninguno', desc: null })]);
    const added = changedPoints({
      tienda: 'oncity',
      observations: [
        { serie: 'contado', kind: 'falla' },
        { serie: 'visa:12', kind: 'ok', data: { total: 1, cuota: 1, n: 12 } },
      ],
      previous,
      t: '2026-11-22T12:00:00Z',
    });
    assert.deepEqual(added.map((p) => p.serie), ['visa:12']);
  });
});
