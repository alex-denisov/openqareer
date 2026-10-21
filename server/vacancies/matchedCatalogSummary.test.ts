import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import { MemoryVacancyPoolStore } from './memoryVacancyPoolStore';
import { CatalogTotalsCache, matchedCatalogSummary } from './matchedCatalogSummary';
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
  it('SQLite: считает сведённые кластеры, а не записи источников', () => {
    const directory = mkdtempSync(join(tmpdir(), 'catalog-totals-'));
    directories.push(directory);
    const store = new SqliteVacancyPoolStore({ databasePath: join(directory, 'pool.db') });
    store.upsertCluster(cluster('c1'));
    store.upsertCluster(cluster('c2'));
    const totals = store.catalogTotals();
    store.close();
    expect(totals.clusters).toBe(2);
    expect(totals.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });

  it('память: только активные кластеры, дата — последний просмотр', () => {
    const store = new MemoryVacancyPoolStore();
    store.upsertCluster(cluster('c1'));
    store.upsertCluster(
      cluster('c2', { status: 'archived', lastSeenAt: '2026-10-09T00:00:00.000Z' }),
    );
    expect(store.catalogTotals()).toEqual({ clusters: 1, updatedAt: '2026-10-07T09:12:00.000Z' });
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

  it('кэш не перечитывает базу чаще срока жизни', () => {
    let reads = 0;
    let now = 0;
    const cache = new CatalogTotalsCache(
      () => {
        reads += 1;
        return { clusters: reads };
      },
      () => now,
    );
    expect(cache.read()?.clusters).toBe(1);
    now = 60_000;
    expect(cache.read()?.clusters).toBe(1);
    now = 11 * 60_000;
    expect(cache.read()?.clusters).toBe(2);
    expect(reads).toBe(2);
  });

  it('ошибка чтения — нет сводки, честное «неизвестно» на клиенте', () => {
    const cache = new CatalogTotalsCache(() => {
      throw new Error('locked');
    });
    expect(cache.read()).toBeUndefined();
  });
});
