import type { DatabaseSync } from 'node:sqlite';
import type { CandidateMediaKind, DownloadedMedia } from '../domain/candidateMedia';
import type { SealedText } from './sealedText';

interface CandidateMediaRow {
  mime: string;
  bytes_cipher: string;
  byte_length: number;
}

export interface StoredCandidateMedia {
  readonly mime: string;
  readonly bytes: Buffer;
}

/**
 * Sealed cache of LinkedIn photo/logo bytes (B265 §4). One row per
 * `(candidate_id, media_id)`; `media_id` is content-addressed by path (see
 * `mediaIdFor`), so `saveMany` is naturally idempotent — re-saving the same
 * media just overwrites the same row with the same bytes.
 */
export class SqliteCandidateMediaRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {}

  saveMany(candidateId: string, items: readonly DownloadedMedia[]): void {
    if (items.length === 0) return;
    const now = new Date().toISOString();
    const statement = this.database.prepare(
      `INSERT INTO candidate_media
        (candidate_id, media_id, kind, mime, bytes_cipher, byte_length, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(candidate_id, media_id) DO UPDATE SET
         kind = excluded.kind,
         mime = excluded.mime,
         bytes_cipher = excluded.bytes_cipher,
         byte_length = excluded.byte_length`,
    );
    for (const item of items) {
      statement.run(
        candidateId,
        item.mediaId,
        item.kind,
        item.mime,
        this.seal(candidateId, item.mediaId, item.bytes),
        item.bytes.length,
        now,
      );
    }
  }

  get(candidateId: string, mediaId: string): StoredCandidateMedia | null {
    const row = this.database
      .prepare(
        `SELECT mime, bytes_cipher, byte_length FROM candidate_media
         WHERE candidate_id = ? AND media_id = ?`,
      )
      .get(candidateId, mediaId) as CandidateMediaRow | undefined;
    if (!row) return null;
    return { mime: row.mime, bytes: this.open(candidateId, mediaId, row.bytes_cipher) };
  }

  /**
   * Deletes every row for this candidate whose `media_id` the current draft no
   * longer cites — a re-import or a PUT that drops a photo/logo must not leave
   * an orphaned copy sitting in the database forever (QA spec slice 2 #15).
   */
  pruneUnreferenced(candidateId: string, keepMediaIds: readonly string[]): void {
    const distinct = [...new Set(keepMediaIds)];
    if (distinct.length === 0) {
      this.database
        .prepare('DELETE FROM candidate_media WHERE candidate_id = ?')
        .run(candidateId);
      return;
    }
    const placeholders = distinct.map(() => '?').join(', ');
    this.database
      .prepare(
        `DELETE FROM candidate_media
         WHERE candidate_id = ? AND media_id NOT IN (${placeholders})`,
      )
      .run(candidateId, ...distinct);
  }

  private seal(candidateId: string, mediaId: string, bytes: Buffer): string {
    return this.sealedText.seal(bytes.toString('base64'), associatedData(candidateId, mediaId));
  }

  private open(candidateId: string, mediaId: string, cipher: string): Buffer {
    return Buffer.from(this.sealedText.open(cipher, associatedData(candidateId, mediaId)), 'base64');
  }
}

function associatedData(candidateId: string, mediaId: string): string {
  return `candidate:${candidateId}:media:${mediaId}`;
}

export type { CandidateMediaKind };
