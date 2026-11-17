import { DatabaseSync } from 'node:sqlite';
import type { StatusSignalAnswer, StatusSignalKind } from '../../shared/statusSignal';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';

/**
 * B691: ответы кандидата на сигналы «Сегодня». Только добавление: новая
 * таблица, прежние не меняются. Свободного текста в ней нет.
 */
export const STATUS_SIGNAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS candidate_status_signal_answers (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('started_search', 'changing_profession')),
  answer TEXT NOT NULL CHECK (answer IN ('yes', 'no', 'later')),
  created_at TEXT NOT NULL,
  undo_until TEXT NOT NULL,
  undone_at TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS candidate_status_signal_answers_by_candidate
  ON candidate_status_signal_answers (candidate_id, created_at);
`;

export interface StoredSignalAnswer {
  readonly id: string;
  readonly candidateId: string;
  readonly kind: StatusSignalKind;
  readonly answer: StatusSignalAnswer;
  readonly createdAt: string;
  /** До этого момента ответ можно отменить: конец дня кандидата. */
  readonly undoUntil: string;
}

interface AnswerRow {
  id: string;
  candidate_id: string;
  kind: StatusSignalKind;
  answer: StatusSignalAnswer;
  created_at: string;
  undo_until: string;
}

/** Сколько последних ответов «Верно» и «Не сейчас» читать: старые на расчёт не влияют. */
const RECENT_LIMIT = 50;

export class SqliteStatusSignalRepository {
  private readonly database: DatabaseSync;
  private readonly ownsDatabase: boolean;

  constructor(options: DatabaseSync | { readonly databasePath: string }) {
    this.ownsDatabase = !(options instanceof DatabaseSync);
    this.database =
      options instanceof DatabaseSync ? options : new DatabaseSync(options.databasePath);
    if (this.ownsDatabase)
      this.database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    applySqliteBusyTimeout(this.database);
    this.database.exec(STATUS_SIGNAL_SCHEMA);
  }

  close(): void {
    if (this.ownsDatabase) this.database.close();
  }

  /**
   * Неотменённые ответы кандидата, новые первыми: все «Нет» (по ним сигнал
   * выключается насовсем) и последние остальные.
   */
  active(candidateId: string): StoredSignalAnswer[] {
    const rows = this.database
      .prepare(
        `SELECT id, candidate_id, kind, answer, created_at, undo_until
         FROM candidate_status_signal_answers
         WHERE candidate_id = ?1 AND undone_at IS NULL
           AND (answer = 'no' OR rowid IN (
             SELECT rowid FROM candidate_status_signal_answers
             WHERE candidate_id = ?1 AND undone_at IS NULL
             ORDER BY created_at DESC, rowid DESC LIMIT ?2))
         ORDER BY created_at DESC, rowid DESC`,
      )
      .all(candidateId, RECENT_LIMIT) as unknown as AnswerRow[];
    return rows.map((row) => ({
      id: row.id,
      candidateId: row.candidate_id,
      kind: row.kind,
      answer: row.answer,
      createdAt: row.created_at,
      undoUntil: row.undo_until,
    }));
  }

  /** Id самого нового ответа, если он ещё не отменён; иначе `null`. */
  latestActiveId(candidateId: string): string | null {
    const row = this.database
      .prepare(
        `SELECT id, undone_at FROM candidate_status_signal_answers
         WHERE candidate_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(candidateId) as { id: string; undone_at: string | null } | undefined;
    return row && row.undone_at === null ? row.id : null;
  }

  record(input: StoredSignalAnswer): StoredSignalAnswer {
    this.database
      .prepare(
        `INSERT INTO candidate_status_signal_answers
           (id, candidate_id, kind, answer, created_at, undo_until, undone_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(input.id, input.candidateId, input.kind, input.answer, input.createdAt, input.undoUntil);
    return input;
  }

  /** `false`, если ответа нет у этого кандидата или он уже отменён. */
  markUndone(candidateId: string, id: string, undoneAt: string): boolean {
    const result = this.database
      .prepare(
        `UPDATE candidate_status_signal_answers SET undone_at = ?
         WHERE candidate_id = ? AND id = ? AND undone_at IS NULL`,
      )
      .run(undoneAt, candidateId, id);
    return Number(result.changes) > 0;
  }
}
