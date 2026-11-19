import { DatabaseSync } from 'node:sqlite';
import type { AutoApplyPauseSnapshot } from '../candidate/sqliteCandidateStatusRepository';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';

/** B689: сколько дней аккаунт можно вернуть после «Удалить аккаунт». */
export const ACCOUNT_DELETION_GRACE_DAYS = 30;
const DAY_MS = 86_400_000;

export interface AccountDeletionRequest {
  readonly candidateId: string;
  readonly requestedAt: string;
  /** С этого момента данные стираются. */
  readonly purgeAfter: string;
  /** Пауза автооткликов, поставленная удалением; возврат аккаунта её снимает. */
  readonly pause: AutoApplyPauseSnapshot | null;
}

interface Row {
  candidate_id: string;
  requested_at: string;
  purge_after: string;
  pause_snapshot: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS candidate_account_deletions (
  candidate_id TEXT PRIMARY KEY,
  requested_at TEXT NOT NULL,
  purge_after TEXT NOT NULL,
  pause_snapshot TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_account_deletions_purge_after
  ON candidate_account_deletions (purge_after);
`;

function readSnapshot(value: string | null): AutoApplyPauseSnapshot | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && 'appliedUntil' in parsed
      ? (parsed as AutoApplyPauseSnapshot)
      : null;
  } catch {
    return null;
  }
}

function toRequest(row: Row): AccountDeletionRequest {
  return {
    candidateId: row.candidate_id,
    requestedAt: row.requested_at,
    purgeAfter: row.purge_after,
    pause: readSnapshot(row.pause_snapshot),
  };
}

/** Запросы на удаление аккаунта с отсрочкой (B689). */
export class SqliteAccountDeletionStore {
  private readonly database: DatabaseSync;
  private readonly ownsDatabase: boolean;

  constructor(options: DatabaseSync | { databasePath: string }) {
    if (options instanceof DatabaseSync) {
      this.database = options;
      this.ownsDatabase = false;
    } else {
      this.database = new DatabaseSync(options.databasePath);
      this.database.exec('PRAGMA journal_mode = WAL;');
      applySqliteBusyTimeout(this.database);
      this.ownsDatabase = true;
    }
    this.database.exec(SCHEMA);
  }

  get(candidateId: string): AccountDeletionRequest | null {
    const row = this.database
      .prepare('SELECT * FROM candidate_account_deletions WHERE candidate_id = ?')
      .get(candidateId) as Row | undefined;
    return row ? toRequest(row) : null;
  }

  /** Повторный запрос срок не сдвигает: действует первый. */
  schedule(
    candidateId: string,
    now: Date,
    pause: AutoApplyPauseSnapshot | null,
  ): AccountDeletionRequest {
    const purgeAfter = new Date(now.getTime() + ACCOUNT_DELETION_GRACE_DAYS * DAY_MS);
    this.database
      .prepare(
        `INSERT INTO candidate_account_deletions (candidate_id, requested_at, purge_after, pause_snapshot)
         VALUES (?, ?, ?, ?) ON CONFLICT (candidate_id) DO NOTHING`,
      )
      .run(
        candidateId,
        now.toISOString(),
        purgeAfter.toISOString(),
        pause ? JSON.stringify(pause) : null,
      );
    return this.get(candidateId)!;
  }

  /** Возврат аккаунта; `null` — удаление не было запрошено. */
  cancel(candidateId: string): AccountDeletionRequest | null {
    const request = this.get(candidateId);
    if (request) this.remove(candidateId);
    return request;
  }

  /** Неудачное стирание уходит в конец очереди, чтобы не держать остальных. */
  postpone(candidateId: string, until: Date): void {
    this.database
      .prepare('UPDATE candidate_account_deletions SET purge_after = ? WHERE candidate_id = ?')
      .run(until.toISOString(), candidateId);
  }

  remove(candidateId: string): void {
    this.database
      .prepare('DELETE FROM candidate_account_deletions WHERE candidate_id = ?')
      .run(candidateId);
  }

  listDue(now: Date, limit: number): readonly AccountDeletionRequest[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM candidate_account_deletions WHERE purge_after <= ?
         ORDER BY purge_after ASC LIMIT ?`,
      )
      .all(now.toISOString(), limit) as unknown as Row[];
    return rows.map(toRequest);
  }

  close(): void {
    if (this.ownsDatabase) this.database.close();
  }
}
