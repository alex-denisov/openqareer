import type { DatabaseSync } from 'node:sqlite';

/** Runs `BEGIN IMMEDIATE` with a short wait and restores the connection's own wait after it. */
export function beginImmediateBriefly(database: DatabaseSync, timeoutMs: number): void {
  const { timeout } = database.prepare('PRAGMA busy_timeout').get() as { timeout: number };
  database.exec(`PRAGMA busy_timeout = ${timeoutMs}`);
  try {
    database.exec('BEGIN IMMEDIATE');
  } finally {
    database.exec(`PRAGMA busy_timeout = ${timeout}`);
  }
}

const BRIEF_WRITE_MS = 50;

/**
 * The writes in one transaction that waits for the lock no longer than `timeoutMs` (B702, prod
 * 24.11: rows of a list page queued one statement at a time held the event loop 3.2 s behind
 * the pool maintenance). Throws `SQLITE_BUSY` when the lock is taken.
 */
export function writeBriefly<T>(
  database: DatabaseSync,
  work: () => T,
  timeoutMs = BRIEF_WRITE_MS,
): T {
  // Already inside a brief write (a slot taken while a row is queued): one transaction for both.
  if (database.isTransaction) return work();
  beginImmediateBriefly(database, timeoutMs);
  try {
    const result = work();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
