import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { expireClusterSources } from './clusterExpiry';
import { clusterBatchByKeys, detachVacanciesByKeys } from './keyedClusterer';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import { clusterKeys, createClusterFromVacancy, memberKeysOf } from './vacancyDeduplicator';

/**
 * B752: ключ члена кластера — пара площадка × внешний id. Голый id сводил
 * вакансию VK 55418 с вакансией Oracle-тенанта 55418 (52 174 кластера на проде).
 */
const VK = 'src-fh-vk';
const ORACLE = 'src-fh-oracle-eofh-fa-em2-oraclecloud-com-cx-3001';

function vacancy(
  sourceId: string,
  externalId: string,
  over: { company?: string; title?: string; url?: string } = {},
): UnifiedVacancy {
  const url = over.url ?? `https://${sourceId}.example/jobs/${externalId}`;
  return {
    id: `${sourceId}:${externalId}`,
    fingerprint: `fp-${sourceId}-${externalId}-${over.title ?? ''}`,
    title: over.title ?? 'Backend Developer',
    company: over.company ?? 'VK',
    description: `Role at ${over.company ?? 'VK'} ${over.title ?? ''}`,
    requiredSkills: ['Go'],
    url,
    provenance: {
      sourceType: 'json_api',
      sourceId,
      sourceUrl: url,
      externalId,
      observedAt: '2026-11-01T00:00:00.000Z',
    },
    publishedAt: '2026-11-01T00:00:00.000Z',
    status: 'active',
  };
}

const vk = () => vacancy(VK, '55418', { company: 'VK', title: 'Go Developer' });
const oracle = () =>
  vacancy(ORACLE, '55418', { company: 'Tata Capital', title: 'Relationship Manager' });

function databaseOf(store: SqliteVacancyPoolStore): DatabaseSync {
  return (store as unknown as { database: DatabaseSync }).database;
}

/** Кластер как до B752: ключи членства и представитель — с голым внешним id. */
function toLegacy(store: SqliteVacancyPoolStore, clusterId: string): void {
  const database = databaseOf(store);
  const cluster = store.getCluster(clusterId)!;
  const bare = new Map(cluster.sources.map((s) => [`${s.sourceId}:${s.externalId}`, s.externalId!]));
  for (const [scoped, plain] of bare) {
    database
      .prepare("UPDATE OR IGNORE vacancy_cluster_keys SET key = ? WHERE kind = 'member' AND key = ? AND cluster_id = ?")
      .run(plain, scoped, clusterId);
  }
  const row = database.prepare('SELECT representative FROM vacancy_clusters WHERE id = ?').get(clusterId) as {
    representative: string;
  };
  const representative = JSON.parse(row.representative) as { m: string[] };
  const m = representative.m.map((key) => bare.get(key) ?? key);
  database
    .prepare('UPDATE vacancy_clusters SET representative = ? WHERE id = ?')
    .run(JSON.stringify({ ...representative, m }), clusterId);
}

describe('source-scoped member keys (B752)', () => {
  it('member keys carry the source id, never the bare external id', () => {
    const cluster = createClusterFromVacancy(oracle());
    const members = clusterKeys(cluster)
      .filter((key) => key.kind === 'member')
      .map((key) => key.key);
    expect(members).toContain(`${ORACLE}:55418`);
    expect(members).not.toContain('55418');
    expect(memberKeysOf(oracle())).toContain(`${ORACLE}:55418`);
    expect(memberKeysOf(oracle())).not.toContain('55418');
    expect(memberKeysOf({ id: 'x', provenance: { externalId: '55418' } })).toEqual(['x']);
  });

  it('same external id on two sources gives two clusters, also after a second poll', () => {
    const store = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
    clusterBatchByKeys(store, [vk()]);
    clusterBatchByKeys(store, [oracle()]);
    expect(store.countClusters()).toBe(2);
    clusterBatchByKeys(store, [vk(), oracle()]);
    clusterBatchByKeys(store, [oracle()]);
    const clusters = store.loadClusters();
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.vacanciesCount)).toEqual([1, 1]);
    store.close();
  });

  it('same source and external id is one cluster even with another url', () => {
    const store = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
    clusterBatchByKeys(store, [vk()]);
    clusterBatchByKeys(store, [
      vacancy(VK, '55418', { company: 'Other', title: 'Renamed', url: 'https://vk.example/x' }),
    ]);
    expect(store.countClusters()).toBe(1);
    store.close();
  });

  it('the same sourceUrl on two sources still merges', () => {
    const store = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
    const url = 'https://jobs.acme.example/123';
    clusterBatchByKeys(store, [vacancy('src-ats', '1', { company: 'Acme', title: 'QA', url })]);
    clusterBatchByKeys(store, [vacancy('src-site', '9', { company: 'Acme', title: 'QA', url })]);
    expect(store.countClusters()).toBe(1);
    expect(store.loadClusters()[0]!.vacanciesCount).toBe(2);
    store.close();
  });

  it('detaching Oracle 55418 keeps the VK 55418 source of a collided cluster', () => {
    const store = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
    const collided = createClusterFromVacancy(vk());
    const oracleSource = oracle().provenance;
    store.saveClusters([
      { ...collided, sources: [...collided.sources, oracleSource], vacanciesCount: 2 },
    ]);
    const result = detachVacanciesByKeys(store, [oracle()]);
    expect(result).toEqual({ updated: 1, deleted: 0 });
    const left = store.getCluster(collided.id)!;
    expect(left.sources.map((s) => s.sourceId)).toEqual([VK]);
    store.close();
  });

  it('expiry by vacancy id removes only the source with that pair', () => {
    const collided = createClusterFromVacancy(vk());
    const cluster = {
      ...collided,
      sources: [...collided.sources, oracle().provenance],
      vacanciesCount: 2,
    };
    const next = expireClusterSources(cluster, new Set([`${ORACLE}:55418`]));
    expect(next.sources.map((s) => s.sourceId)).toEqual([VK]);
    expect(expireClusterSources(cluster, new Set(['55418']))).toBe(cluster);
  });

  it('a legacy bare member key merges only a record of the same source', () => {
    const store = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
    const legacy = createClusterFromVacancy(vk());
    store.saveClusters([legacy]);
    const database = databaseOf(store);
    database
      .prepare("UPDATE vacancy_cluster_keys SET key = '55418' WHERE kind = 'member' AND key = ?")
      .run(`${VK}:55418`);
    const row = database
      .prepare('SELECT representative FROM vacancy_clusters WHERE id = ?')
      .get(legacy.id) as { representative: string };
    const representative = JSON.parse(row.representative) as { m: string[] };
    const bare = {
      ...representative,
      m: representative.m.map((m) => (m.includes(':') ? '55418' : m)),
    };
    database
      .prepare('UPDATE vacancy_clusters SET representative = ? WHERE id = ?')
      .run(JSON.stringify(bare), legacy.id);
    clusterBatchByKeys(store, [oracle()]);
    expect(store.countClusters()).toBe(2);
    clusterBatchByKeys(store, [
      vacancy(VK, '55418', { company: 'Other', title: 'Renamed', url: 'https://vk.example/x' }),
    ]);
    expect(store.countClusters()).toBe(2);
    expect(store.getCluster(legacy.id)!.sources.every((s) => s.sourceId === VK)).toBe(true);
    store.close();
  });

  it('detaching a legacy-only cluster still removes it', () => {
    const store = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
    const legacy = createClusterFromVacancy(vk());
    store.saveClusters([legacy]);
    toLegacy(store, legacy.id);
    expect(detachVacanciesByKeys(store, [vk()])).toEqual({ updated: 0, deleted: 1 });
    expect(store.getCluster(legacy.id)).toBeUndefined();
    store.close();
  });

  it('re-polling a collided legacy VK+Oracle cluster creates no duplicates', () => {
    const store = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
    const collided = createClusterFromVacancy(vk());
    store.saveClusters([{ ...collided, sources: [...collided.sources, oracle().provenance], vacanciesCount: 2 }]);
    toLegacy(store, collided.id);
    clusterBatchByKeys(store, [vk(), oracle()]);
    clusterBatchByKeys(store, [vk(), oracle()]);
    expect(store.countClusters()).toBe(1);
    store.close();
  });

  it('two legacy clusters with one bare key: the record goes to the one with its source', () => {
    const store = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
    const vkCluster = createClusterFromVacancy(vk());
    // Сортируется после VK: в старой карте «последний выигрывает» ключ достался бы ему.
    const oracleCluster = createClusterFromVacancy(
      vacancy('src-zz-tenant', '55418', { company: 'Tata Capital', title: 'Relationship Manager' }),
    );
    store.saveClusters([vkCluster]);
    store.saveClusters([oracleCluster]);
    toLegacy(store, vkCluster.id);
    toLegacy(store, oracleCluster.id);
    // Id записи не «площадка:внешний id» (так у части адаптеров): найти кластер можно только по голому ключу.
    const moved = {
      ...vacancy(VK, '55418', { company: 'Other', title: 'Renamed', url: 'https://vk.example/moved' }),
      id: `${VK}:moved-55418`,
    };
    clusterBatchByKeys(store, [moved]);
    expect(store.countClusters()).toBe(2);
    expect(store.getCluster(vkCluster.id)!.sources.map((s) => s.sourceUrl)).toContain('https://vk.example/moved');
    expect(store.getCluster(oracleCluster.id)!.sources.every((s) => s.sourceId === 'src-zz-tenant')).toBe(true);
    store.close();
  });
});
