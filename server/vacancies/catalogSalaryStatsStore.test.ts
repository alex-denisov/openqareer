import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  computeCatalogSalaryStats,
  readCatalogSalaryStats,
  writeCatalogSalaryStats,
} from './catalogSalaryStatsStore';

const hh = { field: 'hh.compensation.mode', value: 'MONTH' };

function catalog(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE catalog_entries (
    status TEXT, path TEXT, place_slug TEXT, role_slug TEXT, salary_label TEXT, cluster_id TEXT);
    CREATE TABLE vacancy_clusters (id TEXT PRIMARY KEY, cluster_json TEXT)`);
  const insert = database.prepare('INSERT INTO catalog_entries VALUES (?, ?, ?, ?, ?, ?)');
  const cluster = database.prepare('INSERT INTO vacancy_clusters VALUES (?, ?)');
  const add = (key: string, role: string | null, label: string, salary?: object) => {
    insert.run('active', `/vacancies/job/${key}`, 'moscow', role, label, key);
    cluster.run(key, JSON.stringify({ salary }));
  };
  for (let index = 0; index < 6; index += 1) {
    const to = (index + 11) * 10000;
    add(`m${index}`, 'accountant', `100 000 — ${to} ₽`, {
      from: 100000,
      to,
      currency: 'RUB',
      period: 'month',
      periodEvidence: hh,
    });
  }
  // A yearly figure without stated period must not enter the monthly median.
  add('u', 'accountant', '1 200 000 — 2 400 000 ₽', {
    from: 1200000,
    to: 2400000,
    currency: 'RUB',
  });
  add('x', null, 'от 90 000 ₽', {
    from: 90000,
    currency: 'RUB',
    period: 'month',
    periodEvidence: hh,
  });
  insert.run('expired', '/vacancies/job/y', 'moscow', 'accountant', '1 — 2 ₽', 'y');
  return database;
}

describe('catalog salary stats store (B569)', () => {
  it('counts each list once in maintenance and reads one list by key', () => {
    const database = catalog();
    const stats = computeCatalogSalaryStats(database);
    expect(stats.get('moscow|accountant')).toMatchObject({ withSalary: 7, withRange: 6 });
    expect(stats.get('moscow|accountant')?.groups).toEqual([
      { currency: 'RUB', period: 'month', sample: 6, median: 118000, low: 111000, high: 124000 },
    ]);
    expect(stats.get('moscow')).toMatchObject({ withSalary: 8, withRange: 6 });
    writeCatalogSalaryStats(database, stats, new Date('2026-10-28T00:00:00Z'));
    expect(
      readCatalogSalaryStats(database, { place: 'moscow', role: 'accountant' })?.withSalary,
    ).toBe(7);
    expect(readCatalogSalaryStats(database, { place: 'kazan' })).toBeUndefined();
  });

  it('is empty before the catalog and before the first maintenance pass', () => {
    const empty = new DatabaseSync(':memory:');
    expect(computeCatalogSalaryStats(empty).size).toBe(0);
    expect(readCatalogSalaryStats(empty, { place: 'moscow' })).toBeUndefined();
  });

  it('marks a list whose role has a prepared /salaries page', () => {
    const database = catalog();
    database.exec('CREATE TABLE salary_market_index (id INTEGER PRIMARY KEY, payload TEXT)');
    database
      .prepare('INSERT INTO salary_market_index VALUES (1, ?)')
      .run(JSON.stringify([{ role: 'accountant' }]));
    const stats = computeCatalogSalaryStats(database);
    expect(stats.get('moscow|accountant')?.salaryPage).toBe(true);
    expect(stats.get('moscow')?.salaryPage).toBeUndefined();
  });
});
