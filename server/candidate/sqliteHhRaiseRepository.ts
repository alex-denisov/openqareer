import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { HhRaiseOutcome, HhRaisePauseReason } from '../../shared/b640HhRaise';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';

/** B699: расписание поднятия по резюме и очередь заданий клиенту. Только новые таблицы. */
export const HH_RAISE_SCHEMA = `
CREATE TABLE IF NOT EXISTS hh_raise_schedules (
  candidate_id TEXT NOT NULL,
  resume_id TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  last_raised_at TEXT,
  next_raise_at TEXT,
  last_result TEXT CHECK (last_result IN ('ok', 'error')),
  last_reason TEXT,
  last_result_at TEXT,
  paused_until TEXT,
  pause_reason TEXT CHECK (pause_reason IN ('captcha', 'logged_out')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, resume_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_hh_raise_schedules_due ON hh_raise_schedules(enabled, next_raise_at);
CREATE TABLE IF NOT EXISTS hh_raise_tasks (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  resume_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done')),
  queued_at TEXT NOT NULL,
  claimed_at TEXT,
  finished_at TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_hh_raise_tasks_open ON hh_raise_tasks(candidate_id, status);
CREATE TABLE IF NOT EXISTS hh_raise_choices (
  candidate_id TEXT PRIMARY KEY,
  resume_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
`;

export interface HhRaiseScheduleRow {
  readonly candidateId: string;
  readonly resumeId: string;
  readonly enabled: boolean;
  readonly lastRaisedAt: string | null;
  readonly nextRaiseAt: string | null;
  readonly lastResult: 'ok' | 'error' | null;
  readonly lastReason: string | null;
  readonly lastResultAt: string | null;
  readonly pausedUntil: string | null;
  readonly pauseReason: HhRaisePauseReason | null;
}

export type HhRaiseSchedulePatch = Partial<Omit<HhRaiseScheduleRow, 'candidateId' | 'resumeId'>>;

export interface HhRaiseTask {
  readonly id: string;
  readonly candidateId: string;
  readonly resumeId: string;
  readonly status: 'queued' | 'running' | 'done';
}

interface ScheduleDb {
  candidate_id: string; resume_id: string; enabled: number; last_raised_at: string | null;
  next_raise_at: string | null; last_result: 'ok' | 'error' | null; last_reason: string | null;
  last_result_at: string | null; paused_until: string | null; pause_reason: HhRaisePauseReason | null;
}

const toRow = (r: ScheduleDb): HhRaiseScheduleRow => ({
  candidateId: r.candidate_id, resumeId: r.resume_id, enabled: r.enabled === 1,
  lastRaisedAt: r.last_raised_at, nextRaiseAt: r.next_raise_at, lastResult: r.last_result,
  lastReason: r.last_reason, lastResultAt: r.last_result_at, pausedUntil: r.paused_until, pauseReason: r.pause_reason,
});

export class SqliteHhRaiseRepository {
  private readonly database: DatabaseSync;

  constructor(options: { databasePath: string }) {
    this.database = new DatabaseSync(options.databasePath);
    this.database.exec('PRAGMA journal_mode = WAL;');
    applySqliteBusyTimeout(this.database);
    this.database.exec(HH_RAISE_SCHEMA);
    this.ensureOutcomeColumn();
  }

  private ensureOutcomeColumn(): void {
    const known = () =>
      (this.database.prepare('PRAGMA table_info(hh_raise_tasks)').all() as unknown as { name: string }[]).some(
        ({ name }) => name === 'outcome',
      );
    if (known()) return;
    try {
      this.database.exec('ALTER TABLE hh_raise_tasks ADD COLUMN outcome TEXT');
    } catch (error) {
      // Соседний процесс мог добавить столбец первым.
      if (!known()) throw error;
    }
  }

  /** Окончания удачных поднятий с `since`. Прежние задания исхода не хранили: взятое и закрытое — поднятие. */
  raisedAt(candidateId: string, since: string): string[] {
    const rows = this.database
      .prepare(`SELECT finished_at FROM hh_raise_tasks WHERE candidate_id = ? AND status = 'done'
                AND claimed_at IS NOT NULL AND finished_at >= ? AND (outcome = 'ok' OR outcome IS NULL)`)
      .all(candidateId, since) as unknown as { finished_at: string }[];
    return rows.map((row) => row.finished_at);
  }

  close(): void {
    this.database.close();
  }

  getSchedule(candidateId: string, resumeId: string): HhRaiseScheduleRow | null {
    const row = this.database
      .prepare('SELECT * FROM hh_raise_schedules WHERE candidate_id = ? AND resume_id = ?')
      .get(candidateId, resumeId) as unknown as ScheduleDb | undefined;
    return row ? toRow(row) : null;
  }

  /** Создаёт строку по умолчанию и применяет изменения; возвращает итог. */
  patchSchedule(candidateId: string, resumeId: string, patch: HhRaiseSchedulePatch, now: string): HhRaiseScheduleRow {
    const base: HhRaiseScheduleRow = this.getSchedule(candidateId, resumeId) ?? {
      candidateId, resumeId, enabled: true, lastRaisedAt: null, nextRaiseAt: now,
      lastResult: null, lastReason: null, lastResultAt: null, pausedUntil: null, pauseReason: null,
    };
    const next = { ...base, ...patch };
    this.database
      .prepare(
        `INSERT OR REPLACE INTO hh_raise_schedules
         (candidate_id, resume_id, enabled, last_raised_at, next_raise_at, last_result, last_reason,
          last_result_at, paused_until, pause_reason, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(candidateId, resumeId, next.enabled ? 1 : 0, next.lastRaisedAt, next.nextRaiseAt, next.lastResult,
        next.lastReason, next.lastResultAt, next.pausedUntil, next.pauseReason, now);
    return next;
  }

  /** Резюме, которое кандидат выбрал для поднятия; `null` — ещё не выбирал. */
  getChoice(candidateId: string): string | null {
    const row = this.database
      .prepare('SELECT resume_id FROM hh_raise_choices WHERE candidate_id = ?')
      .get(candidateId) as { resume_id: string } | undefined;
    return row?.resume_id ?? null;
  }

  /** Выбирает резюме: его расписание меняется, остальные выключаются. Задания выключенных из очереди снимаются. */
  chooseResume(candidateId: string, resumeId: string, patch: HhRaiseSchedulePatch, now: string): HhRaiseScheduleRow {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare('INSERT OR REPLACE INTO hh_raise_choices (candidate_id, resume_id, updated_at) VALUES (?, ?, ?)')
        .run(candidateId, resumeId, now);
      this.database
        .prepare('UPDATE hh_raise_schedules SET enabled = 0, updated_at = ? WHERE candidate_id = ? AND resume_id != ? AND enabled = 1')
        .run(now, candidateId, resumeId);
      this.database
        .prepare(`UPDATE hh_raise_tasks SET status = 'done', finished_at = ?
                  WHERE candidate_id = ? AND status = 'queued' AND (resume_id != ? OR ? = 0)`)
        .run(now, candidateId, resumeId, patch.enabled === false ? 0 : 1);
      const row = this.patchSchedule(candidateId, resumeId, patch, now);
      this.database.exec('COMMIT');
      return row;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  /** Включённые расписания, которым пора в очередь; паузы и открытые задания отсеиваются. */
  listDue(now: string, limit: number): HhRaiseScheduleRow[] {
    const rows = this.database
      .prepare(
        `SELECT s.* FROM hh_raise_schedules s
         WHERE s.enabled = 1 AND s.next_raise_at <= ?
           AND (s.pause_reason IS NULL OR (s.pause_reason = 'captcha' AND s.paused_until <= ?))
           AND NOT EXISTS (SELECT 1 FROM hh_raise_tasks t
             WHERE t.candidate_id = s.candidate_id AND t.resume_id = s.resume_id AND t.status != 'done')
         ORDER BY s.next_raise_at LIMIT ?`,
      )
      .all(now, now, limit) as unknown as ScheduleDb[];
    return rows.map(toRow);
  }

  /**
   * B690: отметки входа hh.ru по расписаниям кандидата: последнее удачное поднятие (вход жив)
   * и упоры в страницу входа после `aliveAfter` — первый и последний.
   */
  loginMarks(candidateId: string, aliveAfter: string | null): { raisedAt: string | null; loggedOutFrom: string | null } {
    const raised = this.database
      .prepare('SELECT MAX(last_raised_at) AS at FROM hh_raise_schedules WHERE candidate_id = ?')
      .get(candidateId) as { at: string | null } | undefined;
    const raisedAt = raised?.at ?? null;
    const alive = [aliveAfter, raisedAt].filter((at): at is string => at !== null).sort().at(-1) ?? '';
    const out = this.database
      .prepare(
        `SELECT MIN(last_result_at) AS at FROM hh_raise_schedules
         WHERE candidate_id = ? AND pause_reason = 'logged_out' AND last_result_at > ?`,
      )
      .get(candidateId, alive) as { at: string | null } | undefined;
    return { raisedAt, loggedOutFrom: out?.at ?? null };
  }

  hasOpenTask(candidateId: string, resumeId: string): boolean {
    return this.database
      .prepare(`SELECT 1 FROM hh_raise_tasks WHERE candidate_id = ? AND resume_id = ? AND status != 'done'`)
      .get(candidateId, resumeId) !== undefined;
  }

  enqueue(candidateId: string, resumeId: string, now: string): string {
    const id = randomUUID();
    this.database
      .prepare(`INSERT INTO hh_raise_tasks (id, candidate_id, resume_id, status, queued_at) VALUES (?, ?, ?, 'queued', ?)`)
      .run(id, candidateId, resumeId, now);
    return id;
  }

  /** Отдаёт клиенту самое раннее задание кандидата (кроме выключенных резюме) и помечает его выполняемым. */
  claim(candidateId: string, now: string): HhRaiseTask | null {
    const row = this.database
      .prepare(`SELECT id, resume_id FROM hh_raise_tasks t WHERE candidate_id = ? AND status = 'queued'
                  AND NOT EXISTS (SELECT 1 FROM hh_raise_schedules s
                    WHERE s.candidate_id = t.candidate_id AND s.resume_id = t.resume_id AND s.enabled = 0)
                ORDER BY queued_at LIMIT 1`)
      .get(candidateId) as { id: string; resume_id: string } | undefined;
    if (!row) return null;
    const changed = this.database
      .prepare(`UPDATE hh_raise_tasks SET status = 'running', claimed_at = ? WHERE id = ? AND status = 'queued'`)
      .run(now, row.id).changes;
    return changed === 1 ? { id: row.id, candidateId, resumeId: row.resume_id, status: 'running' } : null;
  }

  /** Закрывает выполняемое задание кандидата один раз; чужое или закрытое — null. */
  finish(candidateId: string, taskId: string, now: string, outcome: HhRaiseOutcome): HhRaiseTask | null {
    const row = this.database
      .prepare(`SELECT resume_id FROM hh_raise_tasks WHERE id = ? AND candidate_id = ? AND status = 'running'`)
      .get(taskId, candidateId) as { resume_id: string } | undefined;
    if (!row) return null;
    this.database.prepare(`UPDATE hh_raise_tasks SET status = 'done', finished_at = ?, outcome = ? WHERE id = ?`).run(now, outcome, taskId);
    return { id: taskId, candidateId, resumeId: row.resume_id, status: 'done' };
  }

  /**
   * Клиент взял задание и пропал (окно закрыли посреди поднятия): без закрытия резюме
   * больше никогда не попало бы в очередь. Такое задание закрывается без исхода.
   */
  releaseStale(claimedBefore: string, now: string): number {
    return Number(
      this.database
        .prepare(`UPDATE hh_raise_tasks SET status = 'done', finished_at = ?, outcome = 'stale' WHERE status = 'running' AND claimed_at <= ?`)
        .run(now, claimedBefore).changes,
    );
  }
}
