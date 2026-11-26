import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATION_23, VACANCY_POOL_INDEX_TABLE } from '../../data/sqliteSchema';
import { rulesParse } from './rulesParse';
import { SemanticBackfill } from './semanticBackfill';
import { TitleModelStep, type ModelTitleParser } from './modelTitleParser';

/** B646-2: freehire's classifier fills only what our own rules leave without a function. */
describe('rulesParse freehire fallback', () => {
  it.each([
    ['programer', ['eng']],
    ['Back End (Django)', ['eng']],
    ['Тест Інженер', ['qa']],
    ['Системний адміністратор', ['it-ops']],
    ['Фахівець IT підтримки', ['it-ops']],
  ] as const)('%s → %j when our rules find nothing', (title, functions) => {
    expect(rulesParse(title).functions).toEqual(functions);
  });

  it('replaces a bare other with the freehire IT reading', () => {
    expect(rulesParse('Analista de Datos Senior').functions).toEqual(['data']);
    expect(rulesParse('IT Analyst', { freehireFallback: false }).functions).toEqual(['other']);
    expect(rulesParse('IT Analyst').functions).toEqual(['eng']);
  });

  it('never overrides a specific answer our rules already gave', () => {
    expect(rulesParse('Engineering Manager').functions).toEqual(['eng-mgmt']);
    expect(rulesParse('Data Loss Prevention Analyst').functions).toEqual(['data']);
  });

  it('gives no IT function to a confirmed non-IT title', () => {
    expect(rulesParse('Kassierer (m/w/d)').functions).toEqual([]);
  });
});

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(MIGRATION_23);
  db.exec(VACANCY_POOL_INDEX_TABLE);
  return db;
}

function addVacancy(db: DatabaseSync, id: string, title: string): void {
  db.prepare(
    'INSERT INTO vacancy_pool (id, source_id, published_at, stored_at, payload) VALUES (?, ?, ?, ?, ?)',
  ).run(id, 'src', '2026-09-26', '2026-09-26', JSON.stringify({ id, title }));
  db.prepare(
    `INSERT INTO vacancy_pool_index
      (id, source_id, published_ms, observed_ms, is_active, is_remote, url, search_text, expired)
     VALUES (?, 'src', 1, 1, 1, 1, 'https://example.test', ?, 0)`,
  ).run(id, title.toLowerCase());
}

describe('model queue eligibility (B646-2)', () => {
  it('still sends a confirmed non-IT title to the model: audience is all professions', async () => {
    const db = database();
    addVacancy(db, 'cashier', 'Kassierer (m/w/d)');
    addVacancy(db, 'unknown', 'Wibble Specialist');
    new SemanticBackfill(db).step(100);
    const seen: string[] = [];
    const parser: ModelTitleParser = {
      parse: async (items) => {
        seen.push(...items.map((item) => item.sampleTitle));
        return { model: 'test-model', results: [] };
      },
    };

    await new TitleModelStep(db, parser, { dailyCalls: 10, maxBatches: 1, maxWaitMs: 0 }).run();

    expect(seen.sort()).toEqual(['Kassierer (m/w/d)', 'Wibble Specialist']);
    const rows = db
      .prepare(
        `SELECT p.sample_title AS title, q.eligible FROM title_parse_model_queue q
         JOIN title_parse p ON p.title_key = q.title_key ORDER BY p.sample_title`,
      )
      .all();
    expect(rows).toEqual([
      { title: 'Kassierer (m/w/d)', eligible: 1 },
      { title: 'Wibble Specialist', eligible: 1 },
    ]);
  });
});
