import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from './sqliteBusyTimeout';
import { MIGRATION_INTERVIEW_RECORDINGS } from './interviewRecordingSchema';

export type RecordingTrack = 'mic' | 'system';
export type SegmentStatus = 'pending' | 'done' | 'failed';

export interface StoredRecording {
  readonly id: string;
  readonly candidateId: string;
  readonly applicationId: string;
  readonly interviewId: string;
  readonly tokenHash: string;
  readonly tokenExpiresAt: string;
  readonly finishedAt: string | null;
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
           (id, candidate_id, application_id, interview_id, token_hash, token_expires_at, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'recording', ?)`,
      )
      .run(id, input.candidateId, input.applicationId, input.interviewId, input.tokenHash, input.tokenExpiresAt, now);
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
    this.database.prepare('DELETE FROM interview_recording_segments WHERE recording_id = ?').run(id);
    this.database.prepare('DELETE FROM interview_recordings WHERE id = ?').run(id);
  }

  deleteByInterview(candidateId: string, interviewId: string): number {
    const rows = this.database
      .prepare('SELECT id FROM interview_recordings WHERE candidate_id = ? AND interview_id = ?')
      .all(candidateId, interviewId) as unknown as Array<{ id: string }>;
    for (const row of rows) this.deleteRecording(row.id);
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
