import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from './sqliteBusyTimeout';
import {
  addRecordingSourceColumns,
  MIGRATION_INTERVIEW_DEBRIEFS,
  MIGRATION_INTERVIEW_RECORDINGS,
} from './interviewRecordingSchema';

/** `upload` — загруженный файл (B751): одна дорожка, голоса не разделены. */
export type RecordingTrack = 'mic' | 'system' | 'upload';
export type RecordingSource = 'app' | 'upload';
export type SegmentStatus = 'pending' | 'done' | 'failed';

export interface StoredRecording {
  readonly id: string;
  readonly candidateId: string;
  readonly applicationId: string;
  readonly interviewId: string;
  readonly tokenHash: string;
  readonly tokenExpiresAt: string;
  readonly finishedAt: string | null;
  readonly source: RecordingSource;
  readonly createdAt: string;
}

export interface StoredSegment {
  readonly track: RecordingTrack;
  readonly segment: number;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly status: SegmentStatus;
  readonly textCipher: string | null;
}

export interface NewRecording {
  readonly candidateId: string;
  readonly applicationId: string;
  readonly interviewId: string;
  readonly tokenHash: string;
  readonly tokenExpiresAt: string;
  readonly source?: RecordingSource;
}

/** B751: разбор модели по одной расшифровке; `failed` — модель не ответила или ответ отклонён. */
export interface StoredDebriefAnalysis {
  readonly status: 'ready' | 'failed';
  readonly findingsCipher: string | null;
  readonly answeredBy: string | null;
}

export interface NewSegment {
  readonly recordingId: string;
  readonly track: RecordingTrack;
  readonly segment: number;
  readonly startedAt: string;
  readonly durationMs: number;
}

interface RecordingRow {
  id: string;
  candidate_id: string;
  application_id: string;
  interview_id: string;
  token_hash: string;
  token_expires_at: string;
  finished_at: string | null;
  source: RecordingSource;
  created_at: string;
}

interface SegmentRow {
  track: RecordingTrack;
  segment: number;
  started_at: string;
  duration_ms: number;
  status: SegmentStatus;
  text_cipher: string | null;
}

function toRecording(row: RecordingRow): StoredRecording {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    applicationId: row.application_id,
    interviewId: row.interview_id,
    tokenHash: row.token_hash,
    tokenExpiresAt: row.token_expires_at,
    finishedAt: row.finished_at,
    source: row.source,
    createdAt: row.created_at,
  };
}

/** Записи собеседований (B642): токен только хешем, текст сегментов запечатан, аудио здесь нет. */
export class SqliteInterviewRecordingRepository {
  private readonly database: DatabaseSync;

  constructor(options: { readonly databasePath: string }) {
    this.database = new DatabaseSync(options.databasePath, {
      timeout: 5_000,
      enableForeignKeyConstraints: true,
      defensive: true,
    });
    if (options.databasePath !== ':memory:') this.database.exec('PRAGMA journal_mode = WAL;');
    applySqliteBusyTimeout(this.database);
    this.database.exec(MIGRATION_INTERVIEW_RECORDINGS);
    addRecordingSourceColumns(this.database);
    this.database.exec(MIGRATION_INTERVIEW_DEBRIEFS);
  }

  /** Интервью принадлежит кандидату через его отклик (таблицы трекера в той же базе). */
  interviewBelongsTo(candidateId: string, applicationId: string, interviewId: string): boolean {
    const row = this.database
      .prepare(
        `SELECT 1 AS found FROM application_interviews i
         JOIN applications a ON a.id = i.application_id
         WHERE i.id = ? AND i.application_id = ? AND a.candidate_id = ?`,
      )
      .get(interviewId, applicationId, candidateId);
    return row !== undefined;
  }

  create(input: NewRecording, now = new Date().toISOString()): string {
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO interview_recordings
           (id, candidate_id, application_id, interview_id, token_hash, token_expires_at, status, created_at, source)
         VALUES (?, ?, ?, ?, ?, ?, 'recording', ?, ?)`,
      )
      .run(
        id,
        input.candidateId,
        input.applicationId,
        input.interviewId,
        input.tokenHash,
        input.tokenExpiresAt,
        now,
        input.source ?? 'app',
      );
    return id;
  }

  getById(id: string): StoredRecording | null {
    const row = this.database
      .prepare('SELECT * FROM interview_recordings WHERE id = ?')
      .get(id) as RecordingRow | undefined;
    return row ? toRecording(row) : null;
  }

  getOwned(candidateId: string, id: string): StoredRecording | null {
    const found = this.getById(id);
    return found && found.candidateId === candidateId ? found : null;
  }

  /** B751: последняя запись интервью кандидата — по ней строится разбор. */
  latestForInterview(candidateId: string, interviewId: string): StoredRecording | null {
    const row = this.database
      .prepare(
        `SELECT * FROM interview_recordings WHERE candidate_id = ? AND interview_id = ?
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(candidateId, interviewId) as RecordingRow | undefined;
    return row ? toRecording(row) : null;
  }

  interviewerCipher(candidateId: string, interviewId: string): string | null {
    const row = this.database
      .prepare('SELECT name_cipher FROM interview_interviewers WHERE candidate_id = ? AND interview_id = ?')
      .get(candidateId, interviewId) as { name_cipher: string } | undefined;
    return row?.name_cipher ?? null;
  }

  /** `null` — имя стёрто. */
  setInterviewerCipher(
    candidateId: string,
    interviewId: string,
    nameCipher: string | null,
    now = new Date().toISOString(),
  ): void {
    if (nameCipher === null) {
      this.database
        .prepare('DELETE FROM interview_interviewers WHERE candidate_id = ? AND interview_id = ?')
        .run(candidateId, interviewId);
      return;
    }
    this.database
      .prepare(
        `INSERT INTO interview_interviewers (interview_id, candidate_id, name_cipher, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (interview_id) DO UPDATE SET name_cipher = excluded.name_cipher,
           updated_at = excluded.updated_at
         WHERE interview_interviewers.candidate_id = excluded.candidate_id`,
      )
      .run(interviewId, candidateId, nameCipher, now);
  }

  getAnalysis(recordingId: string, transcriptHash: string): StoredDebriefAnalysis | null {
    const row = this.database
      .prepare(
        `SELECT status, findings_cipher, answered_by FROM interview_debrief_analyses
         WHERE recording_id = ? AND transcript_hash = ?`,
      )
      .get(recordingId, transcriptHash) as
      | { status: 'ready' | 'failed'; findings_cipher: string | null; answered_by: string | null }
      | undefined;
    return row
      ? { status: row.status, findingsCipher: row.findings_cipher, answeredBy: row.answered_by }
      : null;
  }

  /** Готовый разбор не затирается сбоем: повтор модели только по `failed` или пустому. */
  saveAnalysis(
    recordingId: string,
    transcriptHash: string,
    analysis: StoredDebriefAnalysis,
    now = new Date().toISOString(),
  ): void {
    this.database
      .prepare(
        `INSERT INTO interview_debrief_analyses
           (recording_id, transcript_hash, status, findings_cipher, answered_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (recording_id, transcript_hash) DO UPDATE SET
           status = excluded.status, findings_cipher = excluded.findings_cipher,
           answered_by = excluded.answered_by, created_at = excluded.created_at
         WHERE interview_debrief_analyses.status <> 'ready'`,
      )
      .run(
        recordingId,
        transcriptHash,
        analysis.status,
        analysis.findingsCipher,
        analysis.answeredBy,
        now,
      );
  }

  /** Новый сегмент; false — такой (дорожка, номер) уже принят. */
  insertSegmentIfNew(input: NewSegment, now = new Date().toISOString()): boolean {
    const result = this.database
      .prepare(
        // Ключ проверен до чтения тела; за это время запись могли закончить или удалить.
        `INSERT OR IGNORE INTO interview_recording_segments
           (recording_id, track, segment, started_at, duration_ms, status, updated_at)
         SELECT ?, ?, ?, ?, ?, 'pending', ?
         WHERE EXISTS (SELECT 1 FROM interview_recordings WHERE id = ? AND finished_at IS NULL)`,
      )
      .run(
        input.recordingId,
        input.track,
        input.segment,
        input.startedAt,
        input.durationMs,
        now,
        input.recordingId,
      );
    return Number(result.changes) > 0;
  }

  completeSegment(
    segment: { recordingId: string; track: RecordingTrack; segment: number },
    outcome: { textCipher: string } | { errorCode: string },
    now = new Date().toISOString(),
  ): void {
    const done = 'textCipher' in outcome;
    this.database
      .prepare(
        `UPDATE interview_recording_segments
         SET status = ?, text_cipher = ?, error_code = ?, updated_at = ?
         WHERE recording_id = ? AND track = ? AND segment = ?`,
      )
      .run(
        done ? 'done' : 'failed',
        done ? outcome.textCipher : null,
        done ? null : outcome.errorCode,
        now,
        segment.recordingId,
        segment.track,
        segment.segment,
      );
  }

  listSegments(recordingId: string): StoredSegment[] {
    const rows = this.database
      .prepare(
        `SELECT track, segment, started_at, duration_ms, status, text_cipher
         FROM interview_recording_segments WHERE recording_id = ?
         ORDER BY track, segment`,
      )
      .all(recordingId) as unknown as SegmentRow[];
    return rows.map((row) => ({
      track: row.track,
      segment: row.segment,
      startedAt: row.started_at,
      durationMs: row.duration_ms,
      status: row.status,
      textCipher: row.text_cipher,
    }));
  }

  finish(id: string, expected: number, failed: number, now = new Date().toISOString()): void {
    this.database
      .prepare(
        `UPDATE interview_recordings
         SET status = 'finished', finished_at = COALESCE(finished_at, ?),
             expected_segments = ?, reported_failed = ?
         WHERE id = ?`,
      )
      .run(now, expected, failed, id);
  }

  deleteRecording(id: string): void {
    this.database.prepare('DELETE FROM interview_debrief_analyses WHERE recording_id = ?').run(id);
    this.database.prepare('DELETE FROM interview_recording_segments WHERE recording_id = ?').run(id);
    this.database.prepare('DELETE FROM interview_recordings WHERE id = ?').run(id);
  }

  deleteByInterview(candidateId: string, interviewId: string): number {
    const rows = this.database
      .prepare('SELECT id FROM interview_recordings WHERE candidate_id = ? AND interview_id = ?')
      .all(candidateId, interviewId) as unknown as Array<{ id: string }>;
    for (const row of rows) this.deleteRecording(row.id);
    this.setInterviewerCipher(candidateId, interviewId, null);
    return rows.length;
  }

  /**
   * Аудио жило только в памяти процесса: сегмент, ждущий дольше окна, уже не доделать.
   * Свежие не трогаем — при выкате их ещё расшифровывает прежний процесс.
   */
  failInterrupted(staleBefore: string, now = new Date().toISOString()): number {
    const result = this.database
      .prepare(
        `UPDATE interview_recording_segments
         SET status = 'failed', error_code = 'interrupted', updated_at = ?
         WHERE status = 'pending' AND updated_at < ?`,
      )
      .run(now, staleBefore);
    return Number(result.changes);
  }

  close(): void {
    this.database.close();
  }
}
