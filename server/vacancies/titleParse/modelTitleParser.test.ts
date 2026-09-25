import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import type { VertexConfig } from '../../providers/vertexAi';
import { MIGRATION_23, VACANCY_POOL_INDEX_TABLE } from '../../data/sqliteSchema';
import { SemanticBackfill } from './semanticBackfill';
import {
  TitleModelStep,
  VertexModelTitleParser,
  type ModelTitleParser,
} from './modelTitleParser';

const vertex: VertexConfig = {
  projectId: 'project-test',
  clientEmail: 'test@example.test',
  privateKey: 'unused-in-test',
  model: 'gemini-3.8-flash',
  location: 'global',
};

function vertexResponse(value: unknown): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }),
    { status: 200 },
  );
}

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

describe('VertexModelTitleParser (B267 S4)', () => {
  it('sends one Vertex request for a batch and accepts taxonomy and ontology ids', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        generationConfig: { thinkingConfig?: { thinkingLevel?: string } };
      };
      expect(request.generationConfig.thinkingConfig?.thinkingLevel).toBe('low');
      return vertexResponse([
        { titleKey: 'mystery lead', functions: ['eng'], levelRank: 1, roleId: 'eng.backend.lead' },
      ]);
    });
    const parser = new VertexModelTitleParser(vertex, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      token: async () => 'token',
    });

    await expect(
      parser.parse([{ titleKey: 'mystery lead', sampleTitle: 'Mystery Lead' }]),
    ).resolves.toEqual([
      { titleKey: 'mystery lead', functions: ['eng'], levelRank: 1, roleId: 'eng.backend.lead' },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects only a record with an unknown function code', async () => {
    const parser = new VertexModelTitleParser(vertex, {
      fetchImpl: async () =>
        vertexResponse([
          { titleKey: 'bad', functions: ['invented'], levelRank: 2 },
          { titleKey: 'good', functions: ['data'], levelRank: null },
        ]),
      token: async () => 'token',
    });

    await expect(
      parser.parse([
        { titleKey: 'bad', sampleTitle: 'Bad' },
        { titleKey: 'good', sampleTitle: 'Good' },
      ]),
    ).resolves.toEqual([{ titleKey: 'good', functions: ['data'], levelRank: null }]);
  });

  it('treats broken JSON as an unusable batch response', async () => {
    const parser = new VertexModelTitleParser(vertex, {
      fetchImpl: async () =>
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{broken' }] } }] })),
      token: async () => 'token',
    });

    await expect(parser.parse([{ titleKey: 'bad', sampleTitle: 'Bad' }])).resolves.toEqual([]);
  });
});

describe('TitleModelStep (B267 S4)', () => {
  it('queues only uncertain rules parses and removes stale semantic rows after model parse', async () => {
    const db = database();
    addVacancy(db, 'exact', 'Chief Technology Officer');
    addVacancy(db, 'unknown', 'Wibble Specialist');
    const backfill = new SemanticBackfill(db);
    backfill.step(100);
    const parser: ModelTitleParser = {
      model: 'test-model',
      parse: async (items) =>
        items.map((item) => ({ titleKey: item.titleKey, functions: ['data'], levelRank: 0 })),
    };
    const step = new TitleModelStep(db, parser, { dailyCalls: 10 });

    const report = await step.run();

    expect(report).toMatchObject({ batches: 1, parsed: 1, refused: 0, frozen: 0 });
    expect(db.prepare("SELECT parsed_by FROM title_parse WHERE title_key = 'chief technology officer'").get())
      .toEqual({ parsed_by: 'rules' });
    expect(db.prepare("SELECT parsed_by FROM title_parse WHERE title_key = 'wibble specialist'").get())
      .toEqual({ parsed_by: 'model' });
    expect(db.prepare("SELECT count(*) AS n FROM vacancy_semantic WHERE title_key = 'wibble specialist'").get())
      .toEqual({ n: 0 });
  });

  it('freezes a key after three refused responses', async () => {
    const db = database();
    addVacancy(db, 'unknown', 'Wibble Specialist');
    new SemanticBackfill(db).step(100);
    const parser: ModelTitleParser = { model: 'test-model', parse: async () => [] };
    const step = new TitleModelStep(db, parser, { dailyCalls: 10, maxBatches: 1 });

    await step.run();
    await step.run();
    const third = await step.run();
    const fourth = await step.run();

    expect(third).toMatchObject({ refused: 1, frozen: 1 });
    expect(fourth).toMatchObject({ batches: 0, parsed: 0 });
  });

  it('stops at the UTC daily call cap and reports it once', async () => {
    const db = database();
    addVacancy(db, 'one', 'Wibble Specialist');
    addVacancy(db, 'two', 'Zibble Manager');
    new SemanticBackfill(db).step(100);
    const parser: ModelTitleParser = { model: 'test-model', parse: async () => [] };
    const step = new TitleModelStep(db, parser, {
      dailyCalls: 1,
      maxBatches: 3,
      now: () => Date.parse('2026-09-26T12:00:00Z'),
    });

    const first = await step.run();
    const second = await step.run();

    expect(first).toMatchObject({ batches: 1, callsToday: 1, dailyCapReached: true });
    expect(second).toMatchObject({ batches: 0, callsToday: 1, dailyCapReached: false });
  });
});
