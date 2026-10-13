export const MIGRATION_41 = `
CREATE TABLE IF NOT EXISTS executive_requests (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  idempotency_digest TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  request_cipher TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('submitted', 'waitlisted', 'in_review', 'accepted', 'declined', 'completed')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(candidate_id, idempotency_digest)
) STRICT;

CREATE INDEX IF NOT EXISTS executive_requests_queue
  ON executive_requests(status, created_at, id);

CREATE INDEX IF NOT EXISTS executive_requests_candidate_page
  ON executive_requests(candidate_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS executive_requests_created
  ON executive_requests(created_at DESC, id DESC);
`;
