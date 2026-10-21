import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedVacancy, VacancyCluster } from '../domain/unifiedVacancy';
import { MemoryVacancyPoolStore } from './memoryVacancyPoolStore';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import { MaintenanceWorker } from '../maintenance/maintenanceWorker';

const directories: string[] = [];
const stores: SqliteVacancyPoolStore[] = [];

afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

function openSqlite(): SqliteVacancyPoolStore {
  const directory = mkdtempSync(join(tmpdir(), 'orphan-clusters-'));
  directories.push(directory);
  const store = new SqliteVacancyPoolStore({ databasePath: join(directory, 'pool.db') });
  stores.push(store);
  return store;
}

function vacancy(sourceId: string, externalId: string): UnifiedVacancy {
  const url = `https://jobs.example/${sourceId}/${externalId}`;
  const at = new Date().toISOString();
  return {
    id: `${sourceId}:${externalId}`,
    fingerprint: `${sourceId}:${externalId}`,
    title: 'Data Engineer',
    company: 'Acme',
    description: '',
    requiredSkills: [],
    url,
    provenance: { sourceType: 'json_api', sourceId, sourceUrl: url, externalId, observedAt: at },
    publishedAt: at,
    status: 'active',
  };
}

function clusterOf(founder: UnifiedVacancy, ...others: UnifiedVacancy[]): VacancyCluster {
  return {
    id: `cluster-${founder.id}`,
    canonicalTitle: 'Senior Data Engineer',
    canonicalCompany: 'Acme',
    canonicalLocation: 'Berlin',
    isRemote: false,
    salary: { from: 80000, to: 100000, currency: 'EUR' },
    descriptionSummary: '',
    skills: [],
    primaryUrl: founder.url,
    sources: [founder, ...others].map((v) => v.provenance),
    firstObservedAt: founder.publishedAt,
    lastSeenAt: founder.publishedAt,
    status: 'active',
    vacanciesCount: 1 + others.length,
  };
}

describe.each([
  ['sqlite', () => openSqlite()],
  ['memory', () => new MemoryVacancyPoolStore()],
] as const)('removing clusters with no pool record left (%s)', (_name, open) => {
  it('removes a cluster and its card once no member is in the pool', () => {
    const store = open();
    const alive = vacancy('src-a', '1');
    const goneFounderAliveMember = vacancy('src-a', '2');
    const otherSourceMember = vacancy('src-b', '9');
    const gone = vacancy('src-a', '3');
    const buriedOnly = vacancy('src-a', '4');
    store.mergeSourceSlice('src-a', [alive, buriedOnly]);
    store.mergeSourceSlice('src-b', [otherSourceMember]);
    store.markExpired([buriedOnly.id], new Date().toISOString());
    store.saveClusters([
      clusterOf(alive),
      clusterOf(goneFounderAliveMember, otherSourceMember),
      clusterOf(gone),
      clusterOf(buriedOnly),
    ]);
    const goneKey = store.loadCatalogEntriesPage!({ limit: 10 }).items.find(
      (entry) => entry.clusterId === `cluster-${gone.id}`,
    )!.key;

    let removed = 0;
    let finished = false;
    for (let step = 0; step < 20 && !finished; step += 1) {
      const result = store.removeOrphanClustersStep!(1);
      removed += result.removed;
      finished = result.passFinished;
    }

    expect(finished).toBe(true);
    expect(removed).toBe(1);
    expect(store.getCluster!(`cluster-${gone.id}`)).toBeUndefined();
    expect(store.getCatalogEntry!(goneKey)).toBeUndefined();
    // Другой источник держит кластер живым; похороненная запись — тоже запись.
    expect(store.getCluster!(`cluster-${goneFounderAliveMember.id}`)).toBeDefined();
    expect(store.getCluster!(`cluster-${alive.id}`)).toBeDefined();
    expect(store.getCluster!(`cluster-${buriedOnly.id}`)).toBeDefined();
  });

  it('finishes a pass and starts over from the beginning', () => {
    const store = open();
    store.saveClusters([clusterOf(vacancy('src-a', '1'))]);
    expect(store.removeOrphanClustersStep!(10)).toMatchObject({ inspected: 1, removed: 1 });
    expect(store.removeOrphanClustersStep!(10)).toMatchObject({ inspected: 0, passFinished: true });
  });
});

describe('SqliteVacancyPoolStore orphan catalog entries', () => {
  it('removes a card whose cluster is already gone', () => {
    const store = openSqlite();
    const kept = vacancy('src-a', '1');
    store.mergeSourceSlice('src-a', [kept]);
    store.saveClusters([clusterOf(kept), clusterOf(vacancy('src-a', '2'))]);
    const database = (store as unknown as { database: { exec(sql: string): void } }).database;
    // Как на проде: старт-очистка по возрасту сняла кластер, но не его карточку.
    database.exec(`DELETE FROM vacancy_clusters WHERE id = 'cluster-src-a:2'`);
    expect(store.loadCatalogEntriesPage({ limit: 10 }).total).toBe(2);

    for (let step = 0; step < 10; step += 1) {
      if (store.removeOrphanClustersStep(50).passFinished) break;
    }
    expect(store.loadCatalogEntriesPage({ limit: 10 }).items.map((e) => e.clusterId)).toEqual([
      `cluster-${kept.id}`,
    ]);
  });
});

describe('MaintenanceWorker orphan cluster step', () => {
  it('logs removals and rests after a finished pass', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const step = vi
      .fn()
      .mockReturnValueOnce({ inspected: 5, removed: 2, passFinished: false })
      .mockReturnValueOnce({ inspected: 0, removed: 0, passFinished: true });
    const engine = { runOrphanClusterStep: step } as unknown as ConstructorParameters<
      typeof MaintenanceWorker
    >[0]['engine'];
    let now = 0;
    const worker = new MaintenanceWorker({ engine, log, now: () => now });

    worker.runOrphanClusterStep();
    worker.runOrphanClusterStep();
    now += 60_000;
    worker.runOrphanClusterStep();
    expect(step).toHaveBeenCalledTimes(2);
    expect(log.info).toHaveBeenCalledWith(
      { inspected: 5, removed: 2, passFinished: false },
      'vacancy-orphan-clusters-tick',
    );
  });
});
