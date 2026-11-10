import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { readInWorker } from './readInWorker';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fileDatabase(): DatabaseSync {
  const dir = mkdtempSync(join(tmpdir(), 'read-in-worker-'));
  dirs.push(dir);
  const database = new DatabaseSync(join(dir, 'db.sqlite'));
  database.exec('CREATE TABLE t (id INTEGER, name TEXT); INSERT INTO t VALUES (1, \'a\'), (2, \'b\');');
  return database;
}

describe('readInWorker', () => {
  it('reads a file database in a worker thread with parameters', async () => {
    const database = fileDatabase();
    await expect(readInWorker(database, 'SELECT name FROM t WHERE id > ?', [1])).resolves.toEqual([
      { name: 'b' },
    ]);
    database.close();
  });

  it('rejects with the SQL error from the worker', async () => {
    const database = fileDatabase();
    await expect(readInWorker(database, 'SELECT nope FROM t')).rejects.toThrow(/nope/);
    database.close();
  });

  it('reads an in-memory database on the calling thread', async () => {
    const database = new DatabaseSync(':memory:');
    database.exec('CREATE TABLE t (id INTEGER)');
    database.exec('INSERT INTO t VALUES (7)');
    await expect(readInWorker(database, 'SELECT id FROM t')).resolves.toEqual([{ id: 7 }]);
  });
});
