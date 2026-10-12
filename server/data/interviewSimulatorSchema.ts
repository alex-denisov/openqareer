export const MIGRATION_49 = `
CREATE TABLE IF NOT EXISTS candidate_interview_sessions (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  body_cipher TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'interrupted', 'completed')),
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_candidate_interview_sessions_status
  ON candidate_interview_sessions(candidate_id, status, updated_at DESC);
`;

export function interviewSessionAssociatedData(
  candidateId: string,
  sessionId: string,
  version: number,
  status: string,
): string {
  return `candidate:${candidateId}:interview-session:${sessionId}:v${version}:${status}`;
}
