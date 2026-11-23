import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
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

/** Records the stored-snapshot reads with their bound parameters. */
function captureSnapshotReads(store: SqliteVacancyPoolStore) {
  const database = (store as unknown as { database: DatabaseSync }).database;
  const reads: Array<{ sql: string; params: unknown[] }> = [];
  const prepare = database.prepare.bind(database);
  database.prepare = ((sql: string) => {
    const statement = prepare(sql);
    if (!/^\s*SELECT id, payload FROM vacancy_pool/u.test(sql)) return statement;
    const all = statement.all.bind(statement);
    statement.all = ((...params: unknown[]) => {
      reads.push({ sql, params });
      return all(...(params as Parameters<typeof all>));
    }) as typeof statement.all;
    return statement;
  }) as DatabaseSync['prepare'];
  return { database, reads };
}

describe('B761: stored hh snapshots are read by primary key (prod: the source index walked 458k rows, 82 s of a 90 s profile)', () => {
  it('does not plan the snapshot read over vacancy_pool_source', () => {
    const store = new SqliteVacancyPoolStore({
      databasePath: join(mkdtempSync(join(tmpdir(), 'pool-existing-key-')), 'pool.db'),
    });
    stores.push(store);
    // A full write chunk: with ~800 bound ids SQLite's planner prefers the
    // source index over the key unless the read is written to avoid it.
    const ids = Array.from({ length: 900 }, (_, index) => `v${index}`);
    store.replaceSourceSlice(
      HH_SEARCH_SOURCE_ID,
      ids.map((id) => hhCard(id, id === 'v0' ? 'stored snippet' : '')),
    );
    const { database, reads } = captureSnapshotReads(store);

    store.replaceSourceSlice(
      HH_SEARCH_SOURCE_ID,
      ids.map((id) => hhCard(id, '')),
    );

    expect(reads.length).toBeGreaterThan(0);
    for (const { sql, params } of [...reads]) {
      const plan = database
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...(params as string[]))
        .map((row) => String((row as { detail: unknown }).detail));
      expect(plan.join(' | ')).not.toMatch(/vacancy_pool_source/u);
    }
    const stored = store.loadVacancies().find((vacancy) => vacancy.id === 'v0');
    expect(stored?.description).toBe('stored snippet');
  });
});
