import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { VacancyMatchReader } from './vacancyMatchReader';

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).reverse().forEach((close) => close()));

function reader(timeout = 2_000, queue = 8) {
  const dir = mkdtempSync(join(tmpdir(), 'match-reader-'));
  cleanup.push(() => rmSync(dir, { force: true, recursive: true }));
  const path = join(dir, 'pool.db');
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE sample (value TEXT)');
  db.close();
  const result = new VacancyMatchReader(path, timeout, queue);
  cleanup.push(() => result.close());
  return result;
}

describe('isolated matching reader', () => {
  it('answers reads but cannot mutate the database', async () => {
    const worker = reader();
    expect(await worker.read('SELECT ? AS payload', ['synthetic'])).toEqual([{ payload: 'synthetic' }]);
    await expect(worker.read("INSERT INTO sample VALUES ('write') RETURNING value AS payload", [])).rejects.toThrow('vacancy_match_query_failed');
  });

  it('keeps the event loop responsive, bounds the queue and kills a timed-out SQL process', async () => {
    const worker = reader(500, 1);
    const long = worker.read('WITH RECURSIVE numbers(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM numbers WHERE x<1000000000) SELECT sum(x) AS payload FROM numbers', []);
    const failed = expect(long).rejects.toThrow('vacancy_match_timeout');
    await expect(worker.read('SELECT 1 AS payload', [])).rejects.toThrow('vacancy_match_reader_busy');
    let beat = false;
    await new Promise<void>((resolve) => setTimeout(() => { beat = true; resolve(); }, 20));
    expect(beat).toBe(true);
    await failed;
    expect(await worker.read("SELECT 'restarted' AS payload", [])).toEqual([{ payload: 'restarted' }]);
    worker.close();
    await expect(worker.read('SELECT 1 AS payload', [])).rejects.toThrow('vacancy_match_reader_closed');
  });
});
