import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import {
  computeHeavyRead,
  type HeavyReadArgs,
  type HeavyReadJob,
  type HeavyReadResult,
} from './heavyReadJobs';

/** dist/heavy-read-worker.mjs рядом с dist/maintenance.mjs. */
export const HEAVY_READ_WORKER_FILE = 'heavy-read-worker.mjs';

export interface HeavyReadLog {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

export interface RunHeavyReadOptions {
  /** Тесты; по умолчанию файл рядом с запущенным бандлом. */
  readonly workerFile?: string;
}

function defaultWorkerFile(): string {
  return join(dirname(process.argv[1] ?? ''), HEAVY_READ_WORKER_FILE);
}

/**
 * B649-3: чтение идёт в своём потоке со своим соединением readOnly; без
 * собранного файла потока (тесты, dev) или для базы в памяти — в процессе.
 */
export function runHeavyRead<K extends HeavyReadJob>(
  database: DatabaseSync,
  job: K,
  args: HeavyReadArgs,
  options: RunHeavyReadOptions = {},
): Promise<HeavyReadResult<K>> {
  const path = database.location();
  const workerFile = options.workerFile ?? defaultWorkerFile();
  if (!path || !workerFile || !existsSync(workerFile)) {
    try {
      return Promise.resolve(computeHeavyRead(database, job, args));
    } catch (error: unknown) {
      return Promise.reject(error);
    }
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(workerFile, { workerData: { path, job, args } });
    worker.once('message', (message: { result?: HeavyReadResult<K>; error?: string }) => {
      settled = true;
      if (message.error !== undefined) reject(new Error(message.error));
      else resolve(message.result as HeavyReadResult<K>);
      void worker.terminate();
    });
    worker.once('error', (error: Error) => {
      settled = true;
      reject(error);
    });
    worker.once('exit', (code) => {
      if (!settled) reject(new Error(`heavy-read worker exited with code ${code} before replying`));
    });
  });
}

function walMb(database: DatabaseSync): number | null {
  const path = database.location();
  if (!path) return null;
  try {
    return Math.round((statSync(`${path}-wal`).size / 1_048_576) * 10) / 10;
  } catch {
    return 0;
  }
}

/**
 * Риск devils-advocate: длинный снимок читателя не даёт контрольной точке
 * пройти, WAL растёт. После чтения — PASSIVE с соединения-писателя и размер WAL.
 */
export function checkpointAfterRead(
  database: DatabaseSync,
  job: HeavyReadJob,
  ms: number,
  log: HeavyReadLog,
): void {
  let checkpointBusy: number | null = null;
  try {
    const row = database.prepare('PRAGMA wal_checkpoint(PASSIVE)').get() as
      | { busy: number }
      | undefined;
    checkpointBusy = row ? Number(row.busy) : null;
  } catch (error: unknown) {
    log.error(
      { job, errorName: error instanceof Error ? error.name : 'UnknownError' },
      'heavy-read-checkpoint-failed',
    );
  }
  log.info({ job, ms, checkpointBusy, walMb: walMb(database) }, 'heavy-read-done');
}

/** Чтение в потоке, затем контрольная точка и строка журнала. */
export async function heavyRead<K extends HeavyReadJob>(
  database: DatabaseSync,
  job: K,
  args: HeavyReadArgs,
  log: HeavyReadLog,
  options: RunHeavyReadOptions = {},
): Promise<HeavyReadResult<K>> {
  const started = Date.now();
  const result = await runHeavyRead(database, job, args, options);
  checkpointAfterRead(database, job, Date.now() - started, log);
  return result;
}
