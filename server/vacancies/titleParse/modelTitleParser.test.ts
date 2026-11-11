import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIGRATION_23, VACANCY_POOL_INDEX_TABLE } from '../../data/sqliteSchema';
import { BulkChannelUnavailable, type BulkLlmClient } from '../../providers/bulkLlmClient';
import { createBulkLlmRuntime } from '../../providers/bulkLlmRuntime';
import { SemanticBackfill } from './semanticBackfill';
import { BulkTitleParser, TitleModelStep, type ModelTitleParser } from './modelTitleParser';

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

const NOW = Date.parse('2026-11-04T12:00:00Z');
const MINUTE = 60_000;
const answer = (titleKey: string) => ({ titleKey, functions: ['data'], levelRank: 0 }) as const;

function fakeClient(content: (input: string) => unknown) {
  const complete = vi.fn(async (request: { input: string }) => ({
    content: JSON.stringify(content(request.input)),
    model: 'z-ai/glm-5.3-flash',
    provider: 'Novita',
    usage: { cost: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0 },
  }));
  return { client: { complete } as unknown as BulkLlmClient, complete };
}

describe('BulkTitleParser', () => {
  it('sends the title-parse call and returns the answering model', async () => {
    const { client, complete } = fakeClient(() => ({ items: [answer('cto'), answer('alien')] }));
    const parser = new BulkTitleParser(client, () => NOW);

    const out = await parser.parse([{ titleKey: 'cto', sampleTitle: 'CTO' }]);

    expect(out).toEqual({ model: 'z-ai/glm-5.3-flash', results: [answer('cto')] });
    expect(complete.mock.calls[0]?.[0]).toMatchObject({
      task: 'title-parse',
      runId: 'title-parse:2026-11-04',
      dataClass: 'public',
      maxTokens: 4096,
      input: JSON.stringify([{ titleKey: 'cto', sampleTitle: 'CTO' }]),
    });
  });

  it('accepts an answer only with a decodable record; an unknown roleId is dropped', async () => {
    const { client, complete } = fakeClient(() => ({
      items: [{ titleKey: 'k', functions: ['eng'], levelRank: 1, roleId: 'made.up.role' }],
    }));
    const out = await new BulkTitleParser(client).parse([{ titleKey: 'k', sampleTitle: 'Lead' }]);
    expect(out.results).toEqual([{ titleKey: 'k', functions: ['eng'], levelRank: 1 }]);
    const accept = (complete.mock.calls[0]?.[0] as unknown as { accept: (c: string) => boolean })
      .accept;
    expect(accept('{broken')).toBe(false);
    expect(accept('{"items":[{"titleKey":"k","functions":["invented"],"levelRank":2}]}')).toBe(
      false,
    );
    expect(accept('{"items":[{"titleKey":"k","functions":["data"],"levelRank":null}]}')).toBe(true);
  });
});

describe('TitleModelStep (B267 S4)', () => {
  it('queues only uncertain rules parses and rewrites semantic rows with the model parse', async () => {
    const db = database();
    addVacancy(db, 'exact', 'Chief Technology Officer');
    addVacancy(db, 'unknown', 'Wibble Specialist');
    new SemanticBackfill(db).step(100);
    const parser: ModelTitleParser = {
      parse: async (items) => ({
        model: 'test-model',
        results: items.map((item) => answer(item.titleKey)),
      }),
    };
    const step = new TitleModelStep(db, parser, { dailyCalls: 10, maxWaitMs: 0 });

    const report = await step.run();

    expect(report).toMatchObject({ batches: 1, parsed: 1, refused: 0, frozen: 0 });
    expect(
      db
        .prepare("SELECT parsed_by FROM title_parse WHERE title_key = 'chief technology officer'")
        .get(),
    ).toEqual({ parsed_by: 'rules' });
    expect(
      db
        .prepare("SELECT parsed_by, model FROM title_parse WHERE title_key = 'wibble specialist'")
        .get(),
    ).toEqual({ parsed_by: 'model', model: 'test-model' });
    expect(
      db
        .prepare(
          "SELECT id, function_code, level_rank FROM vacancy_semantic WHERE title_key = 'wibble specialist'",
        )
        .all(),
    ).toEqual([{ id: 'unknown', function_code: 'data', level_rank: 0 }]);
  });

  const missing: ModelTitleParser = {
    // отказ: ответ успешный, но названия в нём нет
    parse: async () => ({ model: 'test-model', results: [answer('other title')] }),
  };

  it('freezes a key after three refused responses', async () => {
    const db = database();
    addVacancy(db, 'unknown', 'Wibble Specialist');
    new SemanticBackfill(db).step(100);
    const step = new TitleModelStep(db, missing, { dailyCalls: 10, maxBatches: 1, maxWaitMs: 0 });

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
    const step = new TitleModelStep(db, missing, {
      dailyCalls: 1,
      maxBatches: 3,
      maxWaitMs: 0,
      now: () => Date.parse('2026-09-26T12:00:00Z'),
    });

    const first = await step.run();
    const second = await step.run();

    expect(first).toMatchObject({ batches: 1, callsToday: 1, dailyCapReached: true });
    expect(second).toMatchObject({ batches: 0, callsToday: 1, dailyCapReached: false });
  });
});

describe('TitleModelStep through the bulk channel', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('writes the spend row and stores the answering model, not a chain label', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'title-bulk-'));
    dirs.push(dir);
    const transport = vi.fn(async (_url: string, init?: RequestInit) => {
      const model = (JSON.parse(String(init?.body)) as { model: string }).model;
      return Response.json({
        model,
        provider: 'Novita',
        choices: [
          { message: { content: JSON.stringify({ items: [answer('wibble specialist')] }) } },
        ],
        usage: { cost: 0.001, prompt_tokens: 5, completion_tokens: 5 },
      });
    });
    const runtime = createBulkLlmRuntime({
      databasePath: join(dir, 'app.db'),
      env: {
        OPENQAREER_OPENROUTER_API_KEY: 'secret',
        OPENQAREER_BULK_LLM_ENABLED: 'true',
        OPENQAREER_BULK_LLM_RUN_USD: '0.1',
        OPENQAREER_BULK_LLM_DAY_USD: '0.1',
        OPENQAREER_BULK_LLM_TOTAL_USD: '0.1',
        OPENQAREER_BULK_LLM_REQUEST_USD: '0.06',
      },
      transport: transport as unknown as typeof fetch,
      delay: async () => undefined,
    });
    const db = database();
    addVacancy(db, 'a', 'Wibble Specialist');
    new SemanticBackfill(db).step(100);
    const step = new TitleModelStep(db, new BulkTitleParser(runtime.client!), { maxWaitMs: 0 });

    const report = await step.run();

    const spend = runtime.ledger.db
      .prepare("SELECT model, provider, status FROM bulk_llm_spend WHERE task = 'title-parse'")
      .all();
    runtime.close();
    expect(report).toMatchObject({ parsed: 1, titles: 1 });
    expect(spend).toHaveLength(1);
    expect(spend[0]).toMatchObject({ model: 'deepseek/deepseek-v4-flash', provider: 'Novita' });
    expect(
      db.prepare("SELECT model FROM title_parse WHERE title_key = 'wibble specialist'").get(),
    ).toEqual({ model: 'deepseek/deepseek-v4-flash' });
  });

  it.each([
    new BulkChannelUnavailable('all stages cooled'),
    new Error('Bulk budget exceeded'),
    new Error('Bulk answer rejected'),
  ])('a channel failure (%s) leaves failures and frozen alone', async (error) => {
    const db = database();
    addVacancy(db, 'a', 'Wibble Specialist');
    new SemanticBackfill(db).step(100);
    const client = {
      complete: vi.fn(async () => Promise.reject(error)),
    } as unknown as BulkLlmClient;
    const step = new TitleModelStep(db, new BulkTitleParser(client), { maxWaitMs: 0 });

    const report = await step.run();

    expect(report.failedCall).toBe(true);
    const row = db
      .prepare(
        "SELECT failures, frozen, last_failure FROM title_parse_model_queue WHERE title_key = 'wibble specialist'",
      )
      .get() as { failures: number; frozen: number; last_failure: string };
    expect(row).toMatchObject({ failures: 0, frozen: 0 });
    expect(row.last_failure).toMatch(/^call:/);
  });
});

describe('partial batch timer', () => {
  function setup(count: number) {
    const db = database();
    for (let index = 0; index < count; index += 1) {
      // digits would be stripped from the title key: spell the index with letters
      const word = [...String(index)].map((digit) => 'abcdefghij'[Number(digit)]).join('');
      addVacancy(db, `v${index}`, `Wibble ${word} Specialist`);
    }
    new SemanticBackfill(db).step(1_000);
    const sizes: number[] = [];
    const parser: ModelTitleParser = {
      parse: async (items) => {
        sizes.push(items.length);
        return { model: 'm', results: items.map((item) => answer(item.titleKey)) };
      },
    };
    const clock = { now: NOW };
    const make = () =>
      new TitleModelStep(db, parser, { maxBatches: 5, dailyCalls: 100, now: () => clock.now });
    return { db, sizes, clock, make };
  }

  it('holds 5 titles, then sends them after 30 minutes', async () => {
    const { sizes, clock, make } = setup(5);
    const step = make();

    const first = await step.run();
    clock.now += 29 * MINUTE;
    const second = await step.run();
    clock.now += MINUTE;
    const third = await step.run();

    expect(first).toMatchObject({ batches: 0, heldPartial: 5, titles: 0 });
    expect(second).toMatchObject({ batches: 0, heldPartial: 5 });
    expect(third).toMatchObject({ batches: 1, titles: 5, heldPartial: 0 });
    expect(sizes).toEqual([5]);
  });

  it('sends 40 titles at once', async () => {
    const { sizes, make } = setup(40);
    const report = await make().run();
    expect(sizes).toEqual([40]);
    expect(report).toMatchObject({ batches: 1, titles: 40, heldPartial: 0 });
  });

  it('a restart resets the wait', async () => {
    const { sizes, clock, make } = setup(5);
    await make().run();
    clock.now += 29 * MINUTE;
    const restarted = make();
    await restarted.run();
    clock.now += 2 * MINUTE;
    const held = await restarted.run();
    expect(sizes).toEqual([]);
    expect(held).toMatchObject({ batches: 0, heldPartial: 5 });
    clock.now += 30 * MINUTE;
    await restarted.run();
    expect(sizes).toEqual([5]);
  });

  it('the wait restarts after a partial batch is sent', async () => {
    const { db, sizes, clock, make } = setup(5);
    const step = make();
    await step.run();
    clock.now += 30 * MINUTE;
    await step.run();
    addVacancy(db, 'late', 'Zibble Manager');
    new SemanticBackfill(db).step(100);
    await step.run();
    expect(sizes).toEqual([5]);
    clock.now += 30 * MINUTE;
    await step.run();
    expect(sizes).toEqual([5, 1]);
  });
});
