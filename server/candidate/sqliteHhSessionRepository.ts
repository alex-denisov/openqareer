import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  HH_LATE_SENT_MS,
  type HhConsent,
  HH_WINDOW_LEFT_OPEN_FAILURES,
  type HhApplyOutcome,
  type HhResumeSnapshot,
} from '../../shared/hhCandidateSession';
import { SealedText } from '../data/sealedText';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';

/**
 * B704: что прочитано в сессии кандидата hh.ru и какие отклики ушли от его имени.
 * Только новые таблицы. Резюме — персональные данные, хранятся запечатанными; в учёте
 * откликов — номера вакансии и резюме, исход и время.
 */
export const HH_SESSION_SCHEMA = `
CREATE TABLE IF NOT EXISTS hh_resume_snapshots (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  snapshot_cipher TEXT NOT NULL,
  read_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS hh_apply_attempts (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  vacancy_id TEXT NOT NULL,
  resume_id TEXT NOT NULL,
  outcome TEXT,
  failure_code TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS hh_apply_attempts_candidate
  ON hh_apply_attempts (candidate_id, started_at);
CREATE TABLE IF NOT EXISTS hh_apply_consents (
  attempt_id TEXT NOT NULL REFERENCES hh_apply_attempts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  host TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  policy_url TEXT,
  basis TEXT NOT NULL,
  given_at TEXT NOT NULL,
  PRIMARY KEY (attempt_id, position)
) STRICT;
CREATE INDEX IF NOT EXISTS hh_apply_consents_candidate
  ON hh_apply_consents (candidate_id, given_at);
`;

/** Отклик без исхода дольше этого считается брошенным: приложение закрыли посреди отклика. */
export const HH_ATTEMPT_STALE_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface HhAttemptRow {
  readonly id: string;
  readonly vacancyId: string;
  readonly resumeId: string;
  readonly outcome: HhApplyOutcome | null;
  readonly failureCode: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

interface AttemptRow {
  id: string;
  vacancy_id: string;
  resume_id: string;
  outcome: string | null;
  failure_code: string | null;
  started_at: string;
  finished_at: string | null;
}

function toAttempt(row: AttemptRow): HhAttemptRow {
  return {
    id: row.id,
    vacancyId: row.vacancy_id,
    resumeId: row.resume_id,
    outcome: (row.outcome as HhApplyOutcome | null) ?? null,
    failureCode: row.failure_code ?? null,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? null,
  };
}

/** Связанные данные снимка резюме hh.ru; выгрузка открывает снимок тем же ключом (B738 · 8). */
export function hhResumeSnapshotScope(candidateId: string): string {
  return `hh-resumes:${candidateId}`;
}

export class SqliteHhSessionRepository {
  private readonly database: DatabaseSync;
  private readonly sealedText: SealedText;

  constructor(options: { databasePath: string; encryptionKey: Buffer }) {
    this.database = new DatabaseSync(options.databasePath);
    this.sealedText = new SealedText(options.encryptionKey);
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    applySqliteBusyTimeout(this.database);
    this.database.exec(HH_SESSION_SCHEMA);
  }

  close(): void {
    this.database.close();
  }

  private scope(candidateId: string): string {
    return hhResumeSnapshotScope(candidateId);
  }

  getSnapshot(candidateId: string): HhResumeSnapshot | null {
    const row = this.database
      .prepare('SELECT snapshot_cipher FROM hh_resume_snapshots WHERE candidate_id = ?')
      .get(candidateId) as { snapshot_cipher: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(this.sealedText.open(row.snapshot_cipher, this.scope(candidateId))) as HhResumeSnapshot;
    } catch {
      // Повреждённый снимок равен отсутствию: кандидат прочитает резюме заново.
      return null;
    }
  }

  saveSnapshot(candidateId: string, snapshot: HhResumeSnapshot): void {
    this.database
      .prepare(
        `INSERT INTO hh_resume_snapshots (candidate_id, snapshot_cipher, read_at) VALUES (?, ?, ?)
         ON CONFLICT(candidate_id) DO UPDATE SET snapshot_cipher = excluded.snapshot_cipher, read_at = excluded.read_at`,
      )
      .run(candidateId, this.sealedText.seal(JSON.stringify(snapshot), this.scope(candidateId)), snapshot.readAt);
  }

  /** Отклики кандидата за последние сутки, новые первыми. */
  recentAttempts(candidateId: string, now: Date): readonly HhAttemptRow[] {
    const since = new Date(now.getTime() - DAY_MS).toISOString();
    return (
      this.database
        .prepare(
          `SELECT id, vacancy_id, resume_id, outcome, failure_code, started_at, finished_at FROM hh_apply_attempts
           WHERE candidate_id = ? AND started_at >= ? ORDER BY started_at DESC`,
        )
        .all(candidateId, since) as unknown as AttemptRow[]
    ).map(toAttempt);
  }

  /** Отклики кандидата на эту вакансию за всё время. */
  attemptsFor(candidateId: string, vacancyId: string): readonly HhAttemptRow[] {
    return (
      this.database
        .prepare(
          `SELECT id, vacancy_id, resume_id, outcome, failure_code, started_at, finished_at FROM hh_apply_attempts
           WHERE candidate_id = ? AND vacancy_id = ? ORDER BY started_at DESC`,
        )
        .all(candidateId, vacancyId) as unknown as AttemptRow[]
    ).map(toAttempt);
  }

  startAttempt(candidateId: string, input: { vacancyId: string; resumeId: string; now: Date }): string {
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO hh_apply_attempts (id, candidate_id, vacancy_id, resume_id, started_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, candidateId, input.vacancyId, input.resumeId, input.now.toISOString());
    return id;
  }

  getAttempt(candidateId: string, attemptId: string): HhAttemptRow | null {
    const row = this.database
      .prepare(
        `SELECT id, vacancy_id, resume_id, outcome, failure_code, started_at, finished_at FROM hh_apply_attempts
         WHERE candidate_id = ? AND id = ?`,
      )
      .get(candidateId, attemptId) as unknown as AttemptRow | undefined;
    return row ? toAttempt(row) : null;
  }

  /** Исход записывается один раз: повторная запись не меняет уже записанный. */
  finishAttempt(
    candidateId: string,
    attemptId: string,
    input: { outcome: HhApplyOutcome; failureCode: string | null; now: Date },
  ): boolean {
    const result = this.database
      .prepare(
        `UPDATE hh_apply_attempts SET outcome = ?, failure_code = ?, finished_at = ?
         WHERE candidate_id = ? AND id = ? AND outcome IS NULL`,
      )
      .run(input.outcome, input.failureCode, input.now.toISOString(), candidateId, attemptId);
    return Number(result.changes) === 1;
  }

  /** B787: какие галочки согласия поставлены при отклике; `basis` — версия поручения или ответ кандидата. */
  recordConsents(
    candidateId: string,
    attemptId: string,
    input: { readonly consents: readonly HhConsent[]; readonly basis: string; readonly now: Date },
  ): void {
    const insert = this.database.prepare(
      `INSERT OR IGNORE INTO hh_apply_consents
         (attempt_id, position, candidate_id, host, consent_text, policy_url, basis, given_at)
       VALUES (?, ?, ?, 'hh.ru', ?, ?, ?, ?)`,
    );
    input.consents.forEach((consent, position) =>
      insert.run(attemptId, position, candidateId, consent.text, consent.url ?? null, input.basis, input.now.toISOString()),
    );
  }

  /**
   * B708: кандидат завершил отклик в том же окне hh.ru после неуспешной попытки. Код сбоя
   * остаётся: на нём держится пауза площадки после проверки.
   */
  markSentLater(candidateId: string, attemptId: string, input: { vacancyId: string; now: Date }): boolean {
    const since = new Date(input.now.getTime() - HH_LATE_SENT_MS).toISOString();
    const codes = HH_WINDOW_LEFT_OPEN_FAILURES.map(() => '?').join(', ');
    const result = this.database
      .prepare(
        `UPDATE hh_apply_attempts SET outcome = 'sent', finished_at = ?
         WHERE candidate_id = ? AND id = ? AND vacancy_id = ? AND outcome = 'failed'
           AND finished_at >= ? AND failure_code IN (${codes})`,
      )
      .run(
        input.now.toISOString(),
        candidateId,
        attemptId,
        input.vacancyId,
        since,
        ...HH_WINDOW_LEFT_OPEN_FAILURES,
      );
    return Number(result.changes) === 1;
  }
}
