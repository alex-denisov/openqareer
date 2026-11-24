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
