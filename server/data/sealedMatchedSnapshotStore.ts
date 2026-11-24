import type { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { gunzipSync, gzip } from 'node:zlib';
import { syncSection } from '../observability/syncSections';
import { beginImmediateBriefly } from './sqliteBriefLock';
import { retryOnSqliteBusy } from './sqliteBusyRetry';
import type { SealedText } from './sealedText';

/**
 * One row per candidate and profile: «Карьера» reads a snapshot per role (B645 s09), and one row
 * per candidate let each role's write evict the campaign's snapshot.
 */
export const SEALED_MATCHED_SNAPSHOT_SCHEMA = `
CREATE TABLE IF NOT EXISTS matched_snapshot_seals (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  profile_key TEXT NOT NULL,
  built_at INTEGER NOT NULL,
  cipher TEXT NOT NULL,
  PRIMARY KEY (candidate_id, profile_key)
)`;

/** The campaign, the strategy role and the campaign roles fit with room for a changed profile. */
const MAX_SNAPSHOTS_PER_CANDIDATE = 24;

/** The first table (#790) keyed by candidate only; its seals carry the same AAD and move over. */
const FIRST_TABLE_MOVE = `
INSERT OR IGNORE INTO matched_snapshot_seals (candidate_id, profile_key, built_at, cipher)
  SELECT candidate_id, profile_key, built_at, cipher FROM sealed_matched_snapshots;
DROP TABLE sealed_matched_snapshots`;

/**
 * B770 (prod 24.11 09:31Z): the write waited 9.6 s on the event loop for the lock of the other slot
 * while it started. One attempt waits this long; the retries wait off the loop.
 */
const SNAPSHOT_BUSY_TIMEOUT_MS = 50;

/** Off-loop waits between attempts: longer together than the 12 s lock of a starting slot. */
const SNAPSHOT_BUSY_RETRY_MS: readonly number[] = [250, 1_000, 3_000, 5_000, 10_000];

const gzipInPool = promisify(gzip);

export interface SealedMatchedSnapshotRow {
  readonly builtAt: number;
  readonly text: string;
}

const associatedData = (candidateId: string, profileKey: string): string =>
  `sealed-matched-snapshot:${candidateId}:${profileKey}`;

/**
 * Prod 19.11: the selections a candidate's screens read, sealed and compressed. A cache, not a record: a deploy answers from it instead of a 20-45 s cold pool read.
 * The profile key is bound into the seal, so a row can never answer another profile.
 */
export class SealedMatchedSnapshotStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {
    this.database.exec(SEALED_MATCHED_SNAPSHOT_SCHEMA);
    const first = this.database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sealed_matched_snapshots'")
      .get();
    if (first) this.database.exec(FIRST_TABLE_MOVE);
  }

  read(candidateId: string, profileKey: string): SealedMatchedSnapshotRow | null {
    const row = this.database
      .prepare(
        'SELECT built_at AS builtAt, cipher FROM matched_snapshot_seals WHERE candidate_id = ? AND profile_key = ?',
      )
      .get(candidateId, profileKey) as { builtAt: number; cipher: string } | undefined;
    if (!row) return null;
    const packed = this.sealedText.open(row.cipher, associatedData(candidateId, profileKey));
    return { builtAt: row.builtAt, text: gunzipSync(Buffer.from(packed, 'base64')).toString('utf8') };
  }

  /** Sealed before the write; an older build that finished late does not replace a newer one. */
  async write(
    candidateId: string,
    profileKey: string,
    builtAt: number,
    text: string,
    isWanted: () => boolean = () => true,
  ): Promise<void> {
    // Compression took 85 % of the section (B770): it runs in the thread pool.
    const packed = (await gzipInPool(Buffer.from(text, 'utf8'))).toString('base64');
    if (!isWanted()) return;
    const cipher = syncSection('snapshot:store', () =>
      this.sealedText.seal(packed, associatedData(candidateId, profileKey)),
    );
    await retryOnSqliteBusy(() => {
      // Dropped while it was packed or waited: writing now would bring the deleted row back.
      if (!isWanted()) return;
      syncSection('snapshot:store', () => this.writeRow(candidateId, profileKey, builtAt, cipher));
    }, { delaysMs: SNAPSHOT_BUSY_RETRY_MS });
  }

  private writeRow(candidateId: string, profileKey: string, builtAt: number, cipher: string): void {
    beginImmediateBriefly(this.database, SNAPSHOT_BUSY_TIMEOUT_MS);
    try {
      this.upsertRow(candidateId, profileKey, builtAt, cipher);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private upsertRow(candidateId: string, profileKey: string, builtAt: number, cipher: string): void {
    this.database
      .prepare(
        `INSERT INTO matched_snapshot_seals (candidate_id, profile_key, built_at, cipher) VALUES (?, ?, ?, ?)
         ON CONFLICT(candidate_id, profile_key) DO UPDATE SET built_at = excluded.built_at, cipher = excluded.cipher
         WHERE excluded.built_at >= matched_snapshot_seals.built_at`,
      )
      .run(candidateId, profileKey, builtAt, cipher);
    this.database
      .prepare(
        `DELETE FROM matched_snapshot_seals WHERE candidate_id = ?1 AND profile_key NOT IN (
           SELECT profile_key FROM matched_snapshot_seals WHERE candidate_id = ?1
           ORDER BY built_at DESC LIMIT ?2)`,
      )
      .run(candidateId, MAX_SNAPSHOTS_PER_CANDIDATE);
  }

  keys(candidateId: string): string[] {
    return (
      this.database
        .prepare(
          'SELECT profile_key AS profileKey FROM matched_snapshot_seals WHERE candidate_id = ? ORDER BY built_at DESC',
        )
        .all(candidateId) as { profileKey: string }[]
    ).map((row) => row.profileKey);
  }

  delete(candidateId: string): void {
    this.database.prepare('DELETE FROM matched_snapshot_seals WHERE candidate_id = ?').run(candidateId);
  }
}
