import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';

const directories: string[] = [];
const stores: SqliteVacancyPoolStore[] = [];

afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  directories.splice(0).forEach((directory) =>
    rmSync(directory, { recursive: true, force: true }),
  );
});

function openStore(): { store: SqliteVacancyPoolStore; path: string } {
  const directory = mkdtempSync(join(tmpdir(), 'vacancy-pool-store-'));
  directories.push(directory);
  // A path inside a directory that does not exist yet, so the store has to
  // create it the way the server's data directory is created on first boot.
  const path = join(directory, 'nested', 'pool.db');
  const store = new SqliteVacancyPoolStore({ databasePath: path });
  stores.push(store);
  return { store, path };
}

describe('SqliteVacancyPoolStore', () => {
  it('reads back a source state that never carried a time, status or error', () => {
    const { store } = openStore();
    store.saveSourceState({
      sourceId: 'src',
      itemsFoundTotal: 0,
      itemsActiveTotal: 0,
    });
    expect(store.loadSourceStates()).toEqual([
      { sourceId: 'src', itemsFoundTotal: 0, itemsActiveTotal: 0 },
    ]);
  });

  it('overwrites a source state instead of stacking readings', () => {
    const { store } = openStore();
    store.saveSourceState({
      sourceId: 'src',
      lastStatus: 'error',
      lastErrorMessage: 'boom',
      lastSyncAt: '2026-08-30T10:00:00.000Z',
      itemsFoundTotal: 0,
      itemsActiveTotal: 0,
    });
    store.saveSourceState({
      sourceId: 'src',
      lastStatus: 'healthy',
      lastSyncAt: '2026-08-30T11:00:00.000Z',
      itemsFoundTotal: 7,
      itemsActiveTotal: 7,
    });
    expect(store.loadSourceStates()).toEqual([
      {
        sourceId: 'src',
        lastStatus: 'healthy',
        lastSyncAt: '2026-08-30T11:00:00.000Z',
        itemsFoundTotal: 7,
        itemsActiveTotal: 7,
      },
    ]);
  });

  it('drops a status word it does not recognise rather than passing it on', () => {
    const { store, path } = openStore();
    store.saveSourceState({
      sourceId: 'src',
      lastStatus: 'healthy',
      itemsFoundTotal: 1,
      itemsActiveTotal: 1,
    });
    const database = new DatabaseSync(path);
    database.exec("UPDATE vacancy_source_state SET last_status = 'excellent'");
    database.close();

    expect(store.loadSourceStates()[0]?.lastStatus).toBeUndefined();
  });

  it('empties the pool when the registry knows no sources at all', () => {
    const { store } = openStore();
    store.replaceSourceSlice('src', [
      {
        id: 'v1',
        fingerprint: 'fp-v1',
        title: 'Role',
        company: 'Company',
        description: '',
        requiredSkills: [],
        url: 'https://example.test/v1',
        provenance: {
          sourceType: 'json_api',
          sourceId: 'src',
          sourceUrl: 'https://example.test/v1',
          observedAt: '2026-08-30T10:00:00.000Z',
        },
        publishedAt: '2026-08-30T10:00:00.000Z',
        status: 'active',
      },
    ]);
    store.saveSourceState({ sourceId: 'src', itemsFoundTotal: 1, itemsActiveTotal: 1 });

    store.prune([], '2026-08-01T00:00:00.000Z');

    expect(store.loadVacancies()).toHaveLength(0);
    expect(store.loadSourceStates()).toHaveLength(0);
  });

  it('ignores stored payloads that are not a vacancy', () => {
    const { store, path } = openStore();
    const database = new DatabaseSync(path);
    const insert = database.prepare(
      `INSERT INTO vacancy_pool (id, source_id, published_at, stored_at, payload)
       VALUES (?, 'src', '2026-08-30T10:00:00.000Z', '2026-08-30T10:00:00.000Z', ?)`,
    );
    insert.run('null-payload', 'null');
    insert.run('number-payload', '5');
    insert.run('no-provenance', JSON.stringify({ id: 'x', title: 't', publishedAt: 'p' }));
    insert.run(
      'no-source-id',
      JSON.stringify({ id: 'x', title: 't', publishedAt: 'p', provenance: {} }),
    );
    insert.run('no-title', JSON.stringify({ id: 'x', publishedAt: 'p' }));
    database.close();

    expect(store.loadVacancies()).toHaveLength(0);
  });
});
