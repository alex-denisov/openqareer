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

/**
 * B200 — наблюдения опроса переживают перезапуск. Живость считается по серии,
 * которая копится днями; процесс живёт часы, поэтому без записи на диск каждый
 * деплой объявлял бы любую площадку «ещё ни разу не опрошенной».
 */
describe('SqliteVacancyPoolStore · наблюдения площадки (B200)', () => {
  const observations = {
    firstReadingAt: '2026-09-01T00:00:00.000Z',
    lastReadingAt: '2026-09-05T00:00:00.000Z',
    lastReadingSucceeded: true,
    lastNonEmptyReadingAt: '2026-09-02T00:00:00.000Z',
    consecutiveEmptyReadings: 3,
    windowStartedAt: '2026-09-01T00:00:00.000Z',
    windowReadings: 4,
    windowSuccessful: 4,
    census: {
      total: 96,
      fresherThan30Days: 96,
      fresherThan90Days: 96,
      fresherThan180Days: 96,
      withEmployer: 10,
      withLink: 96,
      withDate: 96,
    },
  } as const;

  it('читает наблюдения обратно тем же значением', () => {
    const { store, path } = openStore();
    store.saveSourceState({
      sourceId: 'src',
      itemsFoundTotal: 96,
      itemsActiveTotal: 96,
      observations,
    });
    store.close();
    stores.splice(stores.indexOf(store), 1);

    const reopened = new SqliteVacancyPoolStore({ databasePath: path });
    stores.push(reopened);
    expect(reopened.loadSourceStates()[0]?.observations).toEqual(observations);
  });

  it('открывает базу, созданную до B200, и достраивает колонку наблюдений', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vacancy-pool-legacy-'));
    directories.push(directory);
    const path = join(directory, 'pool.db');
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE vacancy_source_state (
      source_id TEXT PRIMARY KEY,
      last_sync_at TEXT,
      last_status TEXT,
      last_error_message TEXT,
      items_found_total INTEGER NOT NULL DEFAULT 0,
      items_active_total INTEGER NOT NULL DEFAULT 0
    ) STRICT;`);
    legacy.exec(
      `INSERT INTO vacancy_source_state (source_id, items_found_total, items_active_total)
       VALUES ('src', 1, 1)`,
    );
    legacy.close();

    const store = new SqliteVacancyPoolStore({ databasePath: path });
    stores.push(store);
    expect(store.loadSourceStates()[0]?.observations).toBeUndefined();

    store.saveSourceState({
      sourceId: 'src',
      itemsFoundTotal: 1,
      itemsActiveTotal: 1,
      observations,
    });
    expect(store.loadSourceStates()[0]?.observations).toEqual(observations);
  });

  it('не выдаёт нечитаемую запись за наблюдение', () => {
    const { store, path } = openStore();
    store.saveSourceState({ sourceId: 'src', itemsFoundTotal: 0, itemsActiveTotal: 0 });
    const raw = new DatabaseSync(path);
    raw.exec("UPDATE vacancy_source_state SET observations = '{не json'");
    raw.close();

    expect(store.loadSourceStates()[0]?.observations).toBeUndefined();
  });
});

/**
 * B200 срез 2. Отсутствие записи неотличимо от «никогда не видели», а запись о
 * смерти — это и есть доказательство: объявление, чей адрес сервер объявил
 * несуществующим, остаётся в базе с датой смерти.
 */
describe('SqliteVacancyPoolStore · снятое объявление', () => {
  function card(id: string): Parameters<SqliteVacancyPoolStore['replaceSourceSlice']>[1][number] {
    return {
      id,
      fingerprint: `fp-${id}`,
      title: 'Role',
      company: 'Company',
      description: '',
      requiredSkills: [],
      url: `https://example.test/${id}`,
      provenance: {
        sourceType: 'json_api',
        sourceId: 'src',
        sourceUrl: `https://example.test/${id}`,
        observedAt: '2026-09-01T10:00:00.000Z',
      },
      publishedAt: '2026-09-01T10:00:00.000Z',
      status: 'active',
    };
  }

  it('перестаёт отдавать объявление, чья ссылка ответила 404', () => {
    const { store } = openStore();
    store.replaceSourceSlice('src', [card('v1'), card('v2')]);

    expect(store.markExpired(['v2'], '2026-09-07T09:00:00.000Z')).toBe(1);

    expect(store.loadVacancies().map((v) => v.id)).toEqual(['v1']);
  });

  it('держит запись о смерти, когда площадка снова отдаёт то же объявление', () => {
    const { store } = openStore();
    store.replaceSourceSlice('src', [card('v1'), card('v2')]);
    store.markExpired(['v2'], '2026-09-07T09:00:00.000Z');

    store.replaceSourceSlice('src', [card('v1'), card('v2')]);

    expect(store.loadVacancies().map((v) => v.id)).toEqual(['v1']);
  });

  it('переживает перезапуск процесса', () => {
    const { store, path } = openStore();
    store.replaceSourceSlice('src', [card('v1'), card('v2')]);
    store.markExpired(['v2'], '2026-09-07T09:00:00.000Z');
    store.close();
    stores.splice(stores.indexOf(store), 1);

    const reopened = new SqliteVacancyPoolStore({ databasePath: path });
    stores.push(reopened);
    expect(reopened.loadVacancies().map((v) => v.id)).toEqual(['v1']);
  });

  it('хоронит объявление один раз — первая дата смерти остаётся', () => {
    const { store, path } = openStore();
    store.replaceSourceSlice('src', [card('v1')]);
    store.markExpired(['v1'], '2026-09-07T09:00:00.000Z');
    expect(store.markExpired(['v1'], '2026-09-08T09:00:00.000Z')).toBe(0);

    const rows = new DatabaseSync(path)
      .prepare('SELECT expired_at FROM vacancy_pool WHERE id = ?')
      .all('v1') as unknown as Array<{ expired_at: string }>;
    expect(rows[0]?.expired_at).toBe('2026-09-07T09:00:00.000Z');
  });

  it('достраивает колонку на базе, созданной до среза 2', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vacancy-pool-legacy-'));
    directories.push(directory);
    const path = join(directory, 'pool.db');
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE vacancy_pool (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      published_at TEXT,
      stored_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );`);
    legacy.close();

    const store = new SqliteVacancyPoolStore({ databasePath: path });
    stores.push(store);
    store.replaceSourceSlice('src', [card('v1')]);
    expect(store.markExpired(['v1'], '2026-09-07T09:00:00.000Z')).toBe(1);
    expect(store.loadVacancies()).toEqual([]);
  });
});
