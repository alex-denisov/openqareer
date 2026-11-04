import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { VacancyMatchReader, VacancyMatchUnavailable } from './vacancyMatchReader';

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

  it('a timeout names how long each read waited and how many were waiting', async () => {
    const worker = reader(300, 4);
    const long = worker.read('WITH RECURSIVE numbers(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM numbers WHERE x<1000000000) SELECT sum(x) AS payload FROM numbers', []);
    const queued = worker.read('SELECT 1 AS payload', []);
    const [first, second] = await Promise.allSettled([long, queued]);
    worker.close();
    for (const outcome of [first, second]) {
      const error = (outcome as PromiseRejectedResult).reason as VacancyMatchUnavailable;
      expect(error).toBeInstanceOf(VacancyMatchUnavailable);
      expect(error.message).toBe('vacancy_match_timeout');
      expect(error.pendingReads).toBe(2);
      expect(error.waitedMs).toBeGreaterThanOrEqual(250);
    }
  });

  it('a read that failed in SQL stays an ordinary failure, not a busy pool', async () => {
    const worker = reader();
    const failure = await worker.read('SELECT nope FROM missing', []).catch((error: unknown) => error);
    worker.close();
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(VacancyMatchUnavailable);
  });

  it('can start its isolated process before the first SQL request', async () => {
    const worker = reader();
    worker.warm();
    expect(await worker.read("SELECT '1' AS payload", [])).toEqual([{ payload: '1' }]);
  });
});
