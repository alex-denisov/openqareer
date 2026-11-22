import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openPayload, sealPayload } from './careerDiaryRepositoryHelpers';
import { SealedText } from './sealedText';
import { applySqliteBusyTimeout, SQLITE_HTTP_BUSY_TIMEOUT_MS } from './sqliteBusyTimeout';

/**
 * B743 · 2: подсказки задач по целям дневника. Одна строка на (цель, хеш входа): по ней знаем,
 * что для этих данных цели модель уже спрашивали, и что кандидат ответил. Текст подсказки —
 * производное от данных кандидата, поэтому запечатан. Ответ «полезной задачи нет» хранится как
 * закрытая строка без текста (`skipped`, `text_cipher` NULL): тот же вход заново не спрашиваем.
 * Удаление кандидата уносит строки каскадом.
 */
export const GOAL_TASK_SUGGESTION_SCHEMA = `
CREATE TABLE IF NOT EXISTS career_diary_task_suggestions (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  text_cipher TEXT,
  due_date TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'added', 'skipped')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  PRIMARY KEY (candidate_id, id),
  UNIQUE (candidate_id, goal_id, input_hash)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_career_diary_task_suggestions_goal
  ON career_diary_task_suggestions(candidate_id, goal_id, created_at DESC);
CREATE TABLE IF NOT EXISTS career_diary_task_suggestion_attempts (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_career_diary_task_suggestion_attempts_recent
  ON career_diary_task_suggestion_attempts(candidate_id, created_at);
`;

const TEXT = 'task-suggestion-text';
/** Строк одной цели, которые держим: по изменению данных цели строк прибавляется. */
const KEEP_PER_GOAL = 50;
const SKIPPED_FOR_DEDUPE = 30;

export type GoalTaskSuggestionStatus = 'open' | 'added' | 'skipped';

export interface GoalTaskSuggestionRecord {
  readonly id: string;
  readonly goalId: string;
  readonly inputHash: string;
  /** `null` — модель не нашла полезной задачи. */
  readonly text: string | null;
  readonly dueDate: string | null;
  readonly status: GoalTaskSuggestionStatus;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

interface Row {
  readonly id: string;
  readonly goal_id: string;
  readonly input_hash: string;
  readonly text_cipher: string | null;
  readonly due_date: string | null;
  readonly status: GoalTaskSuggestionStatus;
  readonly created_at: string;
  readonly resolved_at: string | null;
}

const COLUMNS = 'id, goal_id, input_hash, text_cipher, due_date, status, created_at, resolved_at';

export class SqliteGoalTaskSuggestionRepository {
  private readonly database: DatabaseSync;
  private readonly ownsDatabase: boolean;
  private readonly sealedText: SealedText;

  /** Своё соединение по пути к базе или (выгрузка данных) чужое соединение хранилища. */
  constructor(options: DatabaseSync | { databasePath: string; encryptionKey: Buffer }, key?: Buffer) {
    this.ownsDatabase = !(options instanceof DatabaseSync);
    this.database = options instanceof DatabaseSync ? options : new DatabaseSync(options.databasePath);
    const encryptionKey = options instanceof DatabaseSync ? key : options.encryptionKey;
    if (!encryptionKey) throw new Error('goal_task_suggestion_encryption_key_missing');
    this.sealedText = new SealedText(encryptionKey);
    try {
      if (this.ownsDatabase) {
        applySqliteBusyTimeout(this.database, SQLITE_HTTP_BUSY_TIMEOUT_MS);
        this.database.exec('PRAGMA journal_mode = WAL;');
      }
      this.database.exec(GOAL_TASK_SUGGESTION_SCHEMA);
    } catch (error) {
      this.close();
      throw error;
    }
  }

  close(): void {
    if (this.ownsDatabase) this.database.close();
  }

  find(candidateId: string, goalId: string, inputHash: string): GoalTaskSuggestionRecord | null {
    const row = this.database
      .prepare(
        `SELECT ${COLUMNS} FROM career_diary_task_suggestions
         WHERE candidate_id = ? AND goal_id = ? AND input_hash = ?`,
      )
      .get(candidateId, goalId, inputHash) as Row | undefined;
    return row ? this.toRecord(candidateId, row) : null;
  }

  /**
   * Записывает ответ модели для входа. Параллельный запрос мог успеть раньше: тогда остаётся его
   * строка и она же возвращается. Без текста строка сразу закрыта.
   */
  create(
    candidateId: string,
    goalId: string,
    inputHash: string,
    answer: { readonly text: string; readonly dueDate: string | null } | null,
    now = new Date().toISOString(),
  ): GoalTaskSuggestionRecord {
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT OR IGNORE INTO career_diary_task_suggestions
           (candidate_id, id, goal_id, input_hash, text_cipher, due_date, status, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        candidateId,
        id,
        goalId,
        inputHash,
        answer ? sealPayload(this.sealedText, candidateId, TEXT, id, answer.text) : null,
        answer?.dueDate ?? null,
        answer ? 'open' : 'skipped',
        now,
        answer ? null : now,
      );
    this.prune(candidateId, goalId);
    return this.find(candidateId, goalId, inputHash)!;
  }

  /**
   * Отмечает ответ кандидата у открытой подсказки цели. `false` — такой подсказки у кандидата
   * по этой цели нет. Повторный ответ ничего не меняет.
   */
  resolve(
    candidateId: string,
    goalId: string,
    id: string,
    status: 'added' | 'skipped',
    now = new Date().toISOString(),
  ): boolean {
    this.database
      .prepare(
        `UPDATE career_diary_task_suggestions SET status = ?, resolved_at = ?
         WHERE candidate_id = ? AND goal_id = ? AND id = ? AND status = 'open'`,
      )
      .run(status, now, candidateId, goalId, id);
    const found = this.database
      .prepare('SELECT 1 AS found FROM career_diary_task_suggestions WHERE candidate_id = ? AND goal_id = ? AND id = ?')
      .get(candidateId, goalId, id);
    return found !== undefined;
  }

  /** Тексты последних пропущенных подсказок цели: модели их не повторять. */
  skippedTexts(candidateId: string, goalId: string): string[] {
    const rows = this.database
      .prepare(
        `SELECT ${COLUMNS} FROM career_diary_task_suggestions
         WHERE candidate_id = ? AND goal_id = ? AND status = 'skipped' AND text_cipher IS NOT NULL
         ORDER BY resolved_at DESC LIMIT ?`,
      )
      .all(candidateId, goalId, SKIPPED_FOR_DEDUPE) as unknown as Row[];
    return rows.flatMap((row) => this.toRecord(candidateId, row).text ?? []);
  }

  /** Все подсказки кандидата — для выгрузки данных. */
  exportAll(candidateId: string): GoalTaskSuggestionRecord[] {
    const rows = this.database
      .prepare(
        `SELECT ${COLUMNS} FROM career_diary_task_suggestions
         WHERE candidate_id = ? ORDER BY created_at, id`,
      )
      .all(candidateId) as unknown as Row[];
    return rows.map((row) => this.toRecord(candidateId, row));
  }

  /**
   * Записывает вызов модели, если с `since` их меньше `limit`: считаются и неудачные.
   * Проверка и запись — одна транзакция. `false` — предел исчерпан.
   */
  takeAttempt(candidateId: string, since: string, limit: number, now = new Date().toISOString()): boolean {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const row = this.database
        .prepare(
          'SELECT COUNT(*) AS total FROM career_diary_task_suggestion_attempts WHERE candidate_id = ? AND created_at >= ?',
        )
        .get(candidateId, since) as { total: number };
      const allowed = Number(row.total) < limit;
      if (allowed) {
        this.database
          .prepare('INSERT INTO career_diary_task_suggestion_attempts (candidate_id, created_at) VALUES (?, ?)')
          .run(candidateId, now);
      }
      this.database
        .prepare('DELETE FROM career_diary_task_suggestion_attempts WHERE candidate_id = ? AND created_at < ?')
        .run(candidateId, since);
      this.database.exec('COMMIT');
      return allowed;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private prune(candidateId: string, goalId: string): void {
    this.database
      .prepare(
        `DELETE FROM career_diary_task_suggestions WHERE candidate_id = ? AND goal_id = ? AND id NOT IN (
           SELECT id FROM career_diary_task_suggestions WHERE candidate_id = ? AND goal_id = ?
           ORDER BY created_at DESC, id DESC LIMIT ?)`,
      )
      .run(candidateId, goalId, candidateId, goalId, KEEP_PER_GOAL);
  }

  private toRecord(candidateId: string, row: Row): GoalTaskSuggestionRecord {
    return {
      id: row.id,
      goalId: row.goal_id,
      inputHash: row.input_hash,
      text: row.text_cipher
        ? openPayload<string>(this.sealedText, candidateId, TEXT, row.id, row.text_cipher)
        : null,
      dueDate: row.due_date,
      status: row.status,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    };
  }
}
