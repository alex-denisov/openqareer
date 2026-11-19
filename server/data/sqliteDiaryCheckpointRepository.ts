import { DatabaseSync } from 'node:sqlite';
import { openPayload, sealPayload } from './careerDiaryRepositoryHelpers';
import { SealedText } from './sealedText';
import { applySqliteBusyTimeout, SQLITE_HTTP_BUSY_TIMEOUT_MS } from './sqliteBusyTimeout';

/**
 * B687: отметки контрольных точек адаптации (письмо руководителю на 30-й день
 * отправлено). Одна новая таблица; содержимое зашифровано и уходит вместе с кандидатом.
 */
export const DIARY_CHECKPOINT_SCHEMA = `
CREATE TABLE IF NOT EXISTS career_diary_checkpoints (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  workplace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_cipher TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, workplace_id, kind)
) STRICT;
`;

export interface CheckpointMark {
  readonly sentOn: string | null;
}

export class SqliteDiaryCheckpointRepository {
  private readonly database: DatabaseSync;
  private readonly sealedText: SealedText;

  constructor(options: { databasePath: string; encryptionKey: Buffer }) {
    this.database = new DatabaseSync(options.databasePath);
    this.sealedText = new SealedText(options.encryptionKey);
    try {
      applySqliteBusyTimeout(this.database, SQLITE_HTTP_BUSY_TIMEOUT_MS);
      this.database.exec('PRAGMA journal_mode = WAL;');
      this.database.exec(DIARY_CHECKPOINT_SCHEMA);
    } catch (error) {
      this.close();
      throw error;
    }
  }

  close(): void {
    this.database.close();
  }

  get(candidateId: string, workplaceId: string, kind: string): CheckpointMark {
    const row = this.database
      .prepare('SELECT payload_cipher FROM career_diary_checkpoints WHERE candidate_id = ? AND workplace_id = ? AND kind = ?')
      .get(candidateId, workplaceId, kind) as { payload_cipher: string } | undefined;
    if (!row) return { sentOn: null };
    return openPayload<CheckpointMark>(this.sealedText, candidateId, 'diary-checkpoint', `${workplaceId}:${kind}`, row.payload_cipher);
  }

  save(candidateId: string, workplaceId: string, kind: string, mark: CheckpointMark): void {
    const payload = sealPayload(this.sealedText, candidateId, 'diary-checkpoint', `${workplaceId}:${kind}`, mark);
    this.database
      .prepare(
        `INSERT INTO career_diary_checkpoints (candidate_id, workplace_id, kind, payload_cipher, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id, workplace_id, kind) DO UPDATE SET
           payload_cipher = excluded.payload_cipher, updated_at = excluded.updated_at`,
      )
      .run(candidateId, workplaceId, kind, payload, new Date().toISOString());
  }
}
