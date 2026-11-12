import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteVacancyPoolStore, type PoolWriteEvent } from './sqliteVacancyPoolStore';

const directories: string[] = [];
const stores: SqliteVacancyPoolStore[] = [];
const databases: DatabaseSync[] = [];

afterEach(() => {
  databases.splice(0).forEach((database) => database.close());
  stores.splice(0).forEach((store) => store.close());
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

function openStore(options: { writeBudgetMs?: number; writeChunkSize?: number } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'pool-prune-'));
  directories.push(directory);
  const path = join(directory, 'pool.db');
  const events: PoolWriteEvent[] = [];
  const store = new SqliteVacancyPoolStore({
    databasePath: path,
    onWrite: (event) => events.push(event),
    ...options,
  });
  stores.push(store);
  const seed = new DatabaseSync(path);
  databases.push(seed);
  return { store, events, seed };
}

function seedPool(seed: DatabaseSync, sourceId: string, count: number, prefix: string): void {
  const insert = seed.prepare(
    `INSERT INTO vacancy_pool (id, source_id, published_at, stored_at, payload) VALUES (?, ?, ?, ?, '{}')`,
  );
  for (let index = 0; index < count; index += 1) {
    insert.run(`${prefix}${index}`, sourceId, '2026-09-01T10:00:00.000Z', Date.now());
  }
}

function seedOrphanIndex(seed: DatabaseSync, count: number): void {
  const insert = seed.prepare(
    `INSERT INTO vacancy_pool_index (id, source_id, published_ms, is_active, url, search_text, expired)
     VALUES (?, 'board', ?, 1, '', '', 0)`,
  );
  for (let index = 0; index < count; index += 1) insert.run(`orphan${index}`, Date.now());
}

function countOf(seed: DatabaseSync, table: string): number {
  return Number((seed.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n);
}

function pruneReports(events: readonly PoolWriteEvent[]) {
  return events.flatMap((event) => (event.kind === 'prune' ? [event] : []));
}

/** Records, for every row-reading call on the store's connection, whether a write lock was held. */
function watchReads(store: SqliteVacancyPoolStore) {
  const database = (store as unknown as { database: DatabaseSync }).database;
  const inTransaction: boolean[] = [];
  const prepare = database.prepare.bind(database);
  database.prepare = ((sql: string) => {
    const statement = prepare(sql);
    const all = statement.all.bind(statement);
    statement.all = ((...params: Parameters<StatementSync['all']>) => {
      inTransaction.push(database.isTransaction);
      return all(...params);
    }) as StatementSync['all'];
    return statement;
  }) as DatabaseSync['prepare'];
  return inTransaction;
}

describe('pool prune at worker start (PRB-041: one transaction held the write lock 6.9 s)', () => {
  it('finds the rows before taking the write lock', () => {
    const { store, seed } = openStore();
    seedPool(seed, 'gone', 3, 'g');
    seedOrphanIndex(seed, 3);
    const inTransaction = watchReads(store);

    store.prune(['board'], '2026-08-01T00:00:00.000Z');

    expect(inTransaction.length).toBeGreaterThan(0);
    expect(inTransaction.every((flag) => !flag)).toBe(true);
  });

  it('removes in transactions of at most one chunk', () => {
    const { store, events, seed } = openStore({ writeChunkSize: 10 });
    seedPool(seed, 'gone', 25, 'g');

    store.prune(['board'], '2026-08-01T00:00:00.000Z');

    expect(countOf(seed, 'vacancy_pool')).toBe(0);
    expect(pruneReports(events)).toEqual([
      expect.objectContaining({ scope: 'pool', removed: 25, transactions: 3 }),
    ]);
  });

  it('commits a transaction once the time budget is spent', () => {
    const { store, events, seed } = openStore({ writeBudgetMs: 0 });
    seedPool(seed, 'gone', 4, 'g');

    store.prune(['board'], '2026-08-01T00:00:00.000Z');

    expect(pruneReports(events)[0]).toMatchObject({ removed: 4, transactions: 4 });
  });

  it('keeps an index row whose vacancy was written after the read', () => {
    const { store, seed } = openStore();
    seedOrphanIndex(seed, 1);
    const database = (store as unknown as { database: DatabaseSync }).database;
    const prepare = database.prepare.bind(database);
    let written = false;
    database.prepare = ((sql: string) => {
      const statement = prepare(sql);
      if (!/LEFT JOIN vacancy_pool p/u.test(sql)) return statement;
      const all = statement.all.bind(statement);
      statement.all = ((...params: Parameters<StatementSync['all']>) => {
        const rows = all(...params);
        if (!written) {
          written = true;
          seedPool(seed, 'board', 1, 'orphan');
        }
        return rows;
      }) as StatementSync['all'];
      return statement;
    }) as DatabaseSync['prepare'];

    store.prune(['board'], '2026-08-01T00:00:00.000Z');

    expect(countOf(seed, 'vacancy_pool_index')).toBe(1);
  });

  it('removes clusters and orphan keys the same way and returns the cluster count', () => {
    const { store, events, seed } = openStore({ writeChunkSize: 2 });
    const cluster = seed.prepare(
      `INSERT INTO vacancy_clusters (id, fingerprint, title, company, cluster_json, items_count, updated_at)
       VALUES (?, ?, 'T', 'C', '{}', 1, 1)`,
    );
    for (const id of ['c1', 'c2', 'c3']) cluster.run(id, id);
    seed
      .prepare(`INSERT INTO vacancy_cluster_keys (kind, key, cluster_id) VALUES ('k', ?, 'lost')`)
      .run('a');

    const removed = store.pruneClustersBefore('2026-08-01T00:00:00.000Z');

    expect(removed).toBe(3);
    expect(countOf(seed, 'vacancy_clusters')).toBe(0);
    expect(countOf(seed, 'vacancy_cluster_keys')).toBe(0);
    expect(pruneReports(events)[0]).toMatchObject({ scope: 'clusters', removed: 4 });
    expect(pruneReports(events)[0]?.transactions).toBeGreaterThanOrEqual(3);
  });

  it('still retires at most one bounded portion per pass', () => {
    const { store, seed } = openStore();
    seedPool(seed, 'gone', 1001, 'g');

    store.prune(['board'], '2026-08-01T00:00:00.000Z');

    expect(countOf(seed, 'vacancy_pool')).toBe(1);
  });
});

describe('B643 side tables follow the pool', () => {
  it('removes vacancy_company rows whose vacancy left the index', () => {
    const { store, seed } = openStore();
    seed
      .prepare(
        `INSERT INTO vacancy_company (vacancy_id, company_key, match_how, linked_at) VALUES ('gone', 'stripe', 'name_exact', 1)`,
      )
      .run();
    seed
      .prepare(
        `INSERT INTO vacancy_company (vacancy_id, company_key, match_how, linked_at) VALUES ('kept', 'stripe', 'name_exact', 1)`,
      )
      .run();
    seed
      .prepare(
        `INSERT INTO vacancy_pool_index (id, source_id, published_ms, is_active, url, search_text, expired) VALUES ('kept', 'board', ?, 1, '', '', 0)`,
      )
      .run(Date.now());
    seedPool(seed, 'board', 1, 'kept');
    seed.prepare(`UPDATE vacancy_pool SET id='kept' WHERE id='kept0'`).run();
    store.prune(['board'], '2026-08-01T00:00:00.000Z');
    expect(seed.prepare('SELECT vacancy_id FROM vacancy_company').all()).toEqual([
      { vacancy_id: 'kept' },
    ]);
  });
});

describe('prune with more known sources than SQLite variables (prod 12.11: too many SQL variables)', () => {
  const manySources = (extra: readonly string[]) => [
    ...Array.from({ length: 40_000 }, (_, index) => `ats:company-${index}`),
    ...extra,
  ];

  it('prunes unknown sources and keeps every known one', () => {
    const { store, seed } = openStore();
    seedPool(seed, 'ats:company-39999', 2, 'k');
    seedPool(seed, 'board', 2, 'b');
    seedPool(seed, 'gone', 3, 'g');
    store.prune(manySources(['board']), '2026-01-01T00:00:00.000Z');
    const left = seed
      .prepare('SELECT source_id AS s, count(*) AS n FROM vacancy_pool GROUP BY s ORDER BY s')
      .all();
    expect(left).toEqual([
      { s: 'ats:company-39999', n: 2 },
      { s: 'board', n: 2 },
    ]);
  });

  it('removes nothing when the known list is empty', () => {
    const { store, seed } = openStore();
    seedPool(seed, 'board', 2, 'b');
    store.prune([], '2026-01-01T00:00:00.000Z');
    expect(countOf(seed, 'vacancy_pool')).toBe(2);
  });

  it('skips unknown-source removal when the registry is half loaded', () => {
    const { store, seed, events } = openStore();
    const ids = Array.from({ length: 10 }, (_, index) => `s${index}`);
    const state = seed.prepare('INSERT INTO vacancy_source_state (source_id) VALUES (?)');
    ids.forEach((id) => {
      state.run(id);
      seedPool(seed, id, 1, `${id}-`);
    });
    store.prune(ids.slice(0, 5), '2026-01-01T00:00:00.000Z');
    expect(countOf(seed, 'vacancy_pool')).toBe(10);
    expect(countOf(seed, 'vacancy_source_state')).toBe(10);
    expect(pruneReports(events).at(-1)?.unknownSkipped).toEqual({ known: 5, stateSources: 10 });
    store.prune(ids, '2026-01-01T00:00:00.000Z');
    expect(countOf(seed, 'vacancy_pool')).toBe(10);
  });

  it('reads unseen links for that many sources', () => {
    const { store } = openStore();
    expect(store.loadUnseenLinks(manySources([]), Date.now(), 10)).toEqual([]);
  });
});
