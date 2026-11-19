import type { DatabaseSync } from 'node:sqlite';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { SealedText } from './sealedText';

export const SEALED_MATCHED_SNAPSHOT_SCHEMA = `
CREATE TABLE IF NOT EXISTS sealed_matched_snapshots (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  profile_key TEXT NOT NULL,
  built_at INTEGER NOT NULL,
  cipher TEXT NOT NULL
)`;

export interface SealedMatchedSnapshotRow {
  readonly builtAt: number;
  readonly text: string;
}

const associatedData = (candidateId: string, profileKey: string): string =>
  `sealed-matched-snapshot:${candidateId}:${profileKey}`;

/**
 * Prod 19.11: the selection a candidate's screens read, sealed and compressed, one row per
 * candidate. A cache, not a record: a deploy answers from it instead of a 20-45 s cold pool read.
 * The profile key is bound into the seal, so a row can never answer another profile.
 */
export class SealedMatchedSnapshotStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {
    this.database.exec(SEALED_MATCHED_SNAPSHOT_SCHEMA);
  }

  read(candidateId: string, profileKey: string): SealedMatchedSnapshotRow | null {
    const row = this.database
      .prepare(
        'SELECT built_at AS builtAt, cipher FROM sealed_matched_snapshots WHERE candidate_id = ? AND profile_key = ?',
      )
      .get(candidateId, profileKey) as { builtAt: number; cipher: string } | undefined;
    if (!row) return null;
    const packed = this.sealedText.open(row.cipher, associatedData(candidateId, profileKey));
    return { builtAt: row.builtAt, text: gunzipSync(Buffer.from(packed, 'base64')).toString('utf8') };
  }

  /** Sealed before the write; an older build that finished late does not replace a newer one. */
  write(candidateId: string, profileKey: string, builtAt: number, text: string): void {
    const packed = gzipSync(Buffer.from(text, 'utf8')).toString('base64');
    const cipher = this.sealedText.seal(packed, associatedData(candidateId, profileKey));
    this.database
      .prepare(
        `INSERT INTO sealed_matched_snapshots (candidate_id, profile_key, built_at, cipher) VALUES (?, ?, ?, ?)
         ON CONFLICT(candidate_id) DO UPDATE SET
           profile_key = excluded.profile_key, built_at = excluded.built_at, cipher = excluded.cipher
         WHERE excluded.built_at >= sealed_matched_snapshots.built_at`,
      )
      .run(candidateId, profileKey, builtAt, cipher);
  }

  delete(candidateId: string): void {
    this.database.prepare('DELETE FROM sealed_matched_snapshots WHERE candidate_id = ?').run(candidateId);
  }
}
