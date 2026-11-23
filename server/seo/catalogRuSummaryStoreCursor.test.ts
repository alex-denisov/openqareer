import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MIGRATION_23,
  VACANCY_CATALOG_ENTRIES_TABLE,
  VACANCY_POOL_INDEX_TABLE,
} from '../data/sqliteSchema';
import { CATALOG_RU_SUMMARY_VERSION } from './catalogRuSummary';
import { CatalogRuSummaryStore } from './catalogRuSummaryStore';

/**
 * B761 23.11: каждый такт (раз в 20 с) читал карточки с самой новой. Готовые
 * сводки стояли сверху — 18 793 строки до первой нужной, — и такт перечитывал
 * их заново: 41 с из 65 с профиля обслуживания. Курсор продолжает с карточки,
 * на которой остановилось прошлое чтение, а в конце возвращается наверх.
 */
const NOW = Date.parse('2026-11-23T03:00:00Z');
const HOUR = 3_600_000;

let database: DatabaseSync;
let store: CatalogRuSummaryStore;

function addCard(id: string, publishedMs: number) {
  database
    .prepare(
      `INSERT INTO catalog_entries (cluster_id, entry_key, path, title, company, location, is_remote, salary_label,
         summary, skills_json, source_url, source_name, published_at, last_seen_at, source_count, status,
         role_slug, published_ms, last_seen_ms)
       VALUES (?, ?, ?, 'Бухгалтер', 'ГК Мебетек', 'Москва', 0, 'от 120 000 ₽', '', '[]',
         'https://hh.ru/vacancy/1', 'hh.ru', ?, ?, 1, 'active', 'buhgalter', ?, ?)`,
    )
    .run(
      `cluster-${id}`,
      id,
      `/vacancies/job/${id}`,
      new Date(publishedMs).toISOString(),
      new Date(NOW).toISOString(),
      publishedMs,
      NOW,
    );
}

const read = (limit: number) =>
  store.candidates(NOW, CATALOG_RU_SUMMARY_VERSION, limit).map((card) => card.clusterId);

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  database.exec(MIGRATION_23 + VACANCY_POOL_INDEX_TABLE + VACANCY_CATALOG_ENTRIES_TABLE);
  store = new CatalogRuSummaryStore(database);
  store.ensureTable();
  // Две карточки в одну миллисекунду — порядок внутри по entry_key.
  for (let index = 0; index < 10; index += 1) {
    addCard(`c${index}`, NOW - Math.floor(index / 2) * HOUR);
  }
});
afterEach(() => database.close());

describe('CatalogRuSummaryStore.candidates keyset cursor (B761)', () => {
  it('one pass reads every due card once, newest first, then wraps to the top', () => {
    const pass = [read(3), read(3), read(3), read(3)].flat();
    expect(pass).toEqual(Array.from({ length: 10 }, (_, index) => `cluster-c${index}`));
    expect(read(3)).toEqual(['cluster-c0', 'cluster-c1', 'cluster-c2']);
  });

  it('a card that becomes due behind the cursor comes on the next lap', () => {
    for (let index = 0; index < 10; index += 1) {
      store.saveThin(`cluster-c${index}`, 'hash', CATALOG_RU_SUMMARY_VERSION, NOW);
    }
    addCard('late', NOW + HOUR);
    addCard('old', NOW - 9 * HOUR);
    expect(read(1)).toEqual(['cluster-late']);
    expect(read(1)).toEqual(['cluster-old']);
    // c3 стал нужен позади курсора: прошлый круг закончился, новый начинается сверху.
    database.prepare("DELETE FROM catalog_ru_summaries WHERE cluster_id = 'cluster-c3'").run();
    expect(read(1)).toEqual(['cluster-late']);
    expect(read(5)).toEqual(['cluster-c3', 'cluster-old']);
  });

  it('resumeAt makes the next read start with a card the tick did not reach', () => {
    expect(read(4)).toEqual(['cluster-c0', 'cluster-c1', 'cluster-c2', 'cluster-c3']);
    store.resumeAt('cluster-c2');
    expect(read(2)).toEqual(['cluster-c2', 'cluster-c3']);
    store.resumeAt('cluster-c2');
    expect(read(1)).toEqual(['cluster-c2']);
  });

  it('a read after the cursor seeks by the order index instead of re-reading the top', () => {
    read(8);
    const sql: string[] = [];
    const prepare = database.prepare.bind(database);
    database.prepare = ((text: string) => {
      sql.push(text);
      return prepare(text);
    }) as typeof database.prepare;
    read(1);
    const query = sql.find((text) => text.includes('FROM catalog_entries c'))!;
    const plan = (
      prepare(`EXPLAIN QUERY PLAN ${query}`).all(
        ...Array.from({ length: (query.match(/\?/gu) ?? []).length }, () => 0),
      ) as Array<{ detail: string }>
    ).map((row) => row.detail);
    expect(plan.join(' | ')).toMatch(/catalog_entries_order \(status=\? AND published_ms<=?\?\)/u);
  });
});
