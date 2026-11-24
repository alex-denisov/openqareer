import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { OVER_CAP_TOKENS_TTL_MS, SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';

/**
 * B761 23.11: после стоп-листа `bucketSize` занял 12,5 % профиля — каждый токен за
 * потолком («group», «manager») заново читал 2 000 строк индекса в каждой партии.
 * Такой токен помнится в памяти и перечитывается раз в `OVER_CAP_TOKENS_TTL_MS`.
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

const FILLERS = Array.from({ length: 6 }, (_, index) =>
  vacancy('alpha', `f${index}`, `Senior Manager Role${index}x`, `Filler${index}x Group`),
);

async function setup() {
  let clock = Date.parse('2026-11-23T04:00:00Z');
  const readings = new Map<string, UnifiedVacancy[]>([['alpha', [...FILLERS]]]);
  const pool = new SqliteVacancyPoolStore({
    databasePath: ':memory:',
    bucketSizeCap: 3,
    now: () => clock,
  });
  const engine = new MultiSourceVacancyEngine({
    sources: [source('alpha'), source('beta')],
    pool,
    fetcher: async (s) => readings.get(s.id) ?? [],
    recluster: { mode: 'keyed', batchSize: 10 },
  });
  await engine.syncSource('alpha');
  const database = (pool as unknown as { database: DatabaseSync }).database;
  const sized: string[] = [];
  const exact: string[] = [];
  const prepare = database.prepare.bind(database);
  database.prepare = ((sql: string) => {
    const statement = prepare(sql);
    if (sql.includes('SELECT count(*) AS n FROM vacancy_cluster_keys WHERE kind = ?')) {
      const getExact = statement.get.bind(statement);
      statement.get = ((...params: Parameters<typeof getExact>) => {
        exact.push(String(params[1]));
        return getExact(...params);
      }) as typeof statement.get;
      return statement;
    }
    if (!/SELECT count\(\*\) AS n FROM \(\s*SELECT 1 FROM vacancy_cluster_keys/.test(sql))
      return statement;
    const get = statement.get.bind(statement);
    statement.get = ((...params: Parameters<typeof get>) => {
      sized.push(String(params[1]));
      return get(...params);
    }) as typeof statement.get;
    return statement;
  }) as DatabaseSync['prepare'];
  const sync = async (key: string, title: string, company = `${key}co Group`) => {
    readings.set('beta', [vacancy('beta', key, title, company)]);
    await engine.syncSource('beta');
  };
  return { pool, sized, exact, sync, advance: (ms: number) => (clock += ms) };
}

describe('over-cap tokens are remembered between batches (B761)', () => {
  it('counts a generic token once across batches and again after the rest period', async () => {
    const { pool, sized, sync, advance } = await setup();
    const groupReads = () => sized.filter((key) => key === 'group').length;
    await sync('b1', 'Senior Manager Payroll');
    expect(groupReads()).toBe(1);

    await sync('b2', 'Senior Manager Treasury');
    expect(groupReads()).toBe(1);

    advance(OVER_CAP_TOKENS_TTL_MS);
    await sync('b3', 'Senior Manager Audit');
    expect(groupReads()).toBe(2);
    pool.close();
  });

  it('a side of generic tokens only counts their exact sizes once across batches', async () => {
    const { pool, exact, sync, advance } = await setup();
    await sync('g1', 'Senior Manager', 'Group');
    const first = exact.length;
    expect(first).toBeGreaterThan(0);

    await sync('g2', 'Senior Manager', 'Group');
    expect(exact.length).toBe(first);

    advance(OVER_CAP_TOKENS_TTL_MS);
    await sync('g3', 'Senior Manager', 'Group');
    expect(exact.length).toBeGreaterThan(first);
    pool.close();
  });
});
