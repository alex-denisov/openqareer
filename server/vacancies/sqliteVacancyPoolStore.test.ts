import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import { MIGRATION_23 } from '../data/sqliteSchema';
import { freshnessWindow } from './vacancyPoolQuery';
import type { VacancyCluster } from '../domain/unifiedVacancy';

const directories: string[] = [];
const stores: SqliteVacancyPoolStore[] = [];

afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
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
  it('дочитывает колонки запросов у строк, записанных до B221, порциями', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vacancy-pool-b221-'));
    directories.push(directory);
    const path = join(directory, 'pool.db');
    const legacy = new DatabaseSync(path);
    legacy.exec(MIGRATION_23);
    const insert = legacy.prepare(
      'INSERT INTO vacancy_pool (id, source_id, published_at, stored_at, payload) VALUES (?, ?, ?, ?, ?)',
    );
    for (const id of ['v1', 'v2', 'v3']) {
      insert.run(
        id,
        'src',
        '2026-09-01T10:00:00.000Z',
        '2026-09-01T10:00:00.000Z',
        JSON.stringify(card(id)),
      );
    }
    insert.run(
      'broken',
      'src',
      '2026-09-01T10:00:00.000Z',
      '2026-09-01T10:00:00.000Z',
      '{"id":"broken"}',
    );
    legacy.close();

    const store = new SqliteVacancyPoolStore({ databasePath: path });
    stores.push(store);
    const window = freshnessWindow(Date.parse('2026-09-02T00:00:00.000Z'));
    // До дочитывания база не знает дат: ответ пустой, а не выдуманный.
    expect(store.pendingBackfill()).toBe(4);
    expect(store.countVacancies(window)).toBe(0);

    expect(store.backfillStep(2)).toBe(2);
    expect(store.backfillStep(2)).toBe(2);
    expect(store.backfillStep(2)).toBe(0);
    expect(store.pendingBackfill()).toBe(0);
    expect(store.countVacancies(window)).toBe(3);
    // Нечитаемая строка ушла из базы: вакансией она не была.
    expect(store.hasVacancy('broken')).toBe(false);
    expect(store.queryVacancies({ window, query: 'company', offset: 0, limit: 10 }).total).toBe(3);
  });
  it('замена среза и повторное чтение не воскрешают строки, ещё не дошедшие до индекса', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vacancy-pool-b221-drift-'));
    directories.push(directory);
    const path = join(directory, 'pool.db');
    const legacy = new DatabaseSync(path);
    legacy.exec(MIGRATION_23);
    legacy.exec('ALTER TABLE vacancy_pool ADD COLUMN expired_at TEXT;');
    const insert = legacy.prepare(
      'INSERT INTO vacancy_pool (id, source_id, published_at, stored_at, payload, expired_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const at = '2026-09-01T10:00:00.000Z';
    insert.run('stale', 'src', at, at, JSON.stringify(card('stale')), null);
    insert.run('buried', 'src', at, at, JSON.stringify(card('buried')), at);
    legacy.close();

    const store = new SqliteVacancyPoolStore({ databasePath: path });
    stores.push(store);
    // Проход ещё не шёл, а площадка уже прочитана заново: прежний срез снят,
    // похороненное остаётся похороненным даже если пришло снова.
    store.replaceSourceSlice('src', [card('fresh'), card('buried')]);
    expect(store.hasVacancy('fresh')).toBe(true);
    expect(store.hasVacancy('buried')).toBe(false);
    while (store.backfillStep(1) > 0) {
      /* до конца */
    }
    expect(store.hasVacancy('stale')).toBe(false);
    expect(store.hasVacancy('buried')).toBe(false);
    expect(
      store
        .loadVacancies()
        .map((v) => v.id)
        .sort(),
    ).toEqual(['fresh']);
  });

  it('проход не зацикливается на строке, чей текст называет другой идентификатор', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vacancy-pool-b221-loop-'));
    directories.push(directory);
    const path = join(directory, 'pool.db');
    const legacy = new DatabaseSync(path);
    legacy.exec(MIGRATION_23);
    legacy
      .prepare(
        'INSERT INTO vacancy_pool (id, source_id, published_at, stored_at, payload) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        'row-id',
        'src',
        '2026-09-01T10:00:00.000Z',
        '2026-09-01T10:00:00.000Z',
        JSON.stringify(card('other-id')),
      );
    legacy.close();

    const store = new SqliteVacancyPoolStore({ databasePath: path });
    stores.push(store);
    expect(store.backfillStep(10)).toBe(1);
    expect(store.backfillStep(10)).toBe(0);
    expect(store.pendingBackfill()).toBe(0);
    expect(store.hasVacancy('row-id')).toBe(true);
  });
  it('дочитывает проекцию сведения для индекса, созданного выкатом 1 без неё', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vacancy-pool-b221-idx-'));
    directories.push(directory);
    const path = join(directory, 'pool.db');
    const legacy = new DatabaseSync(path);
    legacy.exec(MIGRATION_23);
    legacy.exec('ALTER TABLE vacancy_pool ADD COLUMN expired_at TEXT;');
    legacy.exec(`CREATE TABLE vacancy_pool_index (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL, published_ms INTEGER, observed_ms INTEGER,
      is_active INTEGER NOT NULL, is_remote INTEGER, url TEXT NOT NULL, search_text TEXT NOT NULL,
      expired INTEGER NOT NULL DEFAULT 0) STRICT;`);
    const at = '2026-09-01T10:00:00.000Z';
    const pool = legacy.prepare(
      'INSERT INTO vacancy_pool (id, source_id, published_at, stored_at, payload, expired_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const index = legacy.prepare(
      'INSERT INTO vacancy_pool_index (id, source_id, published_ms, observed_ms, is_active, is_remote, url, search_text, expired) VALUES (?, ?, ?, ?, 1, NULL, ?, ?, ?)',
    );
    pool.run('v1', 'src', at, at, JSON.stringify(card('v1')), null);
    index.run('v1', 'src', Date.parse(at), Date.parse(at), 'https://example.test/v1', 'role', 0);
    pool.run('v2', 'src', at, at, JSON.stringify(card('v2')), at);
    index.run('v2', 'src', Date.parse(at), Date.parse(at), 'https://example.test/v2', 'role', 1);
    legacy.close();

    const store = new SqliteVacancyPoolStore({ databasePath: path });
    stores.push(store);
    const window = freshnessWindow(Date.parse('2026-09-02T00:00:00.000Z'));
    expect(store.pendingBackfill()).toBe(2);
    expect(Array.from(store.iterateClusterInput(window))).toEqual([]);
    while (store.backfillStep(1) > 0) {
      /* до конца */
    }
    expect(store.pendingBackfill()).toBe(0);
    // Похороненная строка остаётся похороненной и после дочитывания проекции.
    expect(Array.from(store.iterateClusterInput(window)).map((v) => v.id)).toEqual(['v1']);
    expect(store.hasVacancy('v2')).toBe(false);
  });
});

describe('SqliteVacancyPoolStore · queryMatchCandidates (B221 срез 2)', () => {
  function card(
    id: string,
    overrides: Partial<Parameters<SqliteVacancyPoolStore['replaceSourceSlice']>[1][number]> = {},
  ) {
    return {
      id,
      fingerprint: `fp-${id}`,
      title: 'Role',
      company: 'Company',
      description: '',
      requiredSkills: [],
      url: `https://example.test/${id}`,
      provenance: {
        sourceType: 'json_api' as const,
        sourceId: 'src',
        sourceUrl: `https://example.test/${id}`,
        observedAt: '2026-09-01T10:00:00.000Z',
      },
      publishedAt: '2026-09-01T10:00:00.000Z',
      status: 'active' as const,
      ...overrides,
    };
  }

  it('отбирает только активные, непохороненные записи в окне свежести', () => {
    const { store } = openStore();
    const nowMs = Date.parse('2026-09-02T10:00:00.000Z');
    store.replaceSourceSlice('src', [
      card('v1', { title: 'Backend Developer' }),
      card('v2', { title: 'Backend Developer', status: 'archived' }),
      card('v3', { title: 'Backend Developer', publishedAt: '2026-07-01T10:00:00.000Z' }),
      card('v4', { title: 'Backend Developer' }),
    ]);
    store.markExpired(['v4'], '2026-09-02T00:00:00.000Z');

    const result = store.queryMatchCandidates(
      {
        candidateId: 'c1',
        targetRoles: ['Backend Developer'],
        confirmedSkills: [],
        confirmedFacts: [],
      },
      { nowMs },
    );
    expect(result.map((v) => v.id)).toEqual(['v1']);
  });

  it('находит целевую роль и токены в search_text', () => {
    const { store } = openStore();
    const nowMs = Date.parse('2026-09-02T10:00:00.000Z');
    store.replaceSourceSlice('src', [
      card('v1', { title: 'Lead Frontend Engineer' }),
      card('v2', { title: 'DevOps Specialist' }),
    ]);

    const result = store.queryMatchCandidates(
      {
        candidateId: 'c1',
        targetRoles: ['Frontend Engineer'],
        confirmedSkills: [],
        confirmedFacts: [],
      },
      { nowMs, limit: 10 },
    );
    expect(result.map((v) => v.id)).toContain('v1');
  });

  it('предпочитает удалёнку при preferredRemote = true', () => {
    const { store } = openStore();
    const nowMs = Date.parse('2026-09-02T10:00:00.000Z');
    store.replaceSourceSlice('src', [
      card('v-office', {
        title: 'Developer',
        isRemote: false,
        publishedAt: '2026-09-02T09:00:00.000Z',
      }),
      card('v-remote', {
        title: 'Developer',
        isRemote: true,
        publishedAt: '2026-09-01T09:00:00.000Z',
      }),
    ]);

    const result = store.queryMatchCandidates(
      {
        candidateId: 'c1',
        targetRoles: ['Developer'],
        confirmedSkills: [],
        confirmedFacts: [],
        preferredRemote: true,
      },
      { nowMs, limit: 10 },
    );
    expect(result.map((v) => v.id)).toEqual(['v-remote', 'v-office']);
  });

  it('добирает до лимита свежими активными вакансиями', () => {
    const { store } = openStore();
    const nowMs = Date.parse('2026-09-02T10:00:00.000Z');
    store.replaceSourceSlice('src', [
      card('v-role', { title: 'Go Developer', publishedAt: '2026-09-01T08:00:00.000Z' }),
      card('v-other-1', { title: 'Accountant', publishedAt: '2026-09-02T08:00:00.000Z' }),
      card('v-other-2', { title: 'HR Manager', publishedAt: '2026-09-02T07:00:00.000Z' }),
    ]);

    const result = store.queryMatchCandidates(
      { candidateId: 'c1', targetRoles: ['Go Developer'], confirmedSkills: [], confirmedFacts: [] },
      { nowMs, limit: 3 },
    );
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('v-role');
    expect(new Set(result.map((v) => v.id))).toEqual(new Set(['v-role', 'v-other-1', 'v-other-2']));
  });

  it('ищет по навыкам при пустых целевых ролях', () => {
    const { store } = openStore();
    const nowMs = Date.parse('2026-09-02T10:00:00.000Z');
    store.replaceSourceSlice('src', [
      card('v-skill', { title: 'Software Engineer', requiredSkills: ['Kubernetes'] }),
      card('v-no-skill', { title: 'Designer', requiredSkills: ['Figma'] }),
    ]);

    const result = store.queryMatchCandidates(
      { candidateId: 'c1', targetRoles: [], confirmedSkills: ['Kubernetes'], confirmedFacts: [] },
      { nowMs, limit: 1 },
    );
    expect(result.map((v) => v.id)).toEqual(['v-skill']);
  });

  describe('Cluster storage (B221 slice 3)', () => {
    const sampleCluster: VacancyCluster = {
      id: 'cluster-v1',
      canonicalTitle: 'Senior TypeScript Developer',
      canonicalCompany: 'Tech Corp',
      canonicalLocation: 'Berlin',
      isRemote: true,
      salary: { from: 80000, to: 100000, currency: 'EUR' },
      descriptionSummary: 'Great role',
      skills: ['TypeScript', 'Node.js'],
      primaryUrl: 'https://example.test/v1',
      sources: [
        {
          sourceType: 'json_api',
          sourceId: 'src1',
          sourceUrl: 'https://example.test/v1',
          observedAt: '2026-09-01T10:00:00.000Z',
        },
      ],
      firstObservedAt: '2026-09-01T10:00:00.000Z',
      lastSeenAt: '2026-09-02T10:00:00.000Z',
      status: 'active',
      vacanciesCount: 1,
    };

    it('saves, counts, and loads clusters', () => {
      const { store } = openStore();
      expect(store.countClusters()).toBe(0);
      expect(store.loadClusters()).toEqual([]);

      store.saveClusters([sampleCluster]);
      expect(store.countClusters()).toBe(1);
      const loaded = store.loadClusters();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe('cluster-v1');
      expect(loaded[0].canonicalTitle).toBe('Senior TypeScript Developer');
      expect(loaded[0].skills).toEqual(['TypeScript', 'Node.js']);
    });

    it('upserts an existing cluster', () => {
      const { store } = openStore();
      store.saveClusters([sampleCluster]);

      const updatedCluster: VacancyCluster = {
        ...sampleCluster,
        canonicalTitle: 'Lead TypeScript Developer',
        vacanciesCount: 2,
      };
      store.upsertCluster(updatedCluster);

      expect(store.countClusters()).toBe(1);
      const loaded = store.loadClusters();
      expect(loaded[0].canonicalTitle).toBe('Lead TypeScript Developer');
      expect(loaded[0].vacanciesCount).toBe(2);
    });

    it('deletes a cluster by id', () => {
      const { store } = openStore();
      store.saveClusters([sampleCluster]);
      expect(store.countClusters()).toBe(1);

      store.deleteCluster('cluster-v1');
      expect(store.countClusters()).toBe(0);
      expect(store.loadClusters()).toEqual([]);
    });

    it('persists clusters across closing and reopening database', () => {
      const { store, path } = openStore();
      store.saveClusters([sampleCluster]);
      store.close();

      const reopenedStore = new SqliteVacancyPoolStore({ databasePath: path });
      stores.push(reopenedStore);

      expect(reopenedStore.countClusters()).toBe(1);
      const loaded = reopenedStore.loadClusters();
      expect(loaded[0].id).toBe('cluster-v1');
      expect(loaded[0].canonicalCompany).toBe('Tech Corp');
    });

    it('serves the materialized catalog with a keyset cursor and SQL facets', () => {
      const { store } = openStore();
      store.saveClusters([
        sampleCluster,
        {
          ...sampleCluster,
          id: 'cluster-v2',
          canonicalTitle: 'TypeScript Developer',
          firstObservedAt: '2026-09-01T09:00:00.000Z',
          lastSeenAt: '2026-09-02T09:00:00.000Z',
        },
        {
          ...sampleCluster,
          id: 'cluster-v3',
          canonicalTitle: 'Data Analyst',
          firstObservedAt: '2026-09-01T08:00:00.000Z',
          lastSeenAt: '2026-09-02T08:00:00.000Z',
        },
        { ...sampleCluster, id: 'cluster-v4', status: 'archived' },
      ]);

      expect(store.catalogProjectionReady()).toBe(true);
      expect(store.pendingCatalogEntries()).toBe(0);
      const first = store.loadCatalogEntriesPage({ limit: 1 });
      expect(first.total).toBe(3);
      expect(first.items).toHaveLength(1);
      expect(first.items[0]?.title).toBe('Senior TypeScript Developer');
      expect(first.nextCursor).toBeDefined();

      const second = store.loadCatalogEntriesPage({ limit: 1, after: first.nextCursor });
      expect(second.items.map((entry) => entry.title)).toEqual(['TypeScript Developer']);
      expect(second.nextCursor).toBeDefined();

      const listings = store.loadCatalogListings();
      expect(listings.find((listing) => listing.place === 'berlin')?.count).toBe(3);
      expect(store.getCatalogEntry(first.items[0]!.key)?.clusterId).toBe('cluster-v1');
    });

    it('backfills legacy cluster rows in bounded steps without loading the snapshot', () => {
      const { store, path } = openStore();
      const database = new DatabaseSync(path);
      database
        .prepare(
          `INSERT INTO vacancy_clusters
             (id, fingerprint, title, company, cluster_json, items_count, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sampleCluster.id,
          sampleCluster.id,
          sampleCluster.canonicalTitle,
          sampleCluster.canonicalCompany,
          JSON.stringify(sampleCluster),
          sampleCluster.vacanciesCount,
          Date.now(),
        );
      database.close();

      expect(store.pendingCatalogEntries()).toBe(1);
      expect(store.catalogProjectionReady()).toBe(false);
      expect(store.backfillCatalogEntriesStep(1)).toBe(1);
      expect(store.pendingCatalogEntries()).toBe(0);
      expect(store.catalogProjectionReady()).toBe(true);
      expect(store.loadCatalogEntriesPage({ limit: 10 }).items[0]?.clusterId).toBe(
        sampleCluster.id,
      );
    });
  });
});
