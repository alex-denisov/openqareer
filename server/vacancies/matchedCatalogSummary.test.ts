import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import { MemoryVacancyPoolStore } from './memoryVacancyPoolStore';
import { matchedCatalogSummary } from './matchedCatalogSummary';
import type { VacancyCluster } from '../domain/unifiedVacancy';

const directories: string[] = [];
afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

function cluster(id: string, overrides: Partial<VacancyCluster> = {}): VacancyCluster {
  return {
    id,
    canonicalTitle: 'Head of QA',
    canonicalCompany: 'Acme',
    descriptionSummary: 'Руководит тестированием.',
    isRemote: false,
    skills: [],
    primaryUrl: `https://example.test/${id}`,
    sources: [],
    firstObservedAt: '2026-10-01T00:00:00.000Z',
    lastSeenAt: '2026-10-07T09:12:00.000Z',
    status: 'active',
    vacanciesCount: 2,
    ...overrides,
  };
}

describe('сводка каталога (B485)', () => {
  function openSqlite() {
    const directory = mkdtempSync(join(tmpdir(), 'catalog-totals-'));
    directories.push(directory);
    return new SqliteVacancyPoolStore({ databasePath: join(directory, 'pool.db') });
  }

  it('SQLite: нет строки итогов — нет сводки, до первого пересчёта', () => {
    const store = openSqlite();
    store.upsertCluster(cluster('c1'));
    expect(store.readCatalogTotals()).toBeUndefined();
    store.close();
  });

  it('SQLite: обслуживание считает только активные кластеры и пишет одну строку', () => {
    const store = openSqlite();
    store.upsertCluster(cluster('c1'));
    store.upsertCluster(cluster('c2'));
    store.upsertCluster(cluster('c3', { status: 'archived' }));
    store.recomputeCatalogTotals('2026-10-07T06:12:00.000Z', '2026-10-07T06:13:00.000Z');
    store.recomputeCatalogTotals('2026-10-07T06:12:00.000Z', '2026-10-07T06:14:00.000Z');
    expect(store.readCatalogTotals()).toEqual({
      clusters: 2,
      updatedAt: '2026-10-07T06:12:00.000Z',
      computedAt: '2026-10-07T06:14:00.000Z',
    });
    store.close();
  });

  it('SQLite: чтение итогов не обращается к vacancy_clusters', () => {
    const store = openSqlite();
    store.upsertCluster(cluster('c1'));
    store.recomputeCatalogTotals('2026-10-07T06:12:00.000Z');
    const database = (store as unknown as { database: DatabaseSync }).database;
    database.exec('ALTER TABLE vacancy_clusters RENAME TO vacancy_clusters_hidden');
    expect(store.readCatalogTotals()?.clusters).toBe(1);
    database.exec('ALTER TABLE vacancy_clusters_hidden RENAME TO vacancy_clusters');
    store.close();
  });

  it('память: только активные кластеры', () => {
    const store = new MemoryVacancyPoolStore();
    store.upsertCluster(cluster('c1'));
    store.upsertCluster(cluster('c2', { status: 'archived' }));
    expect(store.readCatalogTotals()).toBeUndefined();
    store.recomputeCatalogTotals('2026-10-07T09:12:00.000Z', '2026-10-07T09:13:00.000Z');
    expect(store.readCatalogTotals()).toEqual({
      clusters: 1,
      updatedAt: '2026-10-07T09:12:00.000Z',
      computedAt: '2026-10-07T09:13:00.000Z',
    });
  });

  it('пустой каталог — нет сводки, а не ноль', () => {
    expect(matchedCatalogSummary({ clusters: 0 }, 5)).toBeUndefined();
    expect(matchedCatalogSummary(undefined, 5)).toBeUndefined();
  });

  it('сводка несёт число по роли и уровню, размер и дату', () => {
    expect(
      matchedCatalogSummary({ clusters: 1620, updatedAt: '2026-10-07T06:12:00.000Z' }, 214),
    ).toEqual({
      roleLevelMatches: 214,
      catalogTotal: 1620,
      observedAt: '2026-10-07T06:12:00.000Z',
    });
  });
});
