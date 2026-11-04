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
    expect(detail).toMatch(/SEARCH excluded USING .*\(id=\? AND function_code=\?\)/u);
  });

  describe('диапазон грейда кандидата (04.11)', () => {
    const grade = (id: string, min: number, max: number) =>
      database.prepare('INSERT INTO vacancy_grade VALUES (?, ?, ?)').run(`title-${id}`, min, max);
    const selected = (gradeRange: { min: number; max: number } | null) => {
      const { sql, params } = buildSemanticMatchQuery({
        functionCodes: ['eng'],
        levelRank: 0,
        gradeRange,
        window: { fromMs: 0, toMs: 2_000 },
        preferRemote: false,
        limit: 50,
      });
      return (database.prepare(sql).all(...params) as { payload: string }[]).map(
        (row) => (JSON.parse(row.payload) as { id: string }).id,
      );
    };

    it('убирает непересекающийся грейд, соседний и неизвестный оставляет', () => {
      seed('junior', 'eng', 0, 1_000);
      seed('middle', 'eng', 0, 1_001);
      seed('plain', 'eng', 0, 1_002);
      grade('junior', 0, 2);
      grade('middle', 1, 3);
      expect(selected({ min: 3, max: 5 }).sort()).toEqual(['middle', 'plain']);
    });

    it('без диапазона кандидата запрос прежний: таблицу грейдов не читает', () => {
      seed('junior', 'eng', 0, 1_000);
      grade('junior', 0, 2);
      expect(selected(null)).toEqual(['junior']);
      const { sql } = buildSemanticMatchQuery({
        functionCodes: ['eng'],
        levelRank: 0,
        window: { fromMs: 0, toMs: 2_000 },
        preferRemote: false,
        limit: 50,
      });
      expect(sql).not.toContain('vacancy_grade');
    });
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

  it('порог уровня считается на функцию: младшая роль одной функции не открывает остальные', () => {
    seed('ai-junior', 'ai-ml', 0, 3_000);
    seed('support-junior', 'support', 0, 2_000);
    seed('support-head', 'support', 2, 1_000);
    const { sql, params } = buildSemanticMatchQuery({
      functionCodes: ['ai-ml', 'support'],
      levelRank: 3,
      functionLevelFloors: { 'ai-ml': 0, support: 2 },
      window: { fromMs: 0, toMs: 5_000 },
      preferRemote: false,
      limit: 50,
    });
    const rows = database.prepare(sql).all(...params) as Array<{ payload: string }>;
    expect(rows.map((row) => JSON.parse(row.payload).id)).toEqual(['ai-junior', 'support-head']);
  });

  it('рядовая строка ниже порога проходит, только если в названии роль кандидата', () => {
    seed('senior ai consultant', 'consulting', 0, 3_000);
    seed('консультант 1с', 'consulting', 0, 2_000);
    seed('head of consulting', 'consulting', 2, 1_000);
    const { sql, params } = buildSemanticMatchQuery({
      functionCodes: ['consulting'],
      levelRank: 3,
      functionLevelFloors: { consulting: 2 },
      functionSpecialistTitles: { consulting: ['ai consultant'] },
      window: { fromMs: 0, toMs: 5_000 },
      preferRemote: false,
      limit: 50,
    });
    const rows = database.prepare(sql).all(...params) as Array<{ payload: string }>;
    expect(rows.map((row) => JSON.parse(row.payload).id)).toEqual(['senior ai consultant', 'head of consulting']);
  });

  describe('окно чтения при упоре в предел', () => {
    const read = (limit: number, preferRemote = false) => {
      const { sql, params } = buildSemanticMatchQuery({
        functionCodes: ['eng', 'eng-mgmt'],
        levelRank: 3,
        window: { fromMs: 0, toMs: 100_000 },
        preferRemote,
        limit,
      });
      const rows = database.prepare(sql).all(...params) as Array<{ payload: string }>;
      return rows.map((row) => JSON.parse(row.payload).id as string);
    };

    beforeEach(() => {
      for (let i = 0; i < 10; i += 1) seed(`mass-${i}`, 'eng', 3, 50_000 + i, 1);
      seed('small-old', 'eng-mgmt', 3, 1_000);
      seed('small-older', 'eng-mgmt', 3, 500);
    });

    it('массовая функция не вытесняет маленькую, даже новыми удалёнными строками', () => {
      const ids = read(4, true);
      expect(ids).toHaveLength(4);
      expect(ids).toEqual(expect.arrayContaining(['small-old', 'small-older']));
    });

    it('неиспользованная доля маленькой функции переходит массовой', () => {
      const ids = read(6);
      expect(ids.filter((id) => id.startsWith('mass-'))).toHaveLength(4);
      expect(ids.filter((id) => id.startsWith('small-'))).toHaveLength(2);
    });

    it('ниже предела набор и порядок прежние: сначала новые', () => {
      expect(read(50)).toEqual([
        ...Array.from({ length: 10 }, (_, i) => `mass-${9 - i}`),
        'small-old',
        'small-older',
      ]);
    });
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

  it('keeps an unknown level visible for a levelled candidate instead of silently discarding it', () => {
    seed('known', 'eng-mgmt', 3, 1_000);
    seed('unknown', 'eng-mgmt', null, 2_000);
    const window = { fromMs: 0, toMs: 5_000 };
    const levelled = buildSemanticMatchQuery({
      functionCodes: ['eng-mgmt'],
      levelRank: 3,
      window,
      preferRemote: false,
      limit: 50,
    });
    const knownRows = database.prepare(levelled.sql).all(...levelled.params) as Array<{
      payload: string;
    }>;
    expect(knownRows.map((row) => JSON.parse(row.payload).id)).toEqual(['unknown', 'known']);

    const unlevelled = buildSemanticMatchQuery({
      functionCodes: ['eng-mgmt'],
      levelRank: null,
      window,
      preferRemote: false,
      limit: 50,
    });
    const anyLevelRows = database.prepare(unlevelled.sql).all(...unlevelled.params) as Array<{
      payload: string;
    }>;
    expect(anyLevelRows.map((row) => JSON.parse(row.payload).id)).toEqual(['unknown', 'known']);
  });

  it('filters a marketing and operations title from an operations-only campaign', () => {
    seed('ops-role', 'ops', 4, 1_000);
    seed('marketing-ops', 'ops', 3, 2_000);
    seed('ops-marketing-title', 'ops', 4, 3_000);
    database
      .prepare('UPDATE vacancy_semantic SET title_key = ? WHERE id = ? AND function_code = ?')
      .run(
        'chief of staff vp operations marketing advertising ecommerce',
        'ops-marketing-title',
        'ops',
      );
    database
      .prepare(
        `INSERT INTO vacancy_semantic (id, function_code, level_rank, title_key, published_ms, is_remote)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('marketing-ops', 'marketing', 3, 'marketing operations', 2_000, 0);

    const operationsOnly = buildSemanticMatchQuery({
      functionCodes: ['ops'],
      levelRank: 4,
      window: { fromMs: 0, toMs: 5_000 },
      preferRemote: false,
      limit: 50,
    });
    const operationsRows = database
      .prepare(operationsOnly.sql)
      .all(...operationsOnly.params) as Array<{ payload: string }>;
    expect(operationsRows.map((row) => JSON.parse(row.payload).id)).toEqual(['ops-role']);

    const operationsAndMarketing = buildSemanticMatchQuery({
      functionCodes: ['ops', 'marketing'],
      levelRank: 4,
      window: { fromMs: 0, toMs: 5_000 },
      preferRemote: false,
      limit: 50,
    });
    const combinedRows = database
      .prepare(operationsAndMarketing.sql)
      .all(...operationsAndMarketing.params) as Array<{ payload: string }>;
    expect(combinedRows.map((row) => JSON.parse(row.payload).id)).toContain('marketing-ops');
  });

  it('filters finance, PMO and education but keeps Eng & Product composites in a Tech/Ops campaign', () => {
    seed('ops-role', 'ops', 3, 1_000);
    for (const [id, adjacent] of [
      ['product-ops', 'product'],
      ['finance-ops', 'finance'],
      ['pmo-ops', 'project-mgmt'],
      ['student-ops', 'education'],
    ] as const) {
      seed(id, 'ops', 3, 2_000);
      database
        .prepare(
          'INSERT INTO vacancy_semantic (id, function_code, level_rank, title_key, published_ms, is_remote) VALUES (?,?,?,?,?,?)',
        )
        .run(id, adjacent, 3, id, 2_000, 0);
    }
    const { sql, params } = buildSemanticMatchQuery({
      functionCodes: ['eng-mgmt', 'it-ops', 'ops'],
      levelRank: 3,
      window: { fromMs: 0, toMs: 5_000 },
      preferRemote: false,
      limit: 50,
    });

    const rows = database.prepare(sql).all(...params) as Array<{ payload: string }>;
    // «VP Engineering & Product» — целевая роль для CTO, продукт не исключаем.
    expect(rows.map((row) => JSON.parse(row.payload).id).sort()).toEqual([
      'ops-role',
      'product-ops',
    ]);
  });

  it('leaves product-only roles out of an Eng/Ops campaign (CPO 26.10)', () => {
    seed('target-ops', 'ops', 3, 1_000);
    seed('adjacent-product', 'product', 3, 2_000);
    const { sql, params } = buildSemanticMatchQuery({
      functionCodes: ['eng-mgmt', 'it-ops', 'ops'],
      levelRank: 3,
      window: { fromMs: 0, toMs: 5_000 },
      preferRemote: false,
      limit: 50,
    });

    const rows = database.prepare(sql).all(...params) as Array<{ payload: string }>;
    expect(rows.map((row) => JSON.parse(row.payload).id)).toEqual(['target-ops']);
  });

  /**
   * 03.11: «ОАЭ» в «Карьере» развернулась в 322 написания городов, и каждое
   * читало место строки заново — 81 с на проде при тайм-ауте чтения 12 с.
   */
  it('reads a long list of place names as one parameter per branch', () => {
    const located = (id: string, location: string, publishedMs: number, isRemote = 0) => {
      seed(id, 'eng-mgmt', 3, publishedMs, isRemote);
      database
        .prepare('UPDATE vacancy_cluster_input SET cluster_json = ? WHERE id = ?')
        .run(JSON.stringify({ id, location }), id);
    };
    located('moscow', 'Москва', 1_000);
    located('dubai', 'Dubai, United Arab Emirates', 2_000);
    located('berlin', 'Berlin', 3_000);
    located('remote-berlin', 'Berlin', 4_000, 1);
    const cityNames = [
      'Москва',
      ...Array.from({ length: 300 }, (_, index) => `city-${index}`),
      'Dubai',
    ];
    const { sql, params } = buildSemanticMatchQuery({
      functionCodes: ['eng-mgmt', 'it-ops'],
      levelRank: 3,
      geography: { cityNames, remote: true, remoteAreas: [] },
      window: { fromMs: 0, toMs: 5_000 },
      preferRemote: false,
      limit: 50,
    });

    expect(params.length).toBeLessThan(40);
    const rows = database.prepare(sql).all(...params) as Array<{ payload: string }>;
    expect(rows.map((row) => JSON.parse(row.payload).id)).toEqual([
      'remote-berlin',
      'dubai',
      'moscow',
    ]);
  });
});
