import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteCandidateIncomeRepository } from './sqliteCandidateIncomeRepository';

const key = Buffer.alloc(32, 7);
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function setup() {
  const database = new DatabaseSync(':memory:');
  database.exec(
    "PRAGMA foreign_keys = ON; CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT; INSERT INTO candidates VALUES ('alice'), ('bob');",
  );
  databases.push(database);
  return { database, repository: new SqliteCandidateIncomeRepository(database, key) };
}

describe('SqliteCandidateIncomeRepository', () => {
  it('пока кандидат ничего не указал, значений нет', () => {
    expect(setup().repository.get('alice')).toEqual({ current: null, expected: null });
  });

  it('хранит доход и ожидания кандидата, чужих не отдаёт', () => {
    const { repository } = setup();
    repository.put('alice', { current: 440_000, expected: 500_000 }, '2026-11-18T09:00:00.000Z');
    repository.put('alice', { current: 450_000, expected: null }, '2026-11-18T10:00:00.000Z');
    expect(repository.get('alice')).toEqual({ current: 450_000, expected: null });
    expect(repository.get('bob')).toEqual({ current: null, expected: null });
  });

  it('в базе числа запечатаны, запись другого кандидата не открыть', () => {
    const { database, repository } = setup();
    repository.put('alice', { current: 440_000, expected: 500_000 }, '2026-11-18T09:00:00.000Z');
    const row = database.prepare('SELECT income_cipher FROM candidate_income').get() as {
      income_cipher: string;
    };
    expect(row.income_cipher).not.toContain('440000');
    database.prepare("UPDATE candidate_income SET candidate_id = 'bob'").run();
    expect(() => repository.get('bob')).toThrow();
  });

  it('некорректные числа не сохраняет', () => {
    const { repository } = setup();
    repository.put('alice', { current: -5, expected: 1.5 }, '2026-11-18T09:00:00.000Z');
    expect(repository.get('alice')).toEqual({ current: null, expected: null });
  });

  it('значения уходят вместе с кандидатом; создание таблицы повторяемо', () => {
    const { database, repository } = setup();
    repository.put('alice', { current: 1, expected: 2 }, '2026-11-18T09:00:00.000Z');
    database.exec("DELETE FROM candidates WHERE id = 'alice'");
    expect(repository.get('alice')).toEqual({ current: null, expected: null });
    expect(() => new SqliteCandidateIncomeRepository(database, key)).not.toThrow();
  });
});
