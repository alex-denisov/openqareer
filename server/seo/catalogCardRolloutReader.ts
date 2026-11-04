/**
 * The web server's read of the rollout: one primary-key row per card page on a
 * read-only connection. A failed read leaves the card `noindex` for that
 * request and never fails the page.
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { applySqliteBusyTimeout, SQLITE_HTTP_BUSY_TIMEOUT_MS } from '../data/sqliteBusyTimeout';

interface Reader {
  readonly database: DatabaseSync;
  readonly statement: StatementSync;
}

const readers = new Map<string, Reader>();
let failureLogged = false;

function reader(databasePath: string): Reader {
  const open = readers.get(databasePath);
  if (open?.database.isOpen) return open;
  const database = new DatabaseSync(databasePath, { readOnly: true });
  applySqliteBusyTimeout(database, SQLITE_HTTP_BUSY_TIMEOUT_MS);
  const statement = database.prepare('SELECT 1 FROM catalog_card_rollout WHERE cluster_id = ?');
  const created = { database, statement };
  readers.set(databasePath, created);
  return created;
}

/** Test seam: tests delete their database files between cases. */
export function closeCatalogCardRolloutReaders(): void {
  for (const { database } of readers.values()) if (database.isOpen) database.close();
  readers.clear();
}

export function isCardInRollout(databasePath: string, clusterId: string): boolean {
  try {
    return reader(databasePath).statement.get(clusterId) !== undefined;
  } catch (error: unknown) {
    const stale = readers.get(databasePath);
    if (stale?.database.isOpen) stale.database.close();
    readers.delete(databasePath);
    // Before the maintenance process's first tick the table does not exist.
    const missingTable = error instanceof Error && /no such table/u.test(error.message);
    if (!missingTable && !failureLogged) {
      failureLogged = true;
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      process.stderr.write(
        `${JSON.stringify({ level: 40, time: Date.now(), msg: 'catalog-card-rollout-read-failed', errorName })}\n`,
      );
    }
    return false;
  }
}
