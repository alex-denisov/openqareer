import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { CATCHUP_DAY_USD, CATCHUP_TASK, catchupGate } from './requirementsCatchupGate';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-11T10:00:00.000Z');

function db(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE vacancy_pool (id TEXT PRIMARY KEY, published_at TEXT NOT NULL);
    CREATE TABLE bulk_llm_spend (task TEXT, day TEXT, cost REAL, reserved REAL);
  `);
  const insert = database.prepare('INSERT INTO vacancy_pool VALUES (?, ?)');
  insert.run('ats-a:1', new Date(NOW - 90 * DAY).toISOString());
  insert.run('ats-a:2', new Date(NOW - 3 * DAY).toISOString());
  return database;
}

describe('догон требований у старых живых вакансий (B642)', () => {
  it('старая вакансия идёт под своей задачей, свежая и неизвестная — под обычной', () => {
    const database = db();
    expect(catchupGate(database, 'cluster-ats-a:1', NOW)).toEqual({ task: CATCHUP_TASK });
    expect(catchupGate(database, 'cluster-ats-a:2', NOW)).toEqual({ task: 'vacancy-requirements' });
    expect(catchupGate(database, 'cluster-missing:9', NOW)).toEqual({
      task: 'vacancy-requirements',
    });
  });

  it('после $2 за сутки старая вакансия откладывается до следующих суток UTC', () => {
    const database = db();
    database
      .prepare('INSERT INTO bulk_llm_spend VALUES (?, ?, ?, ?)')
      .run(CATCHUP_TASK, '2026-11-11', CATCHUP_DAY_USD, 0.01);
    expect(catchupGate(database, 'cluster-ats-a:1', NOW)).toEqual({
      task: CATCHUP_TASK,
      deferUntil: Date.parse('2026-11-12T00:00:00.000Z'),
    });
    expect(catchupGate(database, 'cluster-ats-a:2', NOW)).toEqual({ task: 'vacancy-requirements' });
  });
});
