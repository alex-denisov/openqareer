import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATION_35, VACANCY_CLUSTER_INPUT_TABLE, VACANCY_POOL_INDEX_TABLE } from '../data/sqliteSchema';
import { TOP20_RELEVANCE_GOLDEN_SET } from './__fixtures__/top20Relevance';
import { buildSemanticMatchQuery } from './semanticMatchQuery';

const EXPLICIT_C28_NON_MATCHES = new Set([
  'Contract Writer — A Book Exploring the Beauty and Meaning of Sacred Art',
  'National Board of Trustees / Conseil d’administration national',
  'AI Professional Services Engineer I — Quark',
  'Senior Mobile Software Architect',
  'VP of Channel Sales — GFI Software',
  'Chief Financial Officer — Trilogy',
  'Head of Digital Marketing',
]);

function seedGoldenSet(database: DatabaseSync): void {
  const now = 1_000_000;
  TOP20_RELEVANCE_GOLDEN_SET.forEach((entry, index) => {
    const id = `golden-${index}`;
    const publishedMs = now - index;
    database.prepare(
      'INSERT INTO vacancy_pool_index (id, source_id, published_ms, observed_ms, is_active, is_remote, url, search_text, expired) VALUES (?, ?, ?, ?, 1, 1, ?, ?, 0)',
    ).run(id, 'golden', publishedMs, publishedMs, `https://example.test/${id}`, entry.title);
    database.prepare('INSERT INTO vacancy_cluster_input (id, cluster_json) VALUES (?, ?)').run(
      id,
      JSON.stringify({ id, canonicalTitle: entry.title, skills: ['ITIL'] }),
    );
    entry.functions.forEach((functionCode) => {
      database.prepare(
        'INSERT INTO vacancy_semantic (id, function_code, level_rank, title_key, published_ms, is_remote) VALUES (?, ?, ?, ?, ?, 1)',
      ).run(id, functionCode, entry.levelRank, entry.titleKey, publishedMs);
    });
  });
}

describe('semantic top-20 relevance (B267/B245)', () => {
  it('returns at least 14 relevant Tech/Ops executive vacancies and no explicit C28 non-match', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(MIGRATION_35);
    database.exec(VACANCY_POOL_INDEX_TABLE);
    database.exec(VACANCY_CLUSTER_INPUT_TABLE);
    seedGoldenSet(database);

    const { sql, params } = buildSemanticMatchQuery({
      functionCodes: ['eng-mgmt', 'it-ops', 'ops'],
      levelRank: 3,
      window: { fromMs: 0, toMs: 1_000_000 },
      preferRemote: true,
      limit: 20,
    });
    const titles = (database.prepare(sql).all(...params) as Array<{ payload: string }>)
      .map(({ payload }) => JSON.parse(payload).canonicalTitle as string);
    const relevance = new Map(TOP20_RELEVANCE_GOLDEN_SET.map((entry) => [entry.title, entry.relevant]));

    expect(titles.filter((title) => relevance.get(title)).length).toBeGreaterThanOrEqual(14);
    expect(titles).not.toEqual(expect.arrayContaining([...EXPLICIT_C28_NON_MATCHES]));
    expect(titles).not.toContain('SVP of Student Operations & Systems — 2 Hour Learning');
    database.close();
  });
});
