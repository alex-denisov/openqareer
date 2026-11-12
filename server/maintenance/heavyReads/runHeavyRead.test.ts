import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteVacancyPoolStore } from '../../vacancies/sqliteVacancyPoolStore';
import { runHeavyReadJob } from './heavyReadJobs';
import { checkpointAfterRead, runHeavyRead } from './runHeavyRead';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'heavy-read-'));
  dirs.push(dir);
  return dir;
}

function fileDatabase(): DatabaseSync {
  const path = join(tempDir(), 'db.sqlite');
  // The pool store creates the schema the jobs read.
  new SqliteVacancyPoolStore({ databasePath: path });
  const database = new DatabaseSync(path);
  database.exec('PRAGMA journal_mode = WAL;');
  return database;
}

interface Logged {
  details: Record<string, unknown>;
  message: string;
}

function memoryLog() {
  const lines: Logged[] = [];
  const push = (details: Record<string, unknown>, message: string) =>
    lines.push({ details, message });
  return { lines, info: push, error: push };
}

describe('runHeavyReadJob', () => {
  it('runs a job on a read-only connection and closes it', () => {
    const database = fileDatabase();
    const path = database.location() ?? '';
    const stats = runHeavyReadJob(path, 'landing', { nowMs: Date.parse('2026-11-13T00:00:00Z') });
    expect(stats.landing.vacancies).toEqual([]);
    expect(stats.sources).toEqual([]);
    database.close();
  });

  it('refuses a write from a job: the connection is read-only', () => {
    const database = fileDatabase();
    database.exec('CREATE TABLE t (id INTEGER)');
    const path = database.location() ?? '';
    const reader = new DatabaseSync(path, { readOnly: true });
    expect(() => reader.exec('INSERT INTO t VALUES (1)')).toThrow(/readonly/i);
    // Scratch tables of the salary step live in temp and stay allowed.
    expect(() => reader.exec('CREATE TEMP TABLE scratch (id INTEGER)')).not.toThrow();
    reader.close();
    database.close();
  });
});

describe('runHeavyRead', () => {
  it('reads in process when the database has no file', async () => {
    const database = new DatabaseSync(':memory:');
    // Same thread: the in-memory schema is empty, so the job's own error comes back.
    await expect(
      runHeavyRead(database, 'landing', { nowMs: Date.now() }, { workerFile: '' }),
    ).rejects.toThrow(/vacancy_pool_index/);
    database.close();
  });

  it('reads in process when the built worker file is absent', async () => {
    const database = fileDatabase();
    const result = await runHeavyRead(
      database,
      'landing',
      { nowMs: Date.now() },
      { workerFile: join(tempDir(), 'missing.mjs') },
    );
    expect(result.sources).toEqual([]);
    database.close();
  });

  it('runs the job in the worker thread and returns its reply', async () => {
    const database = fileDatabase();
    const workerFile = join(tempDir(), 'echo-worker.mjs');
    writeFileSync(
      workerFile,
      `import { parentPort, workerData } from 'node:worker_threads';
       parentPort.postMessage({ result: { job: workerData.job, path: workerData.path, args: workerData.args } });`,
    );
    const result = (await runHeavyRead(database, 'sitemaps', { nowMs: 5 }, { workerFile })) as unknown;
    expect(result).toEqual({ job: 'sitemaps', path: database.location(), args: { nowMs: 5 } });
    database.close();
  });

  it('rejects with the error the worker reports', async () => {
    const database = fileDatabase();
    const workerFile = join(tempDir(), 'fail-worker.mjs');
    writeFileSync(
      workerFile,
      `import { parentPort } from 'node:worker_threads';
       parentPort.postMessage({ error: 'no such table: vacancy_pool_index' });`,
    );
    await expect(
      runHeavyRead(database, 'landing', { nowMs: 1 }, { workerFile }),
    ).rejects.toThrow(/vacancy_pool_index/);
    database.close();
  });

  it('rejects when the worker exits without a reply', async () => {
    const database = fileDatabase();
    const workerFile = join(tempDir(), 'silent-worker.mjs');
    writeFileSync(workerFile, 'process.exitCode = 0;');
    await expect(
      runHeavyRead(database, 'landing', { nowMs: 1 }, { workerFile }),
    ).rejects.toThrow(/exited/);
    database.close();
  });
});

describe('checkpointAfterRead', () => {
  it('runs a passive checkpoint and logs the WAL size', () => {
    const database = fileDatabase();
    database.exec('CREATE TABLE t (v TEXT); INSERT INTO t VALUES (\'x\');');
    const log = memoryLog();
    checkpointAfterRead(database, 'landing', 1234, log);
    const line = log.lines.find((entry) => entry.message === 'heavy-read-done');
    expect(line?.details).toMatchObject({ job: 'landing', ms: 1234, checkpointBusy: 0 });
    expect(typeof line?.details.walMb).toBe('number');
    database.close();
  });

  it('logs nothing about WAL for an in-memory database', () => {
    const database = new DatabaseSync(':memory:');
    const log = memoryLog();
    checkpointAfterRead(database, 'landing', 1, log);
    expect(log.lines[0]?.details).toMatchObject({ job: 'landing', walMb: null });
    database.close();
  });
});
