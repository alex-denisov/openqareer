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
