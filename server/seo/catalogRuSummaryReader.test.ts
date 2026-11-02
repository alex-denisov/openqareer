import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { CATALOG_RU_SUMMARY_VERSION, catalogSummarySourceHash } from './catalogRuSummary';
import { closeCatalogRuSummaryReaders, readCatalogRuSummary } from './catalogRuSummaryReader';
import { CatalogRuSummaryStore } from './catalogRuSummaryStore';

const summary = { text: 'Первое. Второе.', facts: { role: 'Бухгалтер' } };
let directory: string | undefined;

function databaseWith(rows: (store: CatalogRuSummaryStore) => void): string {
  directory = mkdtempSync(join(tmpdir(), 'ru-summary-'));
  const path = join(directory, 'db.sqlite');
  const database = new DatabaseSync(path);
  const store = new CatalogRuSummaryStore(database);
  store.ensureTable();
  rows(store);
  database.close();
  return path;
}

afterEach(() => {
  closeCatalogRuSummaryReaders();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('readCatalogRuSummary', () => {
  it('shows and counts the summary only for the text it was written from', () => {
    const path = databaseWith((store) =>
      store.saveReady(
        'cluster-a',
        catalogSummarySourceHash('Бухгалтер', 'текст'),
        CATALOG_RU_SUMMARY_VERSION,
        summary,
        'm',
        1,
      ),
    );
    expect(
      readCatalogRuSummary(path, {
        clusterId: 'cluster-a',
        title: 'Бухгалтер',
        description: 'текст',
      }),
    ).toEqual({
      described: true,
      summary,
    });
    expect(
      readCatalogRuSummary(path, {
        clusterId: 'cluster-a',
        title: 'Бухгалтер',
        description: 'новый текст',
      }),
    ).toEqual({
      described: false,
    });
    expect(
      readCatalogRuSummary(path, {
        clusterId: 'cluster-b',
        title: 'Бухгалтер',
        description: 'текст',
      }),
    ).toEqual({
      described: false,
    });
  });

  it('reads nothing before the table exists', () => {
    directory = mkdtempSync(join(tmpdir(), 'ru-summary-'));
    const empty = join(directory, 'empty.sqlite');
    new DatabaseSync(empty).close();
    expect(readCatalogRuSummary(empty, { clusterId: 'x', title: 't', description: 'd' })).toEqual({
      described: false,
    });
  });
});
