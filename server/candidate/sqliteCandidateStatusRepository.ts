import { DatabaseSync } from 'node:sqlite';
import type { CandidateStatusId } from '../../shared/candidateStatus';
import { SealedText } from '../data/sealedText';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';

/**
 * B665: смены статуса кандидата. Только новая таблица; пустая до первой смены,
 * поэтому `CREATE TABLE IF NOT EXISTS` ничего не стоит в окне здоровья выката.
 * Текущий статус — последняя невозвращённая строка.
 */
export const CANDIDATE_STATUS_SCHEMA = `
CREATE TABLE IF NOT EXISTS candidate_status_changes (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('looking', 'job_search', 'choosing_role', 'changing_profession', 'working')),
  target_cipher TEXT,
  previous_status TEXT NOT NULL,
  previous_target_cipher TEXT,
  source TEXT NOT NULL DEFAULT 'candidate' CHECK (source IN ('candidate')),
  applied_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revert_until TEXT NOT NULL,
  reverted_at TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS candidate_status_changes_by_candidate
  ON candidate_status_changes (candidate_id, created_at);
`;

/** Что было у автооткликов до паузы, поставленной при смене статуса. */
export interface AutoApplyPauseSnapshot {
  readonly appliedUntil: string;
  readonly previousPausedUntil: string | null;
  readonly previousRuntime: {
    readonly status: string;
    readonly pauseUntil: string | null;
    readonly nextSendAt: string | null;
  };
  readonly wasPaused: boolean;
}

/** Настройки, которые кандидат переключил при этой смене; их возвращает «Вернуть прежний». */
export interface StatusAppliedSettings {
  readonly autoApplyPause: AutoApplyPauseSnapshot | null;
}

export interface CandidateStatusChange {
  readonly id: string;
  readonly candidateId: string;
  readonly status: CandidateStatusId;
  readonly targetProfession: string | null;
  readonly previousStatus: CandidateStatusId;
  readonly previousTargetProfession: string | null;
  readonly applied: StatusAppliedSettings;
  readonly createdAt: string;
  readonly revertUntil: string;
  readonly revertedAt: string | null;
}

export type NewCandidateStatusChange = Omit<CandidateStatusChange, 'revertedAt'>;

interface ChangeRow {
  id: string;
  candidate_id: string;
  status: CandidateStatusId;
  target_cipher: string | null;
  previous_status: CandidateStatusId;
  previous_target_cipher: string | null;
  applied_json: string;
  created_at: string;
  revert_until: string;
  reverted_at: string | null;
}

const COLUMNS =
  'id, candidate_id, status, target_cipher, previous_status, previous_target_cipher, applied_json, created_at, revert_until, reverted_at';
export const STATUS_HISTORY_LIMIT = 20;

export class SqliteCandidateStatusRepository {
  private readonly database: DatabaseSync;
  private readonly ownsDatabase: boolean;
  private readonly sealedText: SealedText;

  constructor(options: DatabaseSync | { databasePath: string; encryptionKey: Buffer }, key?: Buffer) {
    this.ownsDatabase = !(options instanceof DatabaseSync);
    this.database =
      options instanceof DatabaseSync ? options : new DatabaseSync(options.databasePath);
    const encryptionKey = options instanceof DatabaseSync ? key : options.encryptionKey;
    if (!encryptionKey) throw new Error('candidate_status_encryption_key_missing');
    this.sealedText = new SealedText(encryptionKey);
    if (this.ownsDatabase) this.database.exec('PRAGMA journal_mode = WAL;');
    applySqliteBusyTimeout(this.database);
    this.database.exec(CANDIDATE_STATUS_SCHEMA);
  }

  close(): void {
    if (this.ownsDatabase) this.database.close();
  }

  current(candidateId: string): CandidateStatusChange | null {
    return this.history(candidateId, 1)[0] ?? null;
  }

  /** Невозвращённые смены, новые первыми. */
  history(candidateId: string, limit = STATUS_HISTORY_LIMIT): CandidateStatusChange[] {
    const rows = this.database
      .prepare(
        `SELECT ${COLUMNS} FROM candidate_status_changes
         WHERE candidate_id = ? AND reverted_at IS NULL
         ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(candidateId, limit) as unknown as ChangeRow[];
    return rows.map((row) => this.fromRow(row));
  }

  record(input: NewCandidateStatusChange): CandidateStatusChange {
    this.database
      .prepare(
        `INSERT INTO candidate_status_changes (${COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        input.id,
        input.candidateId,
        input.status,
        this.seal(input, 'target', input.targetProfession),
        input.previousStatus,
        this.seal(input, 'previous_target', input.previousTargetProfession),
        JSON.stringify(input.applied),
        input.createdAt,
        input.revertUntil,
      );
    return { ...input, revertedAt: null };
  }

  /** `false`, если смены нет у этого кандидата или она уже возвращена. */
  markReverted(candidateId: string, id: string, revertedAt: string): boolean {
    const result = this.database
      .prepare(
        `UPDATE candidate_status_changes SET reverted_at = ?
         WHERE candidate_id = ? AND id = ? AND reverted_at IS NULL`,
      )
      .run(revertedAt, candidateId, id);
    return result.changes === 1;
  }

  private aad(candidateId: string, id: string, field: string): string {
    return `candidate_status:${candidateId}:${id}:${field}`;
  }

  private seal(
    input: Pick<NewCandidateStatusChange, 'candidateId' | 'id'>,
    field: string,
    value: string | null,
  ): string | null {
    return value === null
      ? null
      : this.sealedText.seal(value, this.aad(input.candidateId, input.id, field));
  }

  private open(row: ChangeRow, field: string, cipher: string | null): string | null {
    return cipher === null
      ? null
      : this.sealedText.open(cipher, this.aad(row.candidate_id, row.id, field));
  }

  private fromRow(row: ChangeRow): CandidateStatusChange {
    return {
      id: row.id,
      candidateId: row.candidate_id,
      status: row.status,
      targetProfession: this.open(row, 'target', row.target_cipher),
      previousStatus: row.previous_status,
      previousTargetProfession: this.open(row, 'previous_target', row.previous_target_cipher),
      applied: JSON.parse(row.applied_json) as StatusAppliedSettings,
      createdAt: row.created_at,
      revertUntil: row.revert_until,
      revertedAt: row.reverted_at,
    };
  }
}
