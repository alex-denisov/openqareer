/** B694: ритм и очередь публикаций LinkedIn; новые таблицы, существующие не меняются. */
export const LINKEDIN_QUEUE_TABLES = `
CREATE TABLE IF NOT EXISTS candidate_linkedin_rhythm (
  candidate_id TEXT PRIMARY KEY,
  posts_per_week INTEGER NOT NULL,
  days TEXT NOT NULL,
  time TEXT NOT NULL,
  timezone TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS candidate_linkedin_queue (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  state TEXT NOT NULL,
  published_url TEXT,
  reminded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS candidate_linkedin_queue_candidate_time
  ON candidate_linkedin_queue(candidate_id, scheduled_at);
CREATE UNIQUE INDEX IF NOT EXISTS candidate_linkedin_queue_one_active
  ON candidate_linkedin_queue(candidate_id, draft_id) WHERE state = 'queued';
`;
