/**
 * B644: maintenance steps for the freehire repo catalog. Import: 200 rows per tick
 * until the file is done (offset in `freehire_repo_state`). Check: 20 boards per tick
 * through public ATS APIs, at most OPENQAREER_FREEHIRE_REPO_DAILY_CAP (3 000)
 * confirmed boards a day. Replaces the freehire.me API import (B641).
 * Rollback: OPENQAREER_FREEHIRE_REPO_OFF=1.
 */
import type { DatabaseSync } from 'node:sqlite';
import { importRepoChunk, readRepoFile, type RepoBoard } from './freehireRepoImport';
import { loadDirectoryIndex, type DirectoryIndex } from './freehireImport';
import { checkRepoBoards, publicApiCounter } from './freehireRepoCheck';

interface Log {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

const CHUNK = 200;
const CHECK_BATCH = 20;
const FIRST_RUN_MS = 10 * 60_000;
const IMPORT_GAP_MS = 5_000;
const CHECK_GAP_MS = 20_000;
const IDLE_MS = 30 * 60_000;
const FAILED_MS = 10 * 60_000;
export const DEFAULT_DAILY_CAP = 3_000;

const STATE_SQL = `CREATE TABLE IF NOT EXISTS freehire_repo_state (id INTEGER PRIMARY KEY CHECK (id = 1), next_row INTEGER NOT NULL, totals TEXT NOT NULL, updated_at TEXT NOT NULL)`;

export function readOffset(database: DatabaseSync): number {
  database.exec(STATE_SQL);
  const row = database.prepare('SELECT next_row AS offset FROM freehire_repo_state WHERE id = 1').get() as { offset: number } | undefined;
  return row?.offset ?? 0;
}

/** One import tick; returns rows read (0 once the file is done). */
export function runRepoImportTick(
  database: DatabaseSync,
  rows: readonly RepoBoard[],
  now: Date,
  index?: DirectoryIndex,
): { read: number; offset: number; added: number } {
  const offset = readOffset(database);
  if (offset >= rows.length) return { read: 0, offset, added: 0 };
  const totals = importRepoChunk(database, rows, offset, CHUNK, now, index ?? loadDirectoryIndex(database));
  const next = offset + totals.read;
  database
    .prepare(
      `INSERT INTO freehire_repo_state (id, next_row, totals, updated_at) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET next_row = excluded.next_row, totals = excluded.totals, updated_at = excluded.updated_at`,
    )
    .run(next, JSON.stringify(totals), now.toISOString());
  return { read: totals.read, offset: next, added: totals.added };
}

export function scheduleFreehireRepo(database: DatabaseSync, log: Log, env: NodeJS.ProcessEnv): () => void {
  if (env.OPENQAREER_FREEHIRE_REPO_OFF === '1') return () => {};
  const dailyCap = Number(env.OPENQAREER_FREEHIRE_REPO_DAILY_CAP) || DEFAULT_DAILY_CAP;
  const count = publicApiCounter(fetch);
  let rows: readonly RepoBoard[] | undefined;
  // Built once per import run and kept current by the import itself.
  let index: DirectoryIndex | undefined;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const next = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => void run(), delay);
    timer.unref();
  };
  const run = async () => {
    try {
      rows ??= readRepoFile();
      const started = Date.now();
      if (readOffset(database) < rows.length) index ??= loadDirectoryIndex(database);
      const imported = runRepoImportTick(database, rows, new Date(), index);
      if (imported.read > 0) {
        log.info({ ...imported, total: rows.length, ms: Date.now() - started }, 'freehire-repo-import-tick');
        next(IMPORT_GAP_MS);
        return;
      }
      rows = undefined;
      index = undefined;
      const checked = await checkRepoBoards(database, count, CHECK_BATCH, dailyCap);
      if (checked.checked > 0) log.info({ ...checked }, 'freehire-repo-check-tick');
      next(checked.checked > 0 ? CHECK_GAP_MS : IDLE_MS);
    } catch (error: unknown) {
      log.error({ errorName: error instanceof Error ? error.name : 'UnknownError', message: error instanceof Error ? error.message : '' }, 'freehire-repo-failed');
      next(FAILED_MS);
    }
  };
  next(FIRST_RUN_MS);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
