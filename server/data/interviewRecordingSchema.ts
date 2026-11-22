import type { DatabaseSync } from 'node:sqlite';

/** B642: записи собеседований. Аудио не хранится: только тексты сегментов, запечатанные ключом данных. */
export const MIGRATION_INTERVIEW_RECORDINGS = `
CREATE TABLE IF NOT EXISTS interview_recordings (
  id TEXT PRIMARY KEY,
  -- Удаление аккаунта уносит записи и через них сегменты (deleteCandidate, 152-ФЗ).
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL,
  interview_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  token_expires_at TEXT NOT NULL,
  status TEXT NOT NULL,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  expected_segments INTEGER,
  reported_failed INTEGER
);
CREATE INDEX IF NOT EXISTS idx_interview_recordings_interview
  ON interview_recordings (candidate_id, interview_id);
CREATE TABLE IF NOT EXISTS interview_recording_segments (
  recording_id TEXT NOT NULL REFERENCES interview_recordings(id) ON DELETE CASCADE,
  track TEXT NOT NULL,
  segment INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  text_cipher TEXT,
  error_code TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (recording_id, track, segment)
);
`;

/** B751: откуда запись: `app` — две дорожки .app, `upload` — файл без голосов. Колонка к таблице B642. */
export function addRecordingSourceColumns(database: DatabaseSync): void {
  const columns = new Set(
    (database.prepare('PRAGMA table_info(interview_recordings)').all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  if (!columns.has('source')) {
    database.exec("ALTER TABLE interview_recordings ADD COLUMN source TEXT NOT NULL DEFAULT 'app'");
  }
}

/** B751: разбор модели по расшифровке; ключ — хеш расшифровки, текст запечатан. */
export const MIGRATION_INTERVIEW_DEBRIEFS = `
CREATE TABLE IF NOT EXISTS interview_debrief_analyses (
  recording_id TEXT NOT NULL REFERENCES interview_recordings(id) ON DELETE CASCADE,
  transcript_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  findings_cipher TEXT,
  answered_by TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (recording_id, transcript_hash)
);
-- Имя собеседника задаётся и до загрузки файла, поэтому живёт у интервью; запечатано.
CREATE TABLE IF NOT EXISTS interview_interviewers (
  interview_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  name_cipher TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;
