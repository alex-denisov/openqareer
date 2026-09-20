import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { UnifiedVacancy, VacancyCluster } from '../domain/unifiedVacancy';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import { clusterKeys, clusterVacancies } from './vacancyDeduplicator';

function vacancy(index: number): UnifiedVacancy {
  const url = `https://jobs.example/${index}`;
  return {
    id: `v-${index}`,
    fingerprint: `fp-${index}`,
    title: `Backend Engineer ${index}`,
    company: `Firm ${index}Q`,
    description: 'Go, Kubernetes',
    requiredSkills: ['Go'],
    url,
    provenance: {
      sourceType: 'json_api',
      sourceId: 'src',
      sourceUrl: url,
      observedAt: new Date().toISOString(),
    },
    publishedAt: new Date().toISOString(),
    status: 'active',
  };
}

function readKeys(path: string): Array<{ kind: string; key: string; cluster_id: string }> {
  const db = new DatabaseSync(path);
  const rows = db
    .prepare(
      'SELECT kind, key, cluster_id FROM vacancy_cluster_keys ORDER BY cluster_id, kind, key',
    )
    .all() as unknown as Array<{ kind: string; key: string; cluster_id: string }>;
  db.close();
  return rows;
}

function expectedKeys(clusters: readonly VacancyCluster[]) {
  return clusters
    .flatMap((cluster) =>
      clusterKeys(cluster).map(({ kind, key }) => ({ kind, key, cluster_id: cluster.id })),
    )
    .filter(
      (row, index, all) =>
        all.findIndex(
          (o) => o.kind === row.kind && o.key === row.key && o.cluster_id === row.cluster_id,
        ) === index,
    )
    .sort(
      (a, b) =>
        a.cluster_id.localeCompare(b.cluster_id) ||
        a.kind.localeCompare(b.kind) ||
        a.key.localeCompare(b.key),
    );
}

/** База «до B230»: кластеры есть, ключей нет, курсор на нуле. */
function stripKeys(path: string): void {
  const db = new DatabaseSync(path);
  db.exec(
    'DELETE FROM vacancy_cluster_keys; UPDATE cluster_keys_backfill_state SET cursor_rowid = 0, completed = 0',
  );
  db.close();
}

describe('vacancy_cluster_keys (B230)', () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });
  function freshPath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'cluster-keys-'));
    directories.push(directory);
    return join(directory, 'db.sqlite');
  }

  it('saveClusters writes exactly the ClusterIndex keys and deleteCluster clears them', () => {
    const path = freshPath();
    const store = new SqliteVacancyPoolStore({ databasePath: path });
    const clusters = clusterVacancies(Array.from({ length: 30 }, (_, i) => vacancy(i)));
    store.saveClusters(clusters);
    expect(readKeys(path)).toEqual(expectedKeys(clusters));
    expect(readKeys(path).some((row) => row.kind === 'member')).toBe(true);

    store.deleteCluster(clusters[0]!.id);
    expect(readKeys(path).some((row) => row.cluster_id === clusters[0]!.id)).toBe(false);
    store.close();
  });

  it('backfill is resumable across reopen and idempotent', () => {
    const path = freshPath();
    const clusters = clusterVacancies(Array.from({ length: 1_250 }, (_, i) => vacancy(i)));
    const seed = new SqliteVacancyPoolStore({ databasePath: path });
    seed.replaceClusters(clusters);
    seed.close();
    stripKeys(path);

    const first = new SqliteVacancyPoolStore({ databasePath: path });
    expect(first.clusterKeysReady()).toBe(false);
    expect(first.backfillClusterKeysStep(500)).toBe(500);
    expect(first.backfillClusterKeysStep(500)).toBe(500);
    first.close();

    // Процесс перезапустился посреди заполнения: курсор пережил перезапуск.
    const second = new SqliteVacancyPoolStore({ databasePath: path });
    expect(second.clusterKeysReady()).toBe(false);
    expect(second.backfillClusterKeysStep(500)).toBe(250);
    expect(second.backfillClusterKeysStep(500)).toBe(0);
    expect(second.clusterKeysReady()).toBe(true);
    expect(second.backfillClusterKeysStep(500)).toBe(0);
    expect(readKeys(path)).toEqual(expectedKeys(clusters));
    second.close();

    // Готовность тоже переживает перезапуск.
    const third = new SqliteVacancyPoolStore({ databasePath: path });
    expect(third.clusterKeysReady()).toBe(true);
    third.close();
  });

  it('a fresh database is ready at once: nothing to backfill', () => {
    const store = new SqliteVacancyPoolStore({ databasePath: freshPath() });
    expect(store.backfillClusterKeysStep(500)).toBe(0);
    expect(store.clusterKeysReady()).toBe(true);
    store.close();
  });

  it('catalog entries follow saveClusters after the projection is complete (step 10)', () => {
    const store = new SqliteVacancyPoolStore({ databasePath: freshPath() });
    while (store.backfillCatalogEntriesStep(500) > 0) {
      /* до конца */
    }
    expect(store.catalogProjectionReady()).toBe(true);
    const clusters = clusterVacancies([vacancy(1), vacancy(2)]);
    store.saveClusters(clusters);
    expect(store.loadCatalogEntriesPage({ limit: 10 }).items.length).toBe(2);
    store.deleteCluster(clusters[0]!.id);
    expect(store.loadCatalogEntriesPage({ limit: 10 }).items.length).toBe(1);
    store.close();
  });
});
