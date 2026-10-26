import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  computeCatalogSources,
  getCatalogSources,
  readCatalogSources,
  setCatalogSources,
  writeCatalogSources,
} from './catalogSources';

function pool(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(
    'CREATE TABLE vacancy_pool_index (id TEXT PRIMARY KEY, source_id TEXT, is_active INTEGER, expired INTEGER)',
  );
  const insert = database.prepare('INSERT INTO vacancy_pool_index VALUES (?, ?, ?, ?)');
  insert.run('a', 'src-hh-search', 1, 0);
  insert.run('b', 'src-hh-search', 1, 0);
  insert.run('c', 'ats-greenhouse-stripe', 1, 0);
  insert.run('d', 'ats-lever-old', 1, 1);
  return database;
}

/** CPO 26.10: фильтр «Источники» показывал 35 из 322 живых источников пула. */
describe('catalog sources', () => {
  it('counts every live source in maintenance and reads them back by table', () => {
    const database = pool();
    expect(readCatalogSources(database)).toEqual([]);
    const rows = computeCatalogSources(database);
    expect(rows).toEqual([
      { sourceId: 'src-hh-search', count: 2 },
      { sourceId: 'ats-greenhouse-stripe', count: 1 },
    ]);
    writeCatalogSources(database, rows, new Date('2026-10-26T00:00:00Z'));
    expect(readCatalogSources(database)).toEqual(rows);
  });

  it('keeps the last known list when a refresh brings nothing', () => {
    setCatalogSources([{ sourceId: 'src-indeed', count: 5 }]);
    setCatalogSources([]);
    expect(getCatalogSources()).toEqual([{ sourceId: 'src-indeed', count: 5 }]);
  });
});
