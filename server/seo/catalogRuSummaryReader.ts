/**
 * The web server's read of a card's Russian summary: one primary-key row per
 * card page on a read-only connection kept open per database. The maintenance
 * process writes the rows (`catalogRuSummarySchedule.ts`).
 */
import { DatabaseSync } from 'node:sqlite';
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
  /** A summary of the current version exists: the card counts as described. */
  readonly described: boolean;
}

const connections = new Map<string, DatabaseSync>();

function connection(databasePath: string): DatabaseSync {
  const open = connections.get(databasePath);
  if (open?.isOpen) return open;
  const database = new DatabaseSync(databasePath, { readOnly: true });
  applySqliteBusyTimeout(database, SQLITE_HTTP_BUSY_TIMEOUT_MS);
  connections.set(databasePath, database);
  return database;
}

/** Test seam: tests delete their database files between cases. */
export function closeCatalogRuSummaryReaders(): void {
  for (const database of connections.values()) if (database.isOpen) database.close();
  connections.clear();
}

const NONE: CatalogRuSummaryRead = { described: false };

export function readCatalogRuSummary(
  databasePath: string,
  card: { readonly clusterId: string; readonly title: string; readonly description: string },
): CatalogRuSummaryRead {
  let row: { source_hash: string; summary_json: string | null } | undefined;
  try {
    row = connection(databasePath)
      .prepare(
        `SELECT source_hash, summary_json FROM catalog_ru_summaries
          WHERE cluster_id = ? AND version = ? AND status = 'ready'`,
      )
      .get(card.clusterId, CATALOG_RU_SUMMARY_VERSION) as typeof row;
  } catch (error: unknown) {
    // Before the maintenance process's first tick the table does not exist yet.
    if (error instanceof Error && /no such table/u.test(error.message)) return NONE;
    throw error;
  }
  if (!row?.summary_json) return NONE;
  const current = row.source_hash === catalogSummarySourceHash(card.title, card.description);
  const summary = current ? readStoredCatalogRuSummary(row.summary_json) : undefined;
  return { described: true, ...(summary ? { summary } : {}) };
}
