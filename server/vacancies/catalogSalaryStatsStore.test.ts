import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  computeCatalogSalaryStats,
  readCatalogSalaryStats,
  writeCatalogSalaryStats,
} from './catalogSalaryStatsStore';

function catalog(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE catalog_entries (
    status TEXT, path TEXT, place_slug TEXT, role_slug TEXT, salary_label TEXT)`);
  const insert = database.prepare('INSERT INTO catalog_entries VALUES (?, ?, ?, ?, ?)');
  for (let index = 0; index < 6; index += 1) {
    insert.run(
      'active',
      `/vacancies/job/${index}`,
      'moscow',
      'accountant',
      `100 000 — 1${index + 1}0 000 ₽`,
    );
  }
  insert.run('active', '/vacancies/job/x', 'moscow', null, 'от 90 000 ₽');
  insert.run('expired', '/vacancies/job/y', 'moscow', 'accountant', '1 — 2 ₽');
  return database;
}

describe('catalog salary stats store (B569)', () => {
  it('counts each list once in maintenance and reads one list by key', () => {
    const database = catalog();
    const stats = computeCatalogSalaryStats(database);
    expect(stats.get('moscow|accountant')).toMatchObject({ withSalary: 6, withRange: 6 });
    expect(stats.get('moscow')).toMatchObject({ withSalary: 7, withRange: 6 });
    writeCatalogSalaryStats(database, stats, new Date('2026-10-28T00:00:00Z'));
    expect(
      readCatalogSalaryStats(database, { place: 'moscow', role: 'accountant' })?.withSalary,
    ).toBe(6);
    expect(readCatalogSalaryStats(database, { place: 'kazan' })).toBeUndefined();
  });

  it('is empty before the catalog and before the first maintenance pass', () => {
    const empty = new DatabaseSync(':memory:');
    expect(computeCatalogSalaryStats(empty).size).toBe(0);
    expect(readCatalogSalaryStats(empty, { place: 'moscow' })).toBeUndefined();
  });
});
