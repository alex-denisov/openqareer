import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { WalLimitError } from '../data/windowedRead';
import { computeAndWriteLanding, replaceKeyedRowsInPortions } from './landingResultWrite';

function sourcesDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE catalog_sources (
    source_id TEXT PRIMARY KEY, vacancy_count INTEGER NOT NULL, computed_at TEXT NOT NULL) STRICT`);
  return database;
}

const TABLE = {
  table: 'catalog_sources',
  keyColumn: 'source_id',
  valueColumn: 'vacancy_count',
} as const;

describe('replaceKeyedRowsInPortions (B649-5)', () => {
  it('writes ~50 000 rows in portions, never all in one transaction', () => {
    const database = sourcesDatabase();
    const rows = Array.from({ length: 50_000 }, (_, i) => [`s${i}`, i] as const);
    const portions: number[] = [];
    const report = replaceKeyedRowsInPortions(database, TABLE, rows, '2026-11-15T00:00:00Z', {
      portion: 1_000,
      pause: () => undefined,
      onPortion: (size) => portions.push(size),
    });
    expect(report.written).toBe(50_000);
    expect(report.transactions).toBeGreaterThanOrEqual(50);
    expect(Math.max(...portions)).toBeLessThanOrEqual(1_000);
    const count = database.prepare('SELECT count(*) AS n FROM catalog_sources').get() as {
      n: number;
    };
    expect(count.n).toBe(50_000);
    database.close();
  });

  it('keeps old rows readable between portions and removes stale ones at the end', () => {
    const database = sourcesDatabase();
    const insert = database.prepare('INSERT INTO catalog_sources VALUES (?, ?, ?)');
    for (let i = 0; i < 3_000; i += 1) insert.run(`s${i}`, 1, '2026-11-14T00:00:00Z');
    const rows = Array.from({ length: 2_000 }, (_, i) => [`s${i}`, 2] as const);
    const seen: number[] = [];
    const report = replaceKeyedRowsInPortions(database, TABLE, rows, '2026-11-15T00:00:00Z', {
      portion: 500,
      pause: () => {
        const n = database.prepare('SELECT count(*) AS n FROM catalog_sources').get() as {
          n: number;
        };
        seen.push(n.n);
      },
    });
    // A reader between portions never sees an emptied table.
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(2_000);
    expect(report.removed).toBe(1_000);
    const left = database
      .prepare('SELECT count(*) AS n, min(vacancy_count) AS lo FROM catalog_sources')
      .get() as { n: number; lo: number };
    expect(left).toEqual({ n: 2_000, lo: 2 });
    database.close();
  });
});

function poolDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE vacancy_pool (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE vacancy_pool_index (id TEXT PRIMARY KEY, source_id TEXT NOT NULL,
      published_ms INTEGER, is_active INTEGER, is_remote INTEGER, expired INTEGER);`);
  const insertPool = database.prepare('INSERT INTO vacancy_pool VALUES (?, ?)');
  const insertIndex = database.prepare('INSERT INTO vacancy_pool_index VALUES (?, ?, ?, ?, ?, 0)');
  for (let index = 0; index < 12; index += 1) {
    const id = `v${index}`;
    const salary = { from: 200_000, to: 250_000, currency: 'RUR' };
    insertPool.run(id, JSON.stringify({ title: `Product Manager ${index}`, salary }));
    insertIndex.run(id, `src-${index % 4}`, 1_000 + index, index < 10 ? 1 : 0, index % 2);
  }
  return database;
}

const NOW = Date.parse('2026-11-23T20:00:00Z');
const FAST = { firstRows: 2, targetMs: 1e9, pause: () => undefined };

function storedLanding(database: DatabaseSync) {
  return {
    landing: database.prepare('SELECT payload FROM landing_stats').all(),
    sources: database.prepare('SELECT source_id, vacancy_count FROM catalog_sources').all(),
  };
}

describe('computeAndWriteLanding (B776)', () => {
  it('a WAL stop mid-read writes nothing: the landing keeps the previous full result', () => {
    const database = poolDatabase();
    computeAndWriteLanding(database, () => database, NOW, undefined, FAST);
    const before = storedLanding(database);
    expect(before.sources.length).toBeGreaterThan(0);
    database.exec('UPDATE vacancy_pool_index SET is_active = 1');
    let checks = 0;
    const guard = () => {
      checks += 1;
      if (checks === 3) throw new WalLimitError(1500);
    };
    const openWriter = vi.fn(() => database);
    expect(() =>
      computeAndWriteLanding(database, openWriter, NOW + 60_000, undefined, { ...FAST, guard }),
    ).toThrow(WalLimitError);
    expect(openWriter).not.toHaveBeenCalled();
    expect(storedLanding(database)).toEqual(before);
  });

  it('«Источники» and the landing totals come from one pass and agree', () => {
    const database = poolDatabase();
    const summary = computeAndWriteLanding(database, () => database, NOW, undefined, FAST);
    const sources = database
      .prepare('SELECT count(*) AS n, sum(vacancy_count) AS total FROM catalog_sources')
      .get() as { n: number; total: number };
    const landing = JSON.parse(
      (database.prepare('SELECT payload FROM landing_stats').get() as { payload: string }).payload,
    ) as { activeCount: number; sourceCount: number };
    expect(summary.active).toBe(10);
    expect(landing.activeCount).toBe(sources.total);
    expect(landing.sourceCount).toBe(sources.n);
  });
});
