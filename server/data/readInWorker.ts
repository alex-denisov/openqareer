import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { Worker } from 'node:worker_threads';

/**
 * B641 10.11: тяжёлое чтение (агрегат по всему пулу, секунды) держало цикл
 * событий воркера обслуживания. Здесь оно идёт в отдельном потоке на своём
 * соединении только для чтения; база в памяти (тесты) читается как раньше.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(workerData.path, { readOnly: true });
try {
  parentPort.postMessage({ rows: db.prepare(workerData.sql).all(...workerData.params) });
} catch (error) {
  parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
} finally {
  db.close();
}
`;

export function readInWorker<T>(
  database: DatabaseSync,
  sql: string,
  params: readonly SQLInputValue[] = [],
): Promise<T[]> {
  const path = database.location();
  if (!path) return Promise.resolve(database.prepare(sql).all(...params) as unknown as T[]);
  return new Promise<T[]>((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { path, sql, params: [...params] },
    });
    worker.once('message', (message: { rows?: T[]; error?: string }) => {
      if (message.error !== undefined) reject(new Error(message.error));
      else resolve(message.rows ?? []);
      void worker.terminate();
    });
    worker.once('error', reject);
  });
}
