import type { DatabaseSync } from 'node:sqlite';
import type { SealedText } from './sealedText';

export const SEALED_MATCHED_LIST_SCHEMA = `
CREATE TABLE IF NOT EXISTS sealed_matched_lists (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  built_at INTEGER NOT NULL,
  cipher TEXT NOT NULL
)`;

export interface SealedMatchedListRow {
  readonly builtAt: number;
  readonly text: string;
}

export interface SealedMatchedListWrite {
  /** BEGIN IMMEDIATE to COMMIT: how long other writers of the database were held. */
  readonly heldMs: number;
  readonly lockWaitMs: number;
}

const associatedData = (candidateId: string): string => `sealed-matched-list:${candidateId}`;

const roundMs = (ms: number): number => Number(ms.toFixed(2));

/**
 * PRB-055: the last list of a candidate, sealed, one row per candidate. A cache, not a record:
 * dropping the table loses nothing, and the row goes with the candidate through the foreign key.
 */
export class SealedMatchedListStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {
    this.database.exec(SEALED_MATCHED_LIST_SCHEMA);
  }

  read(candidateId: string, builtAfter: number): SealedMatchedListRow | null {
    const row = this.database
      .prepare('SELECT built_at AS builtAt, cipher FROM sealed_matched_lists WHERE candidate_id = ? AND built_at > ?')
      .get(candidateId, builtAfter) as { builtAt: number; cipher: string } | undefined;
    if (!row) return null;
    return { builtAt: row.builtAt, text: this.sealedText.open(row.cipher, associatedData(candidateId)) };
  }

  /** Sealed before the lock: only the row itself is written inside the transaction. */
  write(candidateId: string, builtAt: number, text: string): SealedMatchedListWrite {
    const cipher = this.sealedText.seal(text, associatedData(candidateId));
    const startedAt = performance.now();
    this.database.exec('BEGIN IMMEDIATE');
    const lockedAt = performance.now();
    try {
      // An older build that finished late does not replace a newer one, as in the list cache.
      this.database
        .prepare(
          `INSERT INTO sealed_matched_lists (candidate_id, built_at, cipher) VALUES (?, ?, ?)
           ON CONFLICT(candidate_id) DO UPDATE SET built_at = excluded.built_at, cipher = excluded.cipher
           WHERE excluded.built_at >= sealed_matched_lists.built_at`,
        )
        .run(candidateId, builtAt, cipher);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return { heldMs: roundMs(performance.now() - lockedAt), lockWaitMs: roundMs(lockedAt - startedAt) };
  }
}
