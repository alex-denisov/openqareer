import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { readRowsChunked } from './chunkedRows';

function table(rows: number): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
  const insert = database.prepare('INSERT INTO t (id) VALUES (?)');
  for (let id = 1; id <= rows; id += 1) insert.run(id);
  return database;
}

describe('B776: строки читаются порциями и отдают цикл событий между ними', () => {
  it('все строки по порядку, с отдачей такта после каждой порции', async () => {
    const database = table(25);
    let turns = 0;
    const tick = () => {
      turns += 1;
      if (turns < 100) setImmediate(tick);
    };
    setImmediate(tick);
    const rows = await readRowsChunked<{ id: number }>(database.prepare('SELECT id FROM t ORDER BY id'), 10);
    expect(rows.map((row) => row.id)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(turns).toBeGreaterThanOrEqual(2);
  });

  it('пустая выборка — пустой список', async () => {
    expect(await readRowsChunked(table(0).prepare('SELECT id FROM t'), 10)).toEqual([]);
  });
});
