import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  nextWindowRows,
  readInWindows,
  walLimitGuard,
  WalLimitError,
} from './windowedRead';

function tableOf(count: number): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE items (id TEXT PRIMARY KEY, active INTEGER NOT NULL) STRICT');
  const insert = database.prepare('INSERT INTO items (id, active) VALUES (?, ?)');
  for (let index = 0; index < count; index += 1) insert.run(`id-${index}`, index % 2);
  return database;
}

const QUERY = {
  table: 'items',
  sql: 'SELECT id FROM items NOT INDEXED WHERE rowid > ? AND rowid <= ? AND active = ?',
  params: [1],
};

let folder: string | undefined;

afterEach(() => {
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = undefined;
});

describe('readInWindows', () => {
  it('reads every row once, a window per statement, with a pause and a guard between', () => {
    const database = tableOf(10);
    const pause = vi.fn();
    const guard = vi.fn();
    const seen: string[] = [];
    const windows = readInWindows<{ id: string }>(
      database,
      QUERY,
      (rows) => seen.push(...rows.map((row) => row.id)),
      { firstRows: 3, targetMs: 1e9, pause, guard },
    );
    expect(seen).toEqual(['id-1', 'id-3', 'id-5', 'id-7', 'id-9']);
    expect(windows).toBeGreaterThan(1);
    expect(guard).toHaveBeenCalledTimes(windows);
    expect(pause).toHaveBeenCalledTimes(windows - 1);
  });

  it('reads nothing from an empty table', () => {
    const onRows = vi.fn();
    expect(readInWindows(tableOf(0), QUERY, onRows, { pause: vi.fn() })).toBe(0);
    expect(onRows).not.toHaveBeenCalled();
  });

  it('stops when the guard throws: a heavy read is cut off', () => {
    const database = tableOf(10);
    let calls = 0;
    const guard = () => {
      calls += 1;
      if (calls === 2) throw new WalLimitError(2048);
    };
    const onRows = vi.fn();
    expect(() =>
      readInWindows(database, QUERY, onRows, { firstRows: 2, targetMs: 1e9, guard, pause: vi.fn() }),
    ).toThrow(WalLimitError);
    expect(onRows).toHaveBeenCalledOnce();
  });

  it('reads the table by rowid range, not by an index', () => {
    const database = tableOf(1);
    database.exec('CREATE INDEX items_active ON items(active)');
    const plan = database
      .prepare(`EXPLAIN QUERY PLAN ${QUERY.sql}`)
      .all(0, 10, 1) as { detail: string }[];
    expect(plan.map((row) => row.detail).join(' ')).toMatch(/INTEGER PRIMARY KEY \(rowid>\? AND rowid<\?\)/u);
  });
});

describe('nextWindowRows', () => {
  it('halves a slow window, doubles a fast one, keeps a fitting one', () => {
    expect(nextWindowRows(2000, 1500, 1000)).toBe(1000);
    expect(nextWindowRows(2000, 100, 1000)).toBe(4000);
    expect(nextWindowRows(2000, 600, 1000)).toBe(2000);
    expect(nextWindowRows(100, 5000, 1000)).toBe(100);
  });
});

describe('walLimitGuard', () => {
  it('throws once the WAL file is over the limit, passes below it and without a file', () => {
    folder = mkdtempSync(join(tmpdir(), 'wal-guard-'));
    const path = join(folder, 'db.sqlite');
    expect(() => walLimitGuard(path, 1)()).not.toThrow();
    writeFileSync(`${path}-wal`, Buffer.alloc(512 * 1024));
    expect(() => walLimitGuard(path, 1)()).not.toThrow();
    writeFileSync(`${path}-wal`, Buffer.alloc(2 * 1024 * 1024));
    expect(() => walLimitGuard(path, 1)()).toThrow(WalLimitError);
    expect(() => walLimitGuard(null, 1)()).not.toThrow();
  });
});
