import { DatabaseSync } from 'node:sqlite';
import type { RejectionCandidateReason, RejectionReason } from '../../shared/rejectionReview';
import { SealedText } from '../data/sealedText';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';

/**
 * B679: что кандидат сам отметил по отказу и помог ли ему разбор. Только новые таблицы;
 * пустые до первой отметки, поэтому `CREATE TABLE IF NOT EXISTS` ничего не стоит при выкате.
 * Текст «что написали» хранится запечатанным.
 */
export const REJECTION_REVIEW_SCHEMA = `
CREATE TABLE IF NOT EXISTS application_rejection_reasons (
  application_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('level', 'experience', 'money', 'no_answer', 'other')),
  note_cipher TEXT,
  recorded_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS application_rejection_reasons_by_candidate
  ON application_rejection_reasons (candidate_id);
CREATE TABLE IF NOT EXISTS rejection_review_feedback (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  helped INTEGER NOT NULL CHECK (helped IN (0, 1)),
  recorded_at TEXT NOT NULL
) STRICT;
`;

interface ReasonRow {
  application_id: string;
  reason: RejectionReason;
  note_cipher: string | null;
  recorded_at: string;
}

export interface NewRejectionReason {
  readonly candidateId: string;
  readonly applicationId: string;
  readonly reason: RejectionReason;
  readonly note: string | null;
  readonly recordedAt: string;
}

export class SqliteRejectionReviewRepository {
  private readonly database: DatabaseSync;
  private readonly ownsDatabase: boolean;
  private readonly sealedText: SealedText;

  constructor(options: DatabaseSync | { databasePath: string; encryptionKey: Buffer }, key?: Buffer) {
    this.ownsDatabase = !(options instanceof DatabaseSync);
    this.database =
      options instanceof DatabaseSync ? options : new DatabaseSync(options.databasePath);
    const encryptionKey = options instanceof DatabaseSync ? key : options.encryptionKey;
    if (!encryptionKey) throw new Error('rejection_review_encryption_key_missing');
    this.sealedText = new SealedText(encryptionKey);
    if (this.ownsDatabase) this.database.exec('PRAGMA journal_mode = WAL;');
    applySqliteBusyTimeout(this.database);
    this.database.exec(REJECTION_REVIEW_SCHEMA);
  }

  close(): void {
    if (this.ownsDatabase) this.database.close();
  }

  private noteScope(applicationId: string): string {
    return `rejection-reason:${applicationId}`;
  }

  /** Отметки кандидата по его отказам: ключ — отклик. */
  reasons(candidateId: string): Map<string, RejectionCandidateReason> {
    const rows = this.database
      .prepare(
        `SELECT application_id, reason, note_cipher, recorded_at
         FROM application_rejection_reasons WHERE candidate_id = ?`,
      )
      .all(candidateId) as unknown as ReasonRow[];
    return new Map(
      rows.map((row) => [
        row.application_id,
        {
          reason: row.reason,
          note: row.note_cipher
            ? this.sealedText.open(row.note_cipher, this.noteScope(row.application_id))
            : null,
          recordedAt: row.recorded_at,
        },
      ]),
    );
  }

  /** Одна отметка на отклик: новая заменяет прежнюю. Чужой отклик не перезаписывается. */
  saveReason(input: NewRejectionReason): RejectionCandidateReason {
    const cipher = input.note
      ? this.sealedText.seal(input.note, this.noteScope(input.applicationId))
      : null;
    this.database
      .prepare(
        `INSERT INTO application_rejection_reasons
           (application_id, candidate_id, reason, note_cipher, recorded_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(application_id) DO UPDATE SET
           reason = excluded.reason, note_cipher = excluded.note_cipher,
           recorded_at = excluded.recorded_at
         WHERE application_rejection_reasons.candidate_id = excluded.candidate_id`,
      )
      .run(input.applicationId, input.candidateId, input.reason, cipher, input.recordedAt);
    return { reason: input.reason, note: input.note, recordedAt: input.recordedAt };
  }

  helped(candidateId: string): boolean | null {
    const row = this.database
      .prepare('SELECT helped FROM rejection_review_feedback WHERE candidate_id = ?')
      .get(candidateId) as { helped: number } | undefined;
    return row ? row.helped === 1 : null;
  }

  saveHelped(candidateId: string, helped: boolean, recordedAt: string): void {
    this.database
      .prepare(
        `INSERT INTO rejection_review_feedback (candidate_id, helped, recorded_at)
         VALUES (?, ?, ?)
         ON CONFLICT(candidate_id) DO UPDATE SET
           helped = excluded.helped, recorded_at = excluded.recorded_at`,
      )
      .run(candidateId, helped ? 1 : 0, recordedAt);
  }
}
