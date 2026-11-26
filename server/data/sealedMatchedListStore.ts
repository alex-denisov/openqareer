import type { DatabaseSync } from 'node:sqlite';
import { beginImmediateBriefly } from './sqliteBriefLock';
import { isSqliteBusy } from './sqliteBusyRetry';
import { SealedMatchedSnapshotStore } from './sealedMatchedSnapshotStore';
import type { SealedText } from './sealedText';

/**
 * PRB-055 kept one row per candidate (`sealed_matched_lists`, no longer written or read). B770: s07
 * by role and the general list are two choices, and each build overwrote the other's row, so after
 * a restart only one was answered at once. A row per choice now, a few per candidate.
 */
export const SEALED_MATCHED_LIST_SCHEMA = `
CREATE TABLE IF NOT EXISTS sealed_matched_lists (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  built_at INTEGER NOT NULL,
  cipher TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sealed_matched_list_choices (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  choice TEXT NOT NULL,
  built_at INTEGER NOT NULL,
  cipher TEXT NOT NULL,
  PRIMARY KEY (candidate_id, choice)
)`;

/**
 * B702 part 2: more than the list cache holds in memory. The general list, the roles list and its
 * sorts took all four rows, so the list of one role had none after a deploy (23.8 s, prod 24.11).
 */
export const SEALED_LISTS_PER_CANDIDATE = 8;

export interface SealedMatchedListRow {
  readonly builtAt: number;
  readonly text: string;
  readonly choice: string;
}

export type SealedMatchedListWrite =
  | {
      /** BEGIN IMMEDIATE to COMMIT: how long other writers of the database were held. */
      readonly heldMs: number;
      readonly lockWaitMs: number;
    }
  | { readonly skipped: 'busy'; readonly lockWaitMs: number };

/**
 * B776 (prod 23.11): the write waited 6.9 s on the event loop for the lock of the other slot while
 * it started. The sealed list is a cache: past this wait the write is skipped and the next build
 * seals again.
 */
export const SEAL_BUSY_TIMEOUT_MS = 50;

const associatedData = (candidateId: string, choice: string): string =>
  `sealed-matched-list:${candidateId}:${choice}`;

const roundMs = (ms: number): number => Number(ms.toFixed(2));

/**
 * The last lists of a candidate, sealed, one row per choice. A cache, not a record: dropping the
 * table loses nothing, and the rows go with the candidate through the foreign key.
 */
export class SealedMatchedListStore {
  /** Prod 19.11: the selection snapshot under the list, kept between processes the same way. */
  readonly snapshots: SealedMatchedSnapshotStore;

  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {
    this.database.exec(SEALED_MATCHED_LIST_SCHEMA);
    this.snapshots = new SealedMatchedSnapshotStore(database, sealedText);
  }

  /** The list of this choice built after `builtAfter`; with no choice, the latest one (checks, tests). */
  read(candidateId: string, builtAfter: number, choice?: string): SealedMatchedListRow | null {
    const row = (
      choice === undefined
        ? this.database
            .prepare(
              `SELECT built_at AS builtAt, cipher, choice FROM sealed_matched_list_choices
               WHERE candidate_id = ? AND built_at > ? ORDER BY built_at DESC LIMIT 1`,
            )
            .get(candidateId, builtAfter)
        : this.database
            .prepare(
              `SELECT built_at AS builtAt, cipher, choice FROM sealed_matched_list_choices
               WHERE candidate_id = ? AND choice = ? AND built_at > ?`,
            )
            .get(candidateId, choice, builtAfter)
    ) as { builtAt: number; cipher: string; choice: string } | undefined;
    if (!row) return null;
    const text = this.sealedText.open(row.cipher, associatedData(candidateId, row.choice));
    return { builtAt: row.builtAt, text, choice: row.choice };
  }

  /** Sealed before the lock: only the rows themselves are written inside the transaction. */
  write(candidateId: string, builtAt: number, text: string, choice: string): SealedMatchedListWrite {
    const cipher = this.sealedText.seal(text, associatedData(candidateId, choice));
    const startedAt = performance.now();
    if (!this.lockBriefly()) {
      return { skipped: 'busy', lockWaitMs: roundMs(performance.now() - startedAt) };
    }
    const lockedAt = performance.now();
    try {
      // An older build that finished late does not replace a newer one, as in the list cache.
      this.database
        .prepare(
          `INSERT INTO sealed_matched_list_choices (candidate_id, choice, built_at, cipher)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(candidate_id, choice) DO UPDATE SET built_at = excluded.built_at, cipher = excluded.cipher
           WHERE excluded.built_at >= sealed_matched_list_choices.built_at`,
        )
        .run(candidateId, choice, builtAt, cipher);
      this.database
        .prepare(
          `DELETE FROM sealed_matched_list_choices WHERE candidate_id = ? AND choice NOT IN (
             SELECT choice FROM sealed_matched_list_choices WHERE candidate_id = ?
             ORDER BY built_at DESC LIMIT ?)`,
        )
        .run(candidateId, candidateId, SEALED_LISTS_PER_CANDIDATE);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return { heldMs: roundMs(performance.now() - lockedAt), lockWaitMs: roundMs(lockedAt - startedAt) };
  }

  /** BEGIN IMMEDIATE with a short wait; the connection's own wait is restored for its other writers. */
  private lockBriefly(): boolean {
    try {
      beginImmediateBriefly(this.database, SEAL_BUSY_TIMEOUT_MS);
      return true;
    } catch (error) {
      if (isSqliteBusy(error)) return false;
      throw error;
    }
  }
}
