import { describe, expect, it } from 'vitest';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';

/**
 * B763: на проде 23.11 срез hh писался с 23:10Z до выката в 00:08Z, а
 * сведение шло только после записи всего среза. Остановка оборвала волну, и
 * 1 534 из 2 344 записанных строк остались без кластера — без пути назад.
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

function vacancy(sourceId: string, key: string): UnifiedVacancy {
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
      externalId: key,
      sourceUrl: url,
      observedAt: new Date().toISOString(),
    },
    publishedAt: new Date().toISOString(),
    status: 'active',
  };
}

function build(reading: UnifiedVacancy[]) {
  const pool = new SqliteVacancyPoolStore({ databasePath: ':memory:', writeChunkSize: 2 });
  const engine = new MultiSourceVacancyEngine({
    sources: [source('alpha')],
    pool,
    fetcher: async () => reading,
    recluster: { mode: 'keyed', batchSize: 2 },
  });
  return { pool, engine };
}

/** Остановка посреди записи: вторая порция среза не дописывается. */
function stopOnSecondChunk(pool: SqliteVacancyPoolStore): void {
  const target = pool as unknown as { prepareUpsertRows: (...args: unknown[]) => unknown };
  const prepare = target.prepareUpsertRows.bind(pool);
  let calls = 0;
  target.prepareUpsertRows = (...args: unknown[]) => {
    calls += 1;
    if (calls === 2) throw new Error('stopped');
    return prepare(...args);
  };
}

const clusteredIds = (pool: SqliteVacancyPoolStore) =>
  pool
    .loadClusters()
    .flatMap((cluster) => cluster.sources.map((s) => `${s.sourceId}:${s.externalId}`))
    .sort();

describe('B763: rows written before a stop still get clusters', () => {
  it('clusters each written chunk right away, not after the whole slice', async () => {
    const reading = ['a1', 'a2', 'a3', 'a4'].map((key) => vacancy('alpha', key));
    const { pool, engine } = build(reading);
    stopOnSecondChunk(pool);

    await engine.syncSource('alpha').catch(() => undefined);

    expect(
      pool
        .loadVacancies()
        .map((v) => v.id)
        .sort(),
    ).toEqual(['alpha:a1', 'alpha:a2']);
    expect(clusteredIds(pool)).toEqual(['alpha:a1', 'alpha:a2']);
    pool.close();
  });

  it('the catch-up step clusters pool rows that have no cluster, once', async () => {
    const { pool, engine } = build([]);
    // Запись без сведения — то, что осталось на проде после оборванной волны.
    pool.replaceSourceSlice(
      'alpha',
      ['a1', 'a2', 'a3'].map((key) => vacancy('alpha', key)),
    );
    expect(pool.countClusters()).toBe(0);

    const steps = [];
    for (let i = 0; i < 10; i += 1) {
      const step = await engine.runUnclusteredCatchUpStep(2);
      steps.push(step);
      if (step.passFinished) break;
    }

    expect(steps.at(-1)?.passFinished).toBe(true);
    expect(steps.reduce((sum, step) => sum + step.clustered, 0)).toBe(3);
    expect(clusteredIds(pool)).toEqual(['alpha:a1', 'alpha:a2', 'alpha:a3']);

    // Второй проход ничего не создаёт: у строк уже есть кластер.
    let again = 0;
    for (let i = 0; i < 10; i += 1) {
      const step = await engine.runUnclusteredCatchUpStep(2);
      again += step.clustered;
      if (step.passFinished) break;
    }
    expect(again).toBe(0);
    expect(pool.countClusters()).toBe(3);
    pool.close();
  });
});
