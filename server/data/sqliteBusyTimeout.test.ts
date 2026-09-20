import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteVacancyPoolStore } from '../vacancies/sqliteVacancyPoolStore';
import { SqliteCandidateStore } from './sqliteCandidateStore';
import { SQLITE_BUSY_TIMEOUT_MS, applySqliteBusyTimeout } from './sqliteBusyTimeout';

const HOLD_LOCK_MS = 700;

/** Держит write-lock на базе из другого потока: имитирует волну обслуживателя. */
function holdWriteLock(databasePath: string, holdMs: number): Worker {
  return new Worker(
    `
    const { DatabaseSync } = require('node:sqlite');
    const { parentPort, workerData } = require('node:worker_threads');
    const db = new DatabaseSync(workerData.databasePath);
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec('BEGIN IMMEDIATE;');
    db.exec('CREATE TABLE IF NOT EXISTS lock_probe (id INTEGER)');
    parentPort.postMessage('locked');
    const until = Date.now() + workerData.holdMs;
    while (Date.now() < until) { /* держим */ }
    db.exec('COMMIT;');
    db.close();
    `,
    { eval: true, workerData: { databasePath, holdMs } },
  );
}

function waitForLock(worker: Worker): Promise<void> {
  return new Promise((resolve, reject) => {
    worker.once('message', () => resolve());
    worker.once('error', reject);
  });
}

describe('sqlite busy_timeout (B230)', () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function freshPath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'busy-timeout-'));
    directories.push(directory);
    return join(directory, 'db.sqlite');
  }

  it('is at least five seconds', () => {
    expect(SQLITE_BUSY_TIMEOUT_MS).toBeGreaterThanOrEqual(5000);
  });

  it('applySqliteBusyTimeout makes a raw connection wait instead of failing', async () => {
    const path = freshPath();
    const setup = new DatabaseSync(path);
    setup.exec('PRAGMA journal_mode = WAL; CREATE TABLE t (v INTEGER);');
    setup.close();
    const worker = holdWriteLock(path, HOLD_LOCK_MS);
    await waitForLock(worker);
    const db = new DatabaseSync(path);
    applySqliteBusyTimeout(db);
    const started = Date.now();
    expect(() => db.exec('INSERT INTO t (v) VALUES (1)')).not.toThrow();
    expect(Date.now() - started).toBeGreaterThanOrEqual(HOLD_LOCK_MS - 200);
    db.close();
    await worker.terminate();
  });

  it('candidate store and pool store write through a held lock without SQLITE_BUSY', async () => {
    const path = freshPath();
    // Схема создаётся до захвата блокировки: конструкторы тоже пишут.
    new SqliteVacancyPoolStore({ databasePath: path }).close();
    new SqliteCandidateStore({ databasePath: path, encryptionKey: Buffer.alloc(32, 8) }).close();
    const worker = holdWriteLock(path, HOLD_LOCK_MS);
    await waitForLock(worker);
    const pool = new SqliteVacancyPoolStore({ databasePath: path });
    const candidates = new SqliteCandidateStore({ databasePath: path, encryptionKey: Buffer.alloc(32, 8) });
    expect(() =>
      pool.saveSourceState({
        sourceId: 'probe',
        lastSyncAt: new Date().toISOString(),
        lastStatus: 'healthy',
        itemsFoundTotal: 0,
        itemsActiveTotal: 0,
      }),
    ).not.toThrow();
    expect(() => candidates.purgeExpiredDocuments(new Date().toISOString(), 1)).not.toThrow();
    pool.close();
    candidates.close();
    await worker.terminate();
  });
});
