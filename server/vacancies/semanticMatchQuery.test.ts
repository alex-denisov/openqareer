import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { MIGRATION_35 } from '../data/sqliteSchema';
import { VACANCY_CLUSTER_INPUT_TABLE, VACANCY_POOL_INDEX_TABLE } from '../data/sqliteSchema';
import { buildSemanticMatchQuery } from './semanticMatchQuery';

/**
 * План запроса и корректность выборки (B267 S3, план §4-5): одна ветка на
 * код функции читает `vacancy_semantic_match` напрямую, без полного
 * сканирования таблицы.
 */
describe('buildSemanticMatchQuery (B267 S3)', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = new DatabaseSync(':memory:');
    database.exec(MIGRATION_35);
    database.exec(VACANCY_POOL_INDEX_TABLE);
    database.exec(VACANCY_CLUSTER_INPUT_TABLE);
  });

  function seed(
    id: string,
    functionCode: string,
    levelRank: number | null,
    publishedMs: number,
    isRemote = 0,
  ): void {
    database
      .prepare(
        'INSERT INTO vacancy_semantic (id, function_code, level_rank, title_key, published_ms, is_remote) VALUES (?,?,?,?,?,?)',
      )
      .run(id, functionCode, levelRank, `title-${id}`, publishedMs, isRemote);
    database
      .prepare(
        'INSERT INTO vacancy_pool_index (id, source_id, published_ms, observed_ms, is_active, is_remote, url, search_text, expired) VALUES (?,?,?,?,1,?,?,?,0)',
      )
      .run(id, 'src', publishedMs, publishedMs, isRemote, `https://x/${id}`, id);
    database
      .prepare('INSERT INTO vacancy_cluster_input (id, cluster_json) VALUES (?, ?)')
      .run(id, JSON.stringify({ id }));
  }

  it('использует индекс vacancy_semantic_match и не сканирует таблицу целиком', () => {
    seed('v1', 'eng-mgmt', 3, 1_000);
    const { sql, params } = buildSemanticMatchQuery({
      functionCodes: ['eng-mgmt', 'it-ops', 'ops'],
      levelRank: 3,
      window: { fromMs: 0, toMs: 2_000 },
      preferRemote: false,
      limit: 50,
    });
    const plan = database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{
      detail: string;
    }>;
    const detail = plan.map((row) => row.detail).join('\n');
    expect(detail).toContain('vacancy_semantic_match');
    expect(detail).not.toMatch(/SCAN .*vacancy_semantic\b/u);
  });

  it('отдаёт совпавшие функции, отсортированные по свежести, без дублей', () => {
    seed('v-old', 'eng-mgmt', 3, 1_000);
    seed('v-new', 'it-ops', 3, 2_000);
    seed('v-other', 'sales', 3, 3_000);
    const { sql, params } = buildSemanticMatchQuery({
      functionCodes: ['eng-mgmt', 'it-ops'],
      levelRank: 3,
      window: { fromMs: 0, toMs: 5_000 },
      preferRemote: false,
      limit: 50,
    });
    const rows = database.prepare(sql).all(...params) as Array<{ payload: string }>;
    expect(rows.map((row) => JSON.parse(row.payload).id)).toEqual(['v-new', 'v-old']);
  });

  it('вне окна уровня (соседняя+1 ступень) запись не попадает в выдачу', () => {
    seed('v-close', 'eng-mgmt', 2, 1_000);
    seed('v-far', 'eng-mgmt', 0, 2_000);
    const { sql, params } = buildSemanticMatchQuery({
      functionCodes: ['eng-mgmt'],
      levelRank: 3,
      window: { fromMs: 0, toMs: 5_000 },
      preferRemote: false,
      limit: 50,
    });
    const rows = database.prepare(sql).all(...params) as Array<{ payload: string }>;
    expect(rows.map((row) => JSON.parse(row.payload).id)).toEqual(['v-close']);
  });
});
