import { describe, expect, it } from 'vitest';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';

/**
 * B230, срез 2: режим `keyed` сводит каждую волну с соседями из
 * `vacancy_cluster_keys`, а не с целым пулом. Замена среза площадки снимает
 * ушедшие записи с кластеров точечно; полная пересборка не вызывается никогда.
 */
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
  key: string,
  over: Partial<UnifiedVacancy> = {},
): UnifiedVacancy {
  const url = `https://${sourceId}.example/jobs/${key}`;
  return {
    id: `${sourceId}:${key}`,
    fingerprint: `${sourceId}:${key}`,
    title: `Backend Engineer ${key}`,
    company: `Firm ${key}Q`,
    description: 'Go, Kubernetes',
    requiredSkills: ['Go'],
    url,
    provenance: {
      sourceType: 'json_api',
      sourceId,
      sourceUrl: url,
      observedAt: new Date().toISOString(),
    },
    publishedAt: new Date().toISOString(),
    status: 'active',
    ...over,
  };
}

function build(
  readings: Map<string, UnifiedVacancy[]>,
  linkProbe?: (url: string) => Promise<{ status: number }>,
) {
  const pool = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
  const engine = new MultiSourceVacancyEngine({
    sources: [source('alpha'), source('beta')],
    pool,
    fetcher: async (s) => readings.get(s.id) ?? [],
    recluster: { mode: 'keyed', batchSize: 2 },
    ...(linkProbe ? { linkProbe } : {}),
  });
  return { pool, engine };
}

describe('recluster mode keyed (B230)', () => {
  it('a wave clusters new records with their key neighbours across sources', async () => {
    const readings = new Map<string, UnifiedVacancy[]>([
      ['alpha', [vacancy('alpha', 'a1'), vacancy('alpha', 'a2'), vacancy('alpha', 'a3')]],
      // Та же ссылка → тот же кластер; чужая запись → свой кластер.
      [
        'beta',
        [
          vacancy('beta', 'a1', { url: 'https://alpha.example/jobs/a1?ref=beta' }),
          vacancy('beta', 'b9'),
        ],
      ],
    ]);
    const { pool, engine } = build(readings);

    await engine.syncDue();

    expect(engine.clusterRebuildCount).toBe(0);
    expect(engine.reclusterStats.pending).toBe(0);
    const clusters = pool.loadClusters();
    expect(clusters).toHaveLength(4);
    const shared = clusters.find((c) => c.vacanciesCount === 2)!;
    expect(shared.sources.map((s) => s.sourceId).sort()).toEqual(['alpha', 'beta']);
    // Проекция каталога видит новые кластеры сразу.
    expect(pool.loadCatalogEntriesPage({ limit: 10 }).items).toHaveLength(4);
    pool.close();
  });

  it('replacing a source slice detaches gone records instead of rebuilding', async () => {
    const readings = new Map<string, UnifiedVacancy[]>([
      ['alpha', [vacancy('alpha', 'a1'), vacancy('alpha', 'a2')]],
      ['beta', [vacancy('beta', 'a1', { url: 'https://alpha.example/jobs/a1?ref=beta' })]],
    ]);
    const { pool, engine } = build(readings);
    await engine.syncDue();
    expect(pool.countClusters()).toBe(2);

    // alpha сняла обе: a1 остаётся кластером beta, a2 исчезает совсем.
    readings.set('alpha', []);
    await engine.syncSource('alpha');

    expect(engine.clusterRebuildCount).toBe(0);
    const clusters = pool.loadClusters();
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.vacanciesCount).toBe(1);
    expect(clusters[0]!.sources.map((s) => s.sourceId)).toEqual(['beta']);
    expect(engine.poolSize).toBe(1);
    pool.close();
  });

  it('a link that died leaves its cluster without loading every cluster', async () => {
    const readings = new Map<string, UnifiedVacancy[]>([
      ['alpha', [vacancy('alpha', 'a1'), vacancy('alpha', 'a2')]],
      ['beta', []],
    ]);
    const { pool, engine } = build(readings, async (url) => ({
      status: url.endsWith('/a2') ? 404 : 200,
    }));
    await engine.syncDue();
    expect(pool.countClusters()).toBe(2);

    await engine.probeSourceLinks('alpha');

    expect(engine.clusterRebuildCount).toBe(0);
    expect(pool.countClusters()).toBe(1);
    expect(pool.loadClusters()[0]!.sources[0]!.sourceUrl).toBe('https://alpha.example/jobs/a1');
    pool.close();
  });

  it('explicit full recluster is refused in keyed mode', async () => {
    const { pool, engine } = build(new Map([['alpha', [vacancy('alpha', 'a1')]]]));
    await engine.syncDue();
    expect(() => engine.recluster()).toThrow(/recluster/);
    pool.close();
  });
});
