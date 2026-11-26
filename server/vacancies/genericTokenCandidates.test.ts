import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';

/**
 * B761 23.11: «общий токен работодателя и общий токен названия» искал соседей и
 * по словам вроде «group» (29 тыс. кластеров) и «manager» (95 тыс.): 49 с из
 * 70 с профиля обслуживания. Токен, чья корзина не меньше потолка, в сопоставлении
 * не участвует — список берётся из счёта корзин, а не из словаря; если у стороны
 * все токены такие, остаётся самый редкий.
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

async function build(
  pair: readonly [UnifiedVacancy, UnifiedVacancy],
  extra: readonly UnifiedVacancy[] = [],
) {
  const readings = new Map<string, UnifiedVacancy[]>([
    ['alpha', [...FILLERS, ...extra]],
    ['beta', []],
  ]);
  const pool = new SqliteVacancyPoolStore({ databasePath: ':memory:', bucketSizeCap: 3 });
  const engine = new MultiSourceVacancyEngine({
    sources: [source('alpha'), source('beta')],
    pool,
    fetcher: async (s) => readings.get(s.id) ?? [],
    recluster: { mode: 'keyed', batchSize: 10 },
  });
  await engine.syncSource('alpha');
  readings.set('alpha', [...FILLERS, ...extra, pair[0]]);
  await engine.syncSource('alpha');
  const database = (pool as unknown as { database: DatabaseSync }).database;
  const tokenParams: unknown[][] = [];
  const queries: string[] = [];
  const prepare = database.prepare.bind(database);
  database.prepare = ((sql: string) => {
    const statement = prepare(sql);
    if (!sql.includes('SELECT DISTINCT o.cluster_id')) return statement;
    const all = statement.all.bind(statement);
    statement.all = ((...params: Parameters<typeof all>) => {
      tokenParams.push(params);
      queries.push(sql);
      return all(...params);
    }) as typeof statement.all;
    return statement;
  }) as DatabaseSync['prepare'];
  readings.set('beta', [pair[1]]);
  await engine.syncSource('beta');
  const shared = pool.loadClusters().find((cluster) => cluster.vacanciesCount === 2);
  return { pool, tokenParams, queries, shared };
}

describe('company+title neighbours skip tokens over the bucket cap (B761)', () => {
  it('glues twins by their rare tokens and leaves the generic ones out of the query', async () => {
    const { pool, tokenParams, shared } = await build([
      vacancy('alpha', 'p1', 'Senior Manager Payroll', 'Acme Group'),
      vacancy('beta', 'p1', 'Senior Manager Payroll', 'Acme Group'),
    ]);
    expect(shared?.sources.map((s) => s.sourceId).sort()).toEqual(['alpha', 'beta']);
    expect(tokenParams.length).toBeGreaterThan(0);
    const bound = tokenParams.flat().map(String);
    expect(bound).not.toContain('group');
    expect(bound).not.toContain('senior');
    expect(bound).not.toContain('manager');
    pool.close();
  });

  it('a side made only of generic tokens keeps its rarest one, so the twins still meet', async () => {
    const { pool, shared } = await build([
      vacancy('alpha', 'p2', 'Senior Manager', 'Acme Group'),
      vacancy('beta', 'p2', 'Senior Manager', 'Acme Group'),
    ]);
    expect(shared?.sources.map((s) => s.sourceId).sort()).toEqual(['alpha', 'beta']);
    pool.close();
  });

  it('reads two comparable buckets in sequence instead of probing every cluster (B761)', async () => {
    const { pool, queries, shared } = await build([
      vacancy('alpha', 'p3', 'Senior Manager Payroll', 'Acme Group'),
      vacancy('beta', 'p3', 'Senior Manager Payroll', 'Acme Group'),
    ]);
    expect(shared?.vacanciesCount).toBe(2);
    expect(queries.length).toBeGreaterThan(0);
    for (const sql of queries) expect(sql).not.toContain('EXISTS');
    pool.close();
  });

  it('keeps the point probe when one side is far larger than the other (B761)', async () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      vacancy('alpha', `m${index}`, 'Senior Manager', `Other${index}y Group`),
    );
    const { pool, queries, shared } = await build(
      [
        vacancy('alpha', 'p4', 'Senior Manager', 'Acme Group'),
        vacancy('beta', 'p4', 'Senior Manager', 'Acme Group'),
      ],
      many,
    );
    expect(shared?.vacanciesCount).toBe(2);
    expect(queries.some((sql) => sql.includes('EXISTS'))).toBe(true);
    pool.close();
  });
});
