import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  computeMarketSalaryEstimates,
  writeMarketSalaryEstimates,
} from './marketSalaryEstimateJob';
import { SqliteMarketSalaryEstimateStore } from './sqliteMarketSalaryEstimateStore';

interface Row {
  readonly id: string;
  readonly functionCode: string;
  readonly levelRank: number | null;
  readonly location: string;
  readonly salary?: { from?: number; to?: number; currency?: string };
  readonly expired?: boolean;
}

function poolDatabase(rows: readonly Row[]): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE vacancy_pool (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE vacancy_pool_index (id TEXT PRIMARY KEY, is_active INTEGER NOT NULL, expired INTEGER NOT NULL);
    CREATE TABLE vacancy_semantic (id TEXT NOT NULL, function_code TEXT NOT NULL, level_rank INTEGER,
      PRIMARY KEY (id, function_code));`);
  for (const row of rows) {
    database
      .prepare('INSERT INTO vacancy_pool VALUES (?, ?)')
      .run(row.id, JSON.stringify({ location: row.location, salary: row.salary ?? null }));
    database
      .prepare('INSERT INTO vacancy_pool_index VALUES (?, 1, ?)')
      .run(row.id, row.expired ? 1 : 0);
    database
      .prepare('INSERT INTO vacancy_semantic VALUES (?, ?, ?)')
      .run(row.id, row.functionCode, row.levelRank);
  }
  return database;
}

const moscow = (index: number, from: number, to: number): Row => ({
  id: `m${index}`,
  functionCode: 'it-eng-mgmt',
  levelRank: 4,
  location: 'Москва',
  salary: { from, to, currency: 'RUR' },
});

describe('computeMarketSalaryEstimates', () => {
  it('groups salaried live vacancies by function, level and place', () => {
    const rows = [
      moscow(1, 400_000, 500_000),
      moscow(2, 450_000, 550_000),
      moscow(3, 500_000, 600_000),
      moscow(4, 520_000, 620_000),
      moscow(5, 600_000, 700_000),
      { ...moscow(6, 900_000, 900_000), expired: true },
      { ...moscow(7, 0, 0), salary: undefined },
      { ...moscow(8, 100, 200), salary: { from: 5_000, to: 6_000, currency: 'USD' } },
      { ...moscow(9, 300_000, 400_000), location: 'Казань' },
    ];
    const estimates = computeMarketSalaryEstimates(poolDatabase(rows));
    // midpoints 450 500 550 570 650 → p25 500, p75 570
    expect(estimates.get('it-eng-mgmt|4|city|москва')).toEqual({
      low: 500_000,
      high: 570_000,
      currency: 'RUR',
      sampleSize: 5,
    });
    expect(estimates.get('it-eng-mgmt|4|city|казань')).toEqual({ currency: 'RUR', sampleSize: 1 });
    expect(estimates.get('it-eng-mgmt|4|region|ru')?.sampleSize).toBe(6);
  });
});

describe('SqliteMarketSalaryEstimateStore', () => {
  it('reads the written batch by key with the date of the cut', () => {
    const database = poolDatabase([]);
    const estimates = new Map([
      [
        'it-eng-mgmt|4|city|москва',
        { low: 480_000, high: 560_000, currency: 'RUR', sampleSize: 41 },
      ],
      ['it-eng-mgmt|4|region|russia', { currency: 'RUR', sampleSize: 3 }],
    ]);
    const now = new Date('2026-10-05T03:00:00.000Z');
    writeMarketSalaryEstimates(database, estimates, now);
    const store = new SqliteMarketSalaryEstimateStore({ database });
    expect(store.get('it-eng-mgmt|4|city|москва')).toEqual({
      low: 480_000,
      high: 560_000,
      currency: 'RUR',
      sampleSize: 41,
      computedAt: now.toISOString(),
    });
    expect(store.get('it-eng-mgmt|4|region|russia')).toEqual({
      currency: 'RUR',
      sampleSize: 3,
      computedAt: now.toISOString(),
    });
    expect(store.get('missing')).toBeUndefined();
  });

  it('answers undefined before the maintenance process has written anything', () => {
    const store = new SqliteMarketSalaryEstimateStore({ database: new DatabaseSync(':memory:') });
    expect(store.get('it-eng-mgmt|4|city|москва')).toBeUndefined();
  });
});
