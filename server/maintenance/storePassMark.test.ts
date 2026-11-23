import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createStorePassMark } from './storePassMark';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function open(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  return database;
}

describe('отметка полной чистки пула (B759)', () => {
  it('нет отметки — null; поставленная читается и переживает новое открытие', () => {
    const database = open();
    expect(createStorePassMark(database).lastFinishedMs()).toBeNull();
    createStorePassMark(database).markFinished(1_763_812_800_000);
    expect(createStorePassMark(database).lastFinishedMs()).toBe(1_763_812_800_000);
  });

  it('новая отметка заменяет прежнюю', () => {
    const database = open();
    const mark = createStorePassMark(database);
    mark.markFinished(1);
    mark.markFinished(2);
    expect(mark.lastFinishedMs()).toBe(2);
    expect(
      database.prepare('SELECT COUNT(*) AS n FROM maintenance_store_pass_state').get(),
    ).toEqual({
      n: 1,
    });
  });
});

describe('прогресс прохода переживает рестарт (B759)', () => {
  it('нет прогресса — null; сохранённый шаг и позиция читаются после нового открытия', () => {
    const database = open();
    expect(createStorePassMark(database).progress()).toBeNull();
    createStorePassMark(database).saveProgress({ step: 'backfill', backfillCursor: 42_000 });
    expect(createStorePassMark(database).progress()).toEqual({
      step: 'backfill',
      backfillCursor: 42_000,
    });
  });

  it('законченный проход стирает прогресс: следующий начнётся с начала и только по таймеру', () => {
    const database = open();
    const mark = createStorePassMark(database);
    mark.saveProgress({ step: 'clusters', backfillCursor: 0 });
    mark.markFinished(5);
    expect(mark.progress()).toBeNull();
    expect(mark.lastFinishedMs()).toBe(5);
  });

  it('неизвестный шаг в таблице — прогресса нет, проход идёт с начала', () => {
    const database = open();
    const mark = createStorePassMark(database);
    mark.saveProgress({ step: 'pool', backfillCursor: 0 });
    database.exec("UPDATE maintenance_store_pass_progress SET step = 'vacuum'");
    expect(mark.progress()).toBeNull();
  });
});
