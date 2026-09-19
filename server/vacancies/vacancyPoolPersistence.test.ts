import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';

const directories: string[] = [];
const stores: SqliteVacancyPoolStore[] = [];

afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'vacancy-pool-'));
  directories.push(directory);
  return join(directory, 'pool.db');
}

function openStore(path: string): SqliteVacancyPoolStore {
  const store = new SqliteVacancyPoolStore({ databasePath: path });
  stores.push(store);
  return store;
}

function corruptFirstRow(path: string): void {
  const database = new DatabaseSync(path);
  database.exec("UPDATE vacancy_pool SET payload = '{not json'");
  database.close();
}

const SOURCE: VacancySourceConfig = {
  id: 'test-json',
  name: 'Test board',
  type: 'json_api',
  enabled: true,
  targetUrl: 'https://example.test/jobs.json',
  refreshIntervalMinutes: 180,
  itemsFoundTotal: 0,
  itemsActiveTotal: 0,
};

const TITLES: Record<string, string> = {
  a: 'Senior TypeScript Developer',
  b: 'Lead Product Designer',
};

function vacancy(id: string): UnifiedVacancy {
  const now = new Date().toISOString();
  return {
    id,
    fingerprint: `fp-${id}`,
    title: TITLES[id] ?? `Role ${id}`,
    company: `Company ${id.toUpperCase()}`,
    isRemote: true,
    description: 'TypeScript, React, Node.js',
    requiredSkills: ['TypeScript', 'React'],
    url: `https://example.test/${id}`,
    provenance: {
      sourceType: 'json_api',
      sourceId: SOURCE.id,
      sourceUrl: `https://example.test/${id}`,
      observedAt: now,
    },
    publishedAt: now,
    status: 'active',
  };
}

describe('vacancy pool persistence (B164)', () => {
  it('restores a persisted catalog page without hydrating every cluster', async () => {
    const path = databasePath();
    const first = new MultiSourceVacancyEngine({
      sources: [SOURCE],
      pool: openStore(path),
      fetcher: async () => [vacancy('a'), vacancy('b')],
    });
    await first.syncSource(SOURCE.id);

    const restartedPool = openStore(path);
    const loadAllSpy = vi.spyOn(restartedPool, 'loadClusters');
    const restarted = new MultiSourceVacancyEngine({ sources: [SOURCE], pool: restartedPool });

    await restarted.restoreAsync();

    expect(loadAllSpy).not.toHaveBeenCalled();
    expect(restarted.getPublicCatalogClusters(1)).toHaveLength(1);
    expect(restarted.getSourceHealthReport()).toHaveLength(1);
    expect(loadAllSpy).not.toHaveBeenCalled();
  });

  it('serves the vacancies of the previous process after a restart, without any fetcher', async () => {
    const path = databasePath();
    const syncedAt = Date.parse('2026-08-30T10:00:00.000Z');

    const first = new MultiSourceVacancyEngine({
      sources: [SOURCE],
      pool: openStore(path),
      fetcher: async () => [vacancy('a'), vacancy('b')],
    });
    const outcome = await first.syncSource(SOURCE.id, undefined, syncedAt);
    expect(outcome.status).toBe('healthy');
    expect(first.getVacancies().total).toBe(2);

    // A fresh process: no transport at all, so anything it serves came from
    // storage rather than from a reading taken in this run.
    const restarted = new MultiSourceVacancyEngine({
      sources: [SOURCE],
      pool: openStore(path),
    });
    restarted.restore();

    expect(restarted.getVacancies().total).toBe(2);
    expect(restarted.getActiveClusters().length).toBe(2);
    expect(restarted.getSource(SOURCE.id)?.lastSyncAt).toBe(new Date(syncedAt).toISOString());
    expect(restarted.getSource(SOURCE.id)?.lastStatus).toBe('healthy');
    expect(restarted.getSource(SOURCE.id)?.itemsFoundTotal).toBe(2);

    const asyncRestarted = new MultiSourceVacancyEngine({
      sources: [SOURCE],
      pool: openStore(path),
    });
    const asyncOutcome = await asyncRestarted.restoreAsync(undefined, 1);
    expect(asyncOutcome.restored).toBe(2);
    await asyncRestarted.reclusterAsync(1);
    expect(asyncRestarted.getActiveClusters().length).toBe(2);
  });

  it('does not re-serve a vacancy the source stopped returning', async () => {
    const path = databasePath();
    const first = new MultiSourceVacancyEngine({
      sources: [SOURCE],
      pool: openStore(path),
      fetcher: async () => [vacancy('a'), vacancy('b')],
    });
    await first.syncSource(SOURCE.id);

    const second = new MultiSourceVacancyEngine({
      sources: [SOURCE],
      pool: openStore(path),
      fetcher: async () => [vacancy('a')],
    });
    second.restore();
    await second.syncSource(SOURCE.id);

    const restarted = new MultiSourceVacancyEngine({
      sources: [SOURCE],
      pool: openStore(path),
    });
    restarted.restore();
    expect(restarted.getVacancies().total).toBe(1);
    expect(restarted.getVacancies().items[0]?.id).toBe('a');
  });

  it('keeps a failed reading visible after a restart instead of claiming health', async () => {
    const path = databasePath();
    const failedAt = Date.parse('2026-08-30T11:00:00.000Z');
    const first = new MultiSourceVacancyEngine({
      sources: [SOURCE],
      pool: openStore(path),
      fetcher: async () => {
        throw new Error('source_unreachable');
      },
    });
    const outcome = await first.syncSource(SOURCE.id, undefined, failedAt);
    expect(outcome.status).toBe('error');

    const restarted = new MultiSourceVacancyEngine({
      sources: [SOURCE],
      pool: openStore(path),
    });
    restarted.restore();
    const source = restarted.getSource(SOURCE.id);
    expect(source?.lastStatus).toBe('error');
    expect(source?.lastErrorMessage).toBe('source_unreachable');
    expect(source?.lastSyncAt).toBe(new Date(failedAt).toISOString());
  });

  it('drops what a source the registry no longer knows had left behind', async () => {
    const path = databasePath();
    const first = new MultiSourceVacancyEngine({
      sources: [SOURCE],
      pool: openStore(path),
      fetcher: async () => [vacancy('a')],
    });
    await first.syncSource(SOURCE.id);

    const withoutSource = new MultiSourceVacancyEngine({
      sources: [{ ...SOURCE, id: 'other-source' }],
      pool: openStore(path),
    });
    withoutSource.restore();
    expect(withoutSource.getVacancies().total).toBe(0);

    // And the rows are gone, not merely filtered out on read.
    const verifier = openStore(path);
    expect(verifier.loadVacancies()).toHaveLength(0);
    expect(verifier.loadSourceStates()).toHaveLength(0);
  });

  it('forgets a reading older than the pool keeps', async () => {
    const path = databasePath();
    const store = openStore(path);
    const stale = vacancy('old');
    const staleAt = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    store.replaceSourceSlice(SOURCE.id, [{ ...stale, publishedAt: staleAt }]);

    const engine = new MultiSourceVacancyEngine({ sources: [SOURCE], pool: store });
    engine.restore();
    expect(engine.getVacancies().total).toBe(0);
    expect(store.loadVacancies()).toHaveLength(0);
  });

  it('ignores a stored row it cannot read back', () => {
    const path = databasePath();
    const store = openStore(path);
    store.replaceSourceSlice(SOURCE.id, [vacancy('a')]);
    corruptFirstRow(path);

    const reopened = openStore(path);
    expect(reopened.loadVacancies()).toHaveLength(0);
  });

  it('serves an unchanged pool when no storage is configured', async () => {
    const engine = new MultiSourceVacancyEngine({
      sources: [SOURCE],
      fetcher: async () => [vacancy('a')],
    });
    expect(engine.restore()).toEqual({ restored: 0 });
    await engine.syncSource(SOURCE.id);
    expect(engine.getVacancies().total).toBe(1);
  });
});
