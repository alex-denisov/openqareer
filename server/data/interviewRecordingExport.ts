import type { DatabaseSync } from 'node:sqlite';
import { findingsData, interviewerData } from '../recordings/interviewDebriefService';
import { assembleTranscript } from '../recordings/recordingView';
import { tableExists } from './exportTableReader';
import { SealedText } from './sealedText';
import type { StoredSegment } from './sqliteInterviewRecordingRepository';

/**
 * B738 · 9: записи интервью — по каждой статус, расшифровка обеих дорожек и разбор; имя собеседника.
 * Аудио после расшифровки не хранится (B642). Не выгружаются токен загрузки, его срок, хеш
 * расшифровки и модель, которая писала разбор.
 */
export interface InterviewRecordingSources {
  readonly database: DatabaseSync;
  readonly encryptionKey: Buffer;
}

type Row = Record<string, unknown>;

export interface ExportedRecording {
  readonly recordingId: string;
  readonly applicationId: string;
  readonly interviewId: string;
  readonly status: string;
  readonly createdAt: string;
  readonly finishedAt: string | null;
  readonly transcript: ReturnType<typeof assembleTranscript> | null;
  readonly debriefs: readonly { readonly status: string; readonly findings: unknown; readonly createdAt: string }[];
}

export interface InterviewRecordingExport {
  readonly recordings: readonly ExportedRecording[];
  readonly interviewers: readonly { readonly interviewId: string; readonly name: string | null; readonly updatedAt: string }[];
}

function segmentsOf(database: DatabaseSync, recordingId: string): StoredSegment[] {
  if (!tableExists(database, 'interview_recording_segments')) return [];
  const rows = database
    .prepare(
      `SELECT track, segment, started_at AS startedAt, duration_ms AS durationMs, status, text_cipher AS textCipher
       FROM interview_recording_segments WHERE recording_id = ? ORDER BY track, segment`,
    )
    .all(recordingId);
  return rows as unknown as StoredSegment[];
}

/** Повреждённая строка не роняет выгрузку: её текст отдаётся как null. */
function opened<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

/**
 * Обычно расшифровка собирается за один проход. Если какой-то сегмент не открывается, он
 * пропускается, а остальная расшифровка остаётся.
 */
function transcriptOf(sealed: SealedText, recordingId: string, segments: StoredSegment[]): ExportedRecording['transcript'] {
  const done = segments.filter((segment) => segment.status === 'done' && segment.textCipher);
  if (done.length === 0) return null;
  const whole = opened(() => assembleTranscript(sealed, recordingId, done));
  if (whole) return whole;
  const readable = done.filter((segment) => opened(() => assembleTranscript(sealed, recordingId, [segment])) !== null);
  return readable.length > 0 ? assembleTranscript(sealed, recordingId, readable) : null;
}

function debriefsOf(database: DatabaseSync, sealed: SealedText, recordingId: string): ExportedRecording['debriefs'] {
  if (!tableExists(database, 'interview_debrief_analyses')) return [];
  const rows = database
    .prepare(
      `SELECT transcript_hash AS hash, status, findings_cipher AS sealed, created_at AS createdAt
       FROM interview_debrief_analyses WHERE recording_id = ? ORDER BY created_at`,
    )
    .all(recordingId) as { hash: string; status: string; sealed: string | null; createdAt: string }[];
  return rows.map(({ hash, status, sealed: cipher, createdAt }) => ({
    status,
    findings: cipher ? opened(() => JSON.parse(sealed.open(cipher, findingsData(recordingId, hash))) as unknown) : null,
    createdAt,
  }));
}

export function exportInterviewRecordings(sources: InterviewRecordingSources, candidateId: string): InterviewRecordingExport {
  const { database } = sources;
  const sealed = new SealedText(sources.encryptionKey);
  const recordings = tableExists(database, 'interview_recordings')
    ? (database
        .prepare(
          `SELECT id, application_id AS applicationId, interview_id AS interviewId, status, created_at AS createdAt,
             finished_at AS finishedAt
           FROM interview_recordings WHERE candidate_id = ? ORDER BY created_at, id`,
        )
        .all(candidateId) as Row[])
    : [];
  const interviewers = tableExists(database, 'interview_interviewers')
    ? (database
        .prepare(
          `SELECT interview_id AS interviewId, name_cipher AS sealed, updated_at AS updatedAt
           FROM interview_interviewers WHERE candidate_id = ? ORDER BY updated_at, interview_id`,
        )
        .all(candidateId) as { interviewId: string; sealed: string; updatedAt: string }[])
    : [];
  return {
    recordings: recordings.map((row) => {
      const recordingId = String(row.id);
      const segments = segmentsOf(database, recordingId);
      return {
        recordingId,
        applicationId: String(row.applicationId),
        interviewId: String(row.interviewId),
        status: String(row.status),
        createdAt: String(row.createdAt),
        finishedAt: typeof row.finishedAt === 'string' ? row.finishedAt : null,
        transcript: transcriptOf(sealed, recordingId, segments),
        debriefs: debriefsOf(database, sealed, recordingId),
      };
    }),
    interviewers: interviewers.map(({ interviewId, sealed: cipher, updatedAt }) => ({
      interviewId,
      name: opened(() => sealed.open(cipher, interviewerData(interviewId))),
      updatedAt,
    })),
  };
}
