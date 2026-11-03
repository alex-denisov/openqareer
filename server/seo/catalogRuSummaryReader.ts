/**
 * The web server's read of a card's Russian summary: one primary-key row per
 * card page on a read-only connection kept open per database. The maintenance
 * process writes the rows (`catalogRuSummarySchedule.ts`).
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { applySqliteBusyTimeout, SQLITE_HTTP_BUSY_TIMEOUT_MS } from '../data/sqliteBusyTimeout';
import {
  CATALOG_RU_SUMMARY_VERSION,
  catalogSummarySourceHash,
  readStoredCatalogRuSummary,
  type CatalogRuSummary,
} from './catalogRuSummary';

export interface CatalogRuSummaryRead {
  /** Shown only while it was written from the text the page shows now. */
  readonly summary?: CatalogRuSummary;
  /** The summary matches the page's text: the card counts as described. */
  readonly described: boolean;
}

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
  const statement = database.prepare(
    `SELECT source_hash, summary_json FROM catalog_ru_summaries
      WHERE cluster_id = ? AND version = ? AND status = 'ready'`,
  );
  const created = { database, statement };
  readers.set(databasePath, created);
  return created;
}

/** Test seam: tests delete their database files between cases. */
export function closeCatalogRuSummaryReaders(): void {
  for (const { database } of readers.values()) if (database.isOpen) database.close();
  readers.clear();
}

const NONE: CatalogRuSummaryRead = { described: false };

/**
 * The summary is optional: a failed read leaves the page without it and never
 * fails the page. Before the maintenance process's first tick the table does
 * not exist; any other error is logged once per process.
 */
function readRow(databasePath: string, clusterId: string) {
  try {
    return reader(databasePath).statement.get(clusterId, CATALOG_RU_SUMMARY_VERSION) as
      { source_hash: string; summary_json: string | null } | undefined;
  } catch (error: unknown) {
    const stale = readers.get(databasePath);
    if (stale?.database.isOpen) stale.database.close();
    readers.delete(databasePath);
    const missingTable = error instanceof Error && /no such table/u.test(error.message);
    if (!missingTable && !failureLogged) {
      failureLogged = true;
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      process.stderr.write(
        `${JSON.stringify({ level: 40, time: Date.now(), msg: 'catalog-ru-summary-read-failed', errorName })}\n`,
      );
    }
    return undefined;
  }
}

/** Shown and counted only while it was written from the text the page shows now. */
export function readCatalogRuSummary(
  databasePath: string,
  card: { readonly clusterId: string; readonly title: string; readonly description: string },
): CatalogRuSummaryRead {
  const row = readRow(databasePath, card.clusterId);
  if (!row?.summary_json) return NONE;
  if (row.source_hash !== catalogSummarySourceHash(card.title, card.description)) return NONE;
  const summary = readStoredCatalogRuSummary(row.summary_json);
  return summary ? { described: true, summary } : NONE;
}
