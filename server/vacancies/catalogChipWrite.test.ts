import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchWriteHolds } from '../observability/sqliteWriteHolds';
import {
  readCatalogChipCounts,
  readCatalogChipKeys,
  writeCatalogChips,
  type ChipEntry,
  type ChipSnapshot,
} from './catalogChipStore';

const NOW = Date.parse('2026-11-05T00:00:00Z');
const entry = (entryKey: string, listKey = 'moscow'): ChipEntry => ({
  listKey,
  chip: 'salary',
  publishedMs: NOW - 1000,
  entryKey,
});
const snapshot = (entries: readonly ChipEntry[]): ChipSnapshot => {
  const totals = new Map<string, number>();
  for (const row of entries) totals.set(row.listKey, (totals.get(row.listKey) ?? 0) + 1);
  return {
    entries,
    counts: new Map(Array.from(totals, ([key, salary]) => [key, { salary }])),
  };
};
const keysOf = (database: DatabaseSync, listKey = 'moscow') =>
  readCatalogChipKeys(database, { listKey, chip: 'salary', limit: 100 }, NOW)
    .map((row) => row.entryKey)
    .sort();

const unwatch: Array<() => void> = [];
afterEach(() => unwatch.splice(0).forEach((stop) => stop()));
function afterEachCommit(onCommit: () => void): void {
  unwatch.push(watchWriteHolds(onCommit, 0));
}

describe('catalog chips are written as a difference in short transactions (PRB-041)', () => {
  it('an unchanged catalog writes nothing', () => {
    const database = new DatabaseSync(':memory:');
    const rows = snapshot([entry('a'), entry('b')]);
    writeCatalogChips(database, rows, new Date(NOW));
    const commit = vi.fn();
    afterEachCommit(commit);

    const report = writeCatalogChips(database, rows, new Date(NOW + 1000));

    expect(commit).not.toHaveBeenCalled();
    expect(report).toEqual({
      entriesAdded: 0,
      entriesRemoved: 0,
      countsChanged: 0,
      transactions: 0,
    });
  });

  it('applies only the difference, including a list that disappeared', () => {
    const database = new DatabaseSync(':memory:');
    writeCatalogChips(
      database,
      snapshot([entry('a'), entry('b'), entry('x', 'kazan')]),
      new Date(NOW),
    );

    const report = writeCatalogChips(database, snapshot([entry('b'), entry('c')]), new Date(NOW));

    expect(keysOf(database)).toEqual(['b', 'c']);
    expect(keysOf(database, 'kazan')).toEqual([]);
    expect(readCatalogChipCounts(database, 'moscow')).toEqual({ salary: 2 });
    expect(readCatalogChipCounts(database, 'kazan')).toEqual({});
    expect(report).toMatchObject({ entriesAdded: 1, entriesRemoved: 2, countsChanged: 1 });
  });

  it('commits at the budget and pauses between transactions, not after the last', () => {
    const database = new DatabaseSync(':memory:');
    const pause = vi.fn();

    const report = writeCatalogChips(database, snapshot([entry('a'), entry('b')]), new Date(NOW), {
      budgetMs: 0,
      pause,
    });

    expect(report.transactions).toBe(3);
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it('a reader never finds a kept entry missing while the write goes', () => {
    const database = new DatabaseSync(':memory:');
    writeCatalogChips(database, snapshot([entry('kept'), entry('gone')]), new Date(NOW));
    const views: string[][] = [];
    afterEachCommit(() => views.push(keysOf(database)));

    writeCatalogChips(database, snapshot([entry('kept'), entry('new')]), new Date(NOW), {
      budgetMs: 0,
      pause: () => undefined,
    });

    expect(views.length).toBeGreaterThan(1);
    expect(views.every((keys) => keys.includes('kept'))).toBe(true);
    expect(views.at(-1)).toEqual(['kept', 'new']);
  });

  it('a pass that failed between transactions is finished by the next one', () => {
    const database = new DatabaseSync(':memory:');
    const wanted = snapshot([entry('a'), entry('b'), entry('c')]);
    const failing = () => {
      throw new Error('crash between transactions');
    };

    expect(() =>
      writeCatalogChips(database, wanted, new Date(NOW), { budgetMs: 0, pause: failing }),
    ).toThrow('crash');
    expect(keysOf(database)).toEqual(['a']);

    writeCatalogChips(database, wanted, new Date(NOW));

    expect(keysOf(database)).toEqual(['a', 'b', 'c']);
    expect(readCatalogChipCounts(database, 'moscow')).toEqual({ salary: 3 });
  });
});
