import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATION_23, VACANCY_POOL_INDEX_TABLE } from '../../data/sqliteSchema';
import { SemanticBackfill } from './semanticBackfill';
import { TitleModelStep, type ModelTitleParser } from './modelTitleParser';
import { unfreezeLiveTitles } from './titleFreeze';

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(MIGRATION_23);
  db.exec(VACANCY_POOL_INDEX_TABLE);
  return db;
}

function addVacancy(db: DatabaseSync, id: string, title: string, live = true): void {
  db.prepare(
    'INSERT INTO vacancy_pool (id, source_id, published_at, stored_at, payload) VALUES (?, ?, ?, ?, ?)',
  ).run(id, 'src', '2026-09-26', '2026-09-26', JSON.stringify({ id, title }));
  db.prepare(
    `INSERT INTO vacancy_pool_index
      (id, source_id, published_ms, observed_ms, is_active, is_remote, url, search_text, expired)
     VALUES (?, 'src', 1, 1, ?, 1, 'https://example.test', ?, ?)`,
  ).run(id, live ? 1 : 0, title.toLowerCase(), live ? 0 : 1);
}

function queue(db: DatabaseSync): { title_key: string; failures: number; frozen: number }[] {
  return db
    .prepare('SELECT title_key, failures, frozen FROM title_parse_model_queue ORDER BY title_key')
    .all() as never;
}

const ok = (key: string) => ({ titleKey: key, functions: ['data'] as const, levelRank: 0 });

describe('TitleModelStep failures', () => {
  it('a provider throw leaves failures at 0, logs the reason and ends the pass', async () => {
    const db = database();
    addVacancy(db, 'a', 'Wibble Specialist');
    new SemanticBackfill(db).step(100);
    const logged: unknown[] = [];
    let calls = 0;
    const parser: ModelTitleParser = {
      model: 'm',
      parse: async () => {
        calls += 1;
        throw new Error('quota exceeded Bearer abc123secretvalue');
      },
    };
    const step = new TitleModelStep(db, parser, {
      maxBatches: 3,
      log: { warn: (fields) => logged.push(fields) },
    });

    const report = await step.run();

    expect(calls).toBe(1);
    expect(report).toMatchObject({ batches: 1, parsed: 0, refused: 0, frozen: 0 });
    expect(queue(db)).toEqual([{ title_key: 'wibble specialist', failures: 0, frozen: 0 }]);
    expect(JSON.stringify(logged)).toContain('quota exceeded');
    expect(JSON.stringify(logged)).not.toContain('abc123secretvalue');
    const reason = db.prepare('SELECT last_failure FROM title_parse_model_queue').get() as {
      last_failure: string;
    };
    expect(reason.last_failure).toContain('Error');
  });

  it('backs off after a failed call instead of retrying on the next tick', async () => {
    const db = database();
    addVacancy(db, 'a', 'Wibble Specialist');
    new SemanticBackfill(db).step(100);
    let calls = 0;
    let t = Date.parse('2026-09-26T12:00:00Z');
    const parser: ModelTitleParser = {
      model: 'm',
      parse: async () => {
        calls += 1;
        throw new Error('down');
      },
    };
    const step = new TitleModelStep(db, parser, { now: () => t });
    await step.run();
    await step.run();
    expect(calls).toBe(1);
    t += 20 * 60_000;
    await step.run();
    expect(calls).toBe(2);
  });

  it('an empty answer for the whole batch is a call failure, not a refusal', async () => {
    const db = database();
    addVacancy(db, 'a', 'Wibble Specialist');
    new SemanticBackfill(db).step(100);
    const step = new TitleModelStep(db, { model: 'm', parse: async () => [] });
    await step.run();
    expect(queue(db)[0]).toMatchObject({ failures: 0, frozen: 0 });
  });

  it('a partial answer counts only the missing titles', async () => {
    const db = database();
    addVacancy(db, 'a', 'Wibble Specialist');
    addVacancy(db, 'b', 'Zibble Manager');
    new SemanticBackfill(db).step(100);
    const step = new TitleModelStep(
      db,
      { model: 'm', parse: async () => [ok('wibble specialist')] },
      { maxBatches: 1 },
    );

    const report = await step.run();

    expect(report).toMatchObject({ parsed: 1, refused: 1 });
    expect(queue(db)).toEqual([{ title_key: 'zibble manager', failures: 1, frozen: 0 }]);
  });

  it('three real refusals still freeze the title', async () => {
    const db = database();
    addVacancy(db, 'a', 'Wibble Specialist');
    addVacancy(db, 'b', 'Zibble Manager');
    new SemanticBackfill(db).step(100);
    const step = new TitleModelStep(
      db,
      { model: 'm', parse: async () => [ok('wibble specialist')] },
      { maxBatches: 1 },
    );
    await step.run();
    await step.run();
    const third = await step.run();
    expect(third).toMatchObject({ refused: 1, frozen: 1 });
    expect(queue(db)).toEqual([{ title_key: 'zibble manager', failures: 3, frozen: 1 }]);
  });

  it('stops at the per-run call ceiling', async () => {
    const db = database();
    addVacancy(db, 'a', 'Wibble Specialist');
    addVacancy(db, 'b', 'Zibble Manager');
    new SemanticBackfill(db).step(100);
    const step = new TitleModelStep(
      db,
      { model: 'm', parse: async () => [ok('wibble specialist')] },
      { maxBatches: 1, maxCallsPerRun: 2 },
    );
    await step.run();
    await step.run();
    const third = await step.run();
    expect(third).toMatchObject({ batches: 0, runCeilingReached: true });
  });
});

describe('unfreezeLiveTitles', () => {
  function frozenFixture(): DatabaseSync {
    const db = database();
    addVacancy(db, 'live', 'Wibble Specialist');
    addVacancy(db, 'dead', 'Zibble Manager', false);
    new SemanticBackfill(db).step(100);
    new TitleModelStep(db, { model: 'm', parse: async () => [] });
    db.exec(`INSERT OR REPLACE INTO title_parse_model_queue (title_key, eligible, failures, frozen)
      VALUES ('wibble specialist', 1, 3, 1), ('zibble manager', 1, 3, 1)`);
    return db;
  }

  it('unfreezes live titles, leaves stale ones frozen, and is safe to run twice', async () => {
    const db = frozenFixture();
    const first = await unfreezeLiveTitles(db, { batchSize: 1 });
    const second = await unfreezeLiveTitles(db, { batchSize: 1 });
    expect(first.unfrozen).toBe(1);
    expect(second.unfrozen).toBe(0);
    expect(queue(db)).toEqual([
      { title_key: 'wibble specialist', failures: 0, frozen: 0 },
      { title_key: 'zibble manager', failures: 3, frozen: 1 },
    ]);
  });
});
