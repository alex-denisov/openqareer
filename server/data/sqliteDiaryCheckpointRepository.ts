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
  private readonly ownsDatabase: boolean;
  private readonly sealedText: SealedText;

  /** Своё соединение по пути к базе или (B689, выгрузка) чужое соединение хранилища. */
  constructor(options: DatabaseSync | { databasePath: string; encryptionKey: Buffer }, key?: Buffer) {
    this.ownsDatabase = !(options instanceof DatabaseSync);
    this.database = options instanceof DatabaseSync ? options : new DatabaseSync(options.databasePath);
    const encryptionKey = options instanceof DatabaseSync ? key : options.encryptionKey;
    if (!encryptionKey) throw new Error('diary_checkpoint_encryption_key_missing');
    this.sealedText = new SealedText(encryptionKey);
    try {
      // Чужое соединение (хранилища) живёт со своими настройками ожидания и журнала.
      if (this.ownsDatabase) {
        applySqliteBusyTimeout(this.database, SQLITE_HTTP_BUSY_TIMEOUT_MS);
        this.database.exec('PRAGMA journal_mode = WAL;');
      }
      this.database.exec(DIARY_CHECKPOINT_SCHEMA);
    } catch (error) {
      this.close();
      throw error;
    }
  }

  close(): void {
    if (this.ownsDatabase) this.database.close();
  }

  /** B689: все отметки кандидата — для выгрузки данных. */
  exportAll(candidateId: string): Array<{ workplaceId: string; kind: string; mark: CheckpointMark }> {
    const rows = this.database
      .prepare(
        `SELECT workplace_id, kind FROM career_diary_checkpoints
         WHERE candidate_id = ? ORDER BY workplace_id, kind`,
      )
      .all(candidateId) as unknown as Array<{ workplace_id: string; kind: string }>;
    return rows.map((row) => ({
      workplaceId: row.workplace_id,
      kind: row.kind,
      mark: this.get(candidateId, row.workplace_id, row.kind),
    }));
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
