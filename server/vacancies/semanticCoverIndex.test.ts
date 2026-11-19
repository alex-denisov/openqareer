import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MIGRATION_35,
  VACANCY_CLUSTER_INPUT_TABLE,
  VACANCY_POOL_INDEX_TABLE,
} from '../data/sqliteSchema';
import { buildSemanticMatchQuery } from './semanticMatchQuery';
import {
  SEMANTIC_COVER_INDEX,
  buildSemanticCoverIndex,
  hasSemanticCoverIndex,
  scheduleSemanticCoverIndex,
} from './semanticCoverIndex';

/**
 * B725: ветка подбора проверяла уровень и название по строке таблицы — на
 * проде 227 тыс. случайных чтений `vacancy_semantic` на функцию `eng`
 * (397 МБ). Покрывающий индекс отвечает фильтрам из самого индекса.
 */
describe('покрывающий индекс подбора (B725)', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = new DatabaseSync(':memory:');
    database.exec(MIGRATION_35);
    database.exec(VACANCY_POOL_INDEX_TABLE);
    database.exec(VACANCY_CLUSTER_INPUT_TABLE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function seed(id: string, code: string, level: number | null, published: number, title = id) {
    database
      .prepare(
        'INSERT INTO vacancy_semantic (id, function_code, level_rank, title_key, published_ms, is_remote) VALUES (?,?,?,?,?,0)',
      )
      .run(id, code, level, title, published);
    database
      .prepare(
        'INSERT INTO vacancy_pool_index (id, source_id, published_ms, observed_ms, is_active, is_remote, url, search_text, expired) VALUES (?,?,?,?,1,0,?,?,0)',
      )
      .run(id, 'src', published, published, `https://x/${id}`, id);
    database
      .prepare('INSERT INTO vacancy_cluster_input (id, cluster_json) VALUES (?, ?)')
      .run(id, JSON.stringify({ id, location: id.startsWith('msk') ? 'Москва' : 'Казань' }));
  }

  function seedPool() {
    seed('msk-lead', 'eng', 4, 1_900, 'engineering lead');
    seed('msk-junior', 'eng', 1, 1_800, 'junior developer');
    seed('msk-unknown', 'eng', null, 1_700, 'developer');
    seed('msk-sales', 'eng', 4, 1_600, 'sales engineer');
    seed('kzn-lead', 'eng', 4, 1_500, 'engineering lead');
    seed('msk-ops', 'ops', 4, 1_400, 'operations head');
    seed('msk-old', 'eng', 4, 10, 'engineering lead');
  }

  const query = (coverIndex: boolean) =>
    buildSemanticMatchQuery({
      functionCodes: ['eng', 'ops'],
      levelRank: 4,
      geography: { cityNames: ['Москва'], remote: false, remoteAreas: [] },
      window: { fromMs: 1_000, toMs: 2_000 },
      preferRemote: false,
      limit: 50,
      coverIndex,
    });

  const ids = (coverIndex: boolean) => {
    const { sql, params } = query(coverIndex);
    return (database.prepare(sql).all(...params) as { payload: string }[]).map(
      (row) => (JSON.parse(row.payload) as { id: string }).id,
    );
  };

  it('без индекса запрос идёт по прежнему vacancy_semantic_match', () => {
    expect(query(false).sql).toContain('INDEXED BY vacancy_semantic_match\n');
    expect(query(false).sql).not.toContain(SEMANTIC_COVER_INDEX);
  });

  it('с индексом ветка читает уровень и название из индекса, а не из таблицы', () => {
    seedPool();
    buildSemanticCoverIndex(database);
    const { sql, params } = query(true);
    const plan = (
      database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as {
        detail: string;
      }[]
    )
      .map((row) => row.detail)
      .join('\n');
    expect(plan).toContain(`SEARCH s USING COVERING INDEX ${SEMANTIC_COVER_INDEX}`);
  });

  it('набор строк тот же, что без индекса', () => {
    seedPool();
    const before = ids(false);
    buildSemanticCoverIndex(database);
    expect(before).toEqual(['msk-lead', 'msk-unknown', 'msk-ops']);
    expect(ids(true)).toEqual(before);
  });

  it('hasSemanticCoverIndex видит индекс только после постройки', () => {
    expect(hasSemanticCoverIndex(database)).toBe(false);
    buildSemanticCoverIndex(database);
    expect(hasSemanticCoverIndex(database)).toBe(true);
    buildSemanticCoverIndex(database);
    expect(hasSemanticCoverIndex(database)).toBe(true);
  });

  it('обслуживание строит индекс один раз после паузы и пишет время в журнал', () => {
    vi.useFakeTimers();
    const log = { info: vi.fn(), error: vi.fn() };
    scheduleSemanticCoverIndex(database, log);
    expect(hasSemanticCoverIndex(database)).toBe(false);
    vi.advanceTimersByTime(10 * 60_000);
    expect(hasSemanticCoverIndex(database)).toBe(true);
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ ms: expect.any(Number) }),
      'semantic-cover-index-built',
    );
  });

  it('уже построенный индекс обслуживание не трогает', () => {
    vi.useFakeTimers();
    buildSemanticCoverIndex(database);
    const log = { info: vi.fn(), error: vi.fn() };
    scheduleSemanticCoverIndex(database, log);
    vi.advanceTimersByTime(10 * 60_000);
    expect(log.info).not.toHaveBeenCalled();
  });

  it('сбой постройки пишется в журнал и повторяется позже', () => {
    vi.useFakeTimers();
    const failing = new DatabaseSync(':memory:');
    const log = { info: vi.fn(), error: vi.fn() };
    scheduleSemanticCoverIndex(failing, log);
    vi.advanceTimersByTime(10 * 60_000);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ errorName: 'Error' }),
      'semantic-cover-index-failed',
    );
    failing.exec(MIGRATION_35);
    vi.advanceTimersByTime(60 * 60_000);
    expect(hasSemanticCoverIndex(failing)).toBe(true);
  });
});
