import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';

/**
 * B761 23.11: поиск «общий работодатель и общее название» — 51 % профиля обслуживания.
 * В срезе ATS-доски одна компания и горстка названий: на проде 137 вакансий давали
 * 17 разных пар, 66 — 7, 40 — 5, а запрос шёл на каждую вакансию. Внутри одной партии
 * ответ для пары (компания, название) один и читается один раз.
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

function vacancy(sourceId: string, key: string, title: string, company: string): UnifiedVacancy {
  const url = `https://${sourceId}.example/jobs/${key}`;
  return {
    id: `${sourceId}:${key}`,
    fingerprint: `${sourceId}:${key}`,
    title,
    company,
    description: `Описание ${sourceId} ${key}`,
    requiredSkills: [],
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

async function syncBatch(beta: UnifiedVacancy[]) {
  const readings = new Map<string, UnifiedVacancy[]>([
    ['alpha', [vacancy('alpha', 'a1', 'Payroll Specialist', 'Acme')]],
    ['beta', []],
  ]);
  const pool = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
  const engine = new MultiSourceVacancyEngine({
    sources: [source('alpha'), source('beta')],
    pool,
    fetcher: async (s) => readings.get(s.id) ?? [],
    recluster: { mode: 'keyed', batchSize: 50 },
  });
  await engine.syncSource('alpha');
  const database = (pool as unknown as { database: DatabaseSync }).database;
  let pairQueries = 0;
  const prepare = database.prepare.bind(database);
  database.prepare = ((sql: string) => {
    const statement = prepare(sql);
    if (!sql.includes('SELECT DISTINCT o.cluster_id')) return statement;
    const all = statement.all.bind(statement);
    statement.all = ((...params: Parameters<typeof all>) => {
      pairQueries += 1;
      return all(...params);
    }) as typeof statement.all;
    return statement;
  }) as DatabaseSync['prepare'];
  readings.set('beta', beta);
  await engine.syncSource('beta');
  return { pool, pairQueries: () => pairQueries };
}

describe('company+title neighbours are read once per pair within a batch (B761)', () => {
  it('a board slice of one company with repeated titles asks once per distinct pair', async () => {
    const beta = [
      ...Array.from({ length: 6 }, (_, i) =>
        vacancy('beta', `p${i}`, 'Payroll Specialist', 'Acme'),
      ),
      ...Array.from({ length: 4 }, (_, i) => vacancy('beta', `t${i}`, 'Treasury Analyst', 'Acme')),
    ];
    const { pool, pairQueries } = await syncBatch(beta);
    expect(pairQueries()).toBeLessThanOrEqual(2);
    const glued = pool.loadClusters().find((cluster) => cluster.vacanciesCount > 1);
    expect(glued?.sources.map((s) => s.sourceId)).toContain('alpha');
    pool.close();
  });
});
