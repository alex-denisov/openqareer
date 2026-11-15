import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { replaceKeyedRowsInPortions } from './landingResultWrite';

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
