import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import { HH_SEARCH_SOURCE_ID } from './hhSearchState';

const stores: SqliteVacancyPoolStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function hhCard(id: string, description: string) {
  return {
    id,
    fingerprint: `fp-${id}`,
    title: 'Role',
    company: 'Company',
    description,
    requiredSkills: [],
    url: `https://hh.ru/vacancy/${id}`,
    provenance: {
      sourceType: 'json_api' as const,
      sourceId: HH_SEARCH_SOURCE_ID,
      sourceUrl: `https://hh.ru/vacancy/${id}`,
      observedAt: '2026-09-01T10:00:00.000Z',
    },
    publishedAt: '2026-09-01T10:00:00.000Z',
    status: 'active' as const,
  };
}

/** Wraps the store's connection so a test sees when stored payloads are read. */
function watchPayloadReads(store: SqliteVacancyPoolStore, afterRead: (db: DatabaseSync) => void) {
  const database = (store as unknown as { database: DatabaseSync }).database;
  const inTransaction: boolean[] = [];
  const prepare = database.prepare.bind(database);
  database.prepare = ((sql: string) => {
    const statement = prepare(sql);
    if (!/SELECT id, payload FROM vacancy_pool/u.test(sql)) return statement;
    const all = statement.all.bind(statement);
    statement.all = ((...params: Parameters<StatementSync['all']>) => {
      inTransaction.push(database.isTransaction);
      const rows = all(...params);
      afterRead(database);
      return rows;
    }) as StatementSync['all'];
    return statement;
  }) as DatabaseSync['prepare'];
  return { inTransaction };
}

function openStore(writeBudgetMs?: number) {
  const store = new SqliteVacancyPoolStore({
    databasePath: join(mkdtempSync(join(tmpdir(), 'pool-upsert-read-')), 'pool.db'),
    writeBudgetMs,
  });
  stores.push(store);
  return store;
}

const descriptionOf = (store: SqliteVacancyPoolStore, id: string) =>
  store.loadVacancies().find((vacancy) => vacancy.id === id);

describe('hh upsert reads stored snapshots before the write lock (PRB-041: one row held the lock 11–18 s)', () => {
  it('reads and merges stored hh payloads outside BEGIN IMMEDIATE', async () => {
    const store = openStore();
    store.replaceSourceSlice(HH_SEARCH_SOURCE_ID, [hhCard('a', 'stored snippet'), hhCard('b', '')]);
    const { inTransaction } = watchPayloadReads(store, () => undefined);

    await store.replaceSourceSliceAsync?.(HH_SEARCH_SOURCE_ID, [hhCard('a', ''), hhCard('b', '')]);

    expect(inTransaction.length).toBeGreaterThan(0);
    expect(inTransaction.every((flag) => !flag)).toBe(true);
    expect(descriptionOf(store, 'a')?.description).toBe('stored snippet');
  });

  it('reads a chunk once even when the time budget splits it into one-row transactions', () => {
    const store = openStore(0);
    const ids = ['a', 'b', 'c', 'd'];
    store.replaceSourceSlice(
      HH_SEARCH_SOURCE_ID,
      ids.map((id) => hhCard(id, `snippet ${id}`)),
    );
    const { inTransaction } = watchPayloadReads(store, () => undefined);

    store.replaceSourceSlice(
      HH_SEARCH_SOURCE_ID,
      ids.map((id) => hhCard(id, '')),
    );

    expect(inTransaction).toEqual([false]);
    expect(descriptionOf(store, 'd')?.description).toBe('snippet d');
  });

  it('keeps full text another writer stored between the read and the write', () => {
    const store = openStore();
    store.replaceSourceSlice(HH_SEARCH_SOURCE_ID, [hhCard('a', 'stored snippet')]);
    let written = false;
    watchPayloadReads(store, (database) => {
      if (written) return;
      written = true;
      const row = database.prepare('SELECT payload FROM vacancy_pool WHERE id = ?').get('a') as {
        payload: string;
      };
      const loaded = { ...JSON.parse(row.payload), fullDescription: 'loaded full text' };
      database
        .prepare('UPDATE vacancy_pool SET payload = ? WHERE id = ?')
        .run(JSON.stringify(loaded), 'a');
    });

    store.replaceSourceSlice(HH_SEARCH_SOURCE_ID, [hhCard('a', '')]);

    expect(descriptionOf(store, 'a')).toMatchObject({
      description: 'stored snippet',
      fullDescription: 'loaded full text',
    });
  });
});
