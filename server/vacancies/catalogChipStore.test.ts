import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  computeCatalogChips,
  readCatalogChipCounts,
  readCatalogChipKeys,
  writeCatalogChips,
} from './catalogChipStore';
import { chipMatches, parseListingChip } from './catalogChips';

const NOW = Date.parse('2026-10-28T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function catalog(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE catalog_entries (
    entry_key TEXT, status TEXT, path TEXT, place_slug TEXT, role_slug TEXT, is_remote INTEGER,
    salary_label TEXT, title TEXT, summary TEXT, published_ms INTEGER)`);
  const insert = database.prepare(
    'INSERT INTO catalog_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const row = (key: string, values: Partial<Record<string, unknown>>) =>
    insert.run(
      key,
      (values.status as string) ?? 'active',
      `/vacancies/job/${key}`,
      'moscow',
      'accountant',
      (values.remote as number) ?? 0,
      (values.salary as string | null) ?? null,
      'Бухгалтер',
      (values.summary as string) ?? 'Ведение учёта',
      (values.published as number) ?? NOW - 10 * DAY,
    );
  row('a', { salary: '120 000 — 140 000 ₽', published: NOW - DAY });
  row('b', { salary: 'до 90 000 ₽', remote: 1 });
  row('c', { summary: 'Гибридный формат, опыт не требуется' });
  row('d', { summary: 'Помощь с релокацией в Белград' });
  row('e', { salary: '200 000 ₽', status: 'archived' });
  return database;
}

describe('catalog chips (B574)', () => {
  it('decides each chip from the stored fields only', () => {
    const base = { isRemote: false, title: 'Бухгалтер', summary: '', publishedMs: NOW };
    expect(chipMatches('from-100k', { ...base, salaryLabel: '80 000 — 100 000 ₽' }, NOW)).toBe(
      true,
    );
    expect(chipMatches('from-100k', { ...base, salaryLabel: 'до 90 000 ₽' }, NOW)).toBe(false);
    expect(chipMatches('from-100k', { ...base, salaryLabel: '300 000 ₸' }, NOW)).toBe(false);
    expect(chipMatches('fresh', { ...base, publishedMs: NOW - 4 * DAY }, NOW)).toBe(false);
    expect(parseListingChip('salary')).toBe('salary');
    expect(parseListingChip('relocation')).toBeUndefined();
    expect(parseListingChip(['salary'])).toBeUndefined();
  });

  it('counts chips per list in maintenance and pages them by key', () => {
    const database = catalog();
    const snapshot = computeCatalogChips(database, NOW);
    writeCatalogChips(database, snapshot, new Date(NOW));
    expect(readCatalogChipCounts(database, 'moscow|accountant')).toEqual({
      salary: 2,
      'from-100k': 1,
      remote: 2,
      fresh: 1,
      'no-experience': 1,
    });
    expect(readCatalogChipCounts(database, '')).toEqual({ relocation: 1 });
    const keys = readCatalogChipKeys(
      database,
      { listKey: 'moscow', chip: 'salary', limit: 1 },
      NOW,
    );
    expect(keys.map((key) => key.entryKey)).toEqual(['a']);
    const next = readCatalogChipKeys(
      database,
      {
        listKey: 'moscow',
        chip: 'salary',
        limit: 5,
        after: { publishedMs: keys[0]!.publishedMs, key: keys[0]!.entryKey },
      },
      NOW,
    );
    expect(next.map((key) => key.entryKey)).toEqual(['b']);
  });

  it('re-checks «За последние 3 дня» against the clock at read time', () => {
    const database = catalog();
    writeCatalogChips(database, computeCatalogChips(database, NOW), new Date(NOW));
    const later = NOW + 3 * DAY;
    expect(
      readCatalogChipKeys(database, { listKey: 'moscow', chip: 'fresh', limit: 5 }, later),
    ).toEqual([]);
  });

  it('reads nothing before the first maintenance pass', () => {
    const empty = new DatabaseSync(':memory:');
    expect(computeCatalogChips(empty, NOW).entries).toEqual([]);
    expect(readCatalogChipCounts(empty, 'moscow')).toEqual({});
    expect(
      readCatalogChipKeys(empty, { listKey: 'moscow', chip: 'salary', limit: 5 }, NOW),
    ).toEqual([]);
  });
});
