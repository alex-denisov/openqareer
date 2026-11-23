import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { UnifiedVacancy, VacancyCluster, VacancySourceConfig } from '../domain/unifiedVacancy';
import { splitClustersStep } from './clusterSplitStep';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import { createClusterFromVacancy, mergeVacancyIntoCluster } from './vacancyDeduplicator';

/**
 * B752, ворота PR: шаг разбиения и обслуживание пишут одни и те же строки
 * кластеров. После шага следующий приход тех же записей через движок
 * (`keyed`, как на проде) не должен вернуть основателю чужие источники.
 */
const VK = 'src-fh-vk';
const ORACLE = 'src-fh-oracle';

function source(id: string): VacancySourceConfig {
  return {
    id,
    name: id,
    type: 'json_api',
    enabled: true,
    targetUrl: `https://${id}.example/jobs`,
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  };
}

function vacancy(
  sourceId: string,
  externalId: string,
  company: string,
  title: string,
): UnifiedVacancy {
  const url = `https://${sourceId}.example/jobs/${externalId}`;
  const now = new Date().toISOString();
  return {
    id: `${sourceId}:${externalId}`,
    fingerprint: `fp-${sourceId}-${externalId}`,
    title,
    company,
    description: `${title} at ${company}`,
    requiredSkills: ['Go'],
    url,
    provenance: { sourceType: 'json_api', sourceId, sourceUrl: url, externalId, observedAt: now },
    publishedAt: now,
    status: 'active',
  };
}

const vk = vacancy(VK, '55418', 'VK', 'Go Developer');
const oracle = vacancy(ORACLE, '55418', 'Tata Capital', 'Relationship Manager');

let pool: SqliteVacancyPoolStore | undefined;
afterEach(() => pool?.close());

function clusters(db: DatabaseSync): VacancyCluster[] {
  return (
    db.prepare('SELECT cluster_json FROM vacancy_clusters ORDER BY rowid').all() as {
      cluster_json: string;
    }[]
  ).map((row) => JSON.parse(row.cluster_json) as VacancyCluster);
}

describe('cluster split against the maintenance engine (B752)', () => {
  it('a re-poll after the split keeps the founder without the foreign source', async () => {
    pool = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
    const db = (pool as unknown as { database: DatabaseSync }).database;
    const readings = new Map([
      [VK, [vk]],
      [ORACLE, [oracle]],
    ]);
    const engine = new MultiSourceVacancyEngine({
      sources: [source(VK), source(ORACLE)],
      pool,
      fetcher: async (s) => readings.get(s.id) ?? [],
      recluster: { mode: 'keyed', batchSize: 2 },
    });
    await engine.syncDue();
    // Состояние до B752: оба источника склеены голым id в кластер VK.
    for (const cluster of clusters(db)) pool.deleteCluster(cluster.id);
    const legacy = createClusterFromVacancy(vk);
    mergeVacancyIntoCluster(legacy, oracle);
    pool.saveClusters([legacy]);

    expect(splitClustersStep(db, { chunk: 200 })).toMatchObject({ split: 1, pieces: 1 });
    await engine.syncSource(VK);
    await engine.syncSource(ORACLE);

    const after = clusters(db);
    const founder = after.find((cluster) => cluster.id === legacy.id);
    expect(founder?.sources.map((s) => s.sourceId)).toEqual([VK]);
    const withOracle = after.filter((cluster) =>
      cluster.sources.some((s) => s.sourceId === ORACLE),
    );
    expect(withOracle.map((cluster) => cluster.id)).toEqual([`cluster-${oracle.id}`]);
    expect(after).toHaveLength(2);
  });

  it('drops its in-memory cluster snapshot so a stale founder is never written back', async () => {
    pool = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
    const engine = new MultiSourceVacancyEngine({
      sources: [source(VK)],
      pool,
      fetcher: async () => [vk],
      recluster: { mode: 'keyed', batchSize: 2 },
    });
    const legacy = createClusterFromVacancy(vk);
    mergeVacancyIntoCluster(legacy, oracle);
    const inner = engine as unknown as {
      clusters: VacancyCluster[];
      clusterBuilder?: { getClusters(): VacancyCluster[] };
    };
    inner.clusters = [legacy];

    engine.dropClusterSnapshot();

    expect(inner.clusters).toEqual([]);
    expect(inner.clusterBuilder?.getClusters() ?? []).toEqual([]);
  });
});
