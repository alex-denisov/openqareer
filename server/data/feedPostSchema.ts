/** B396: посты ленты, принесённые кандидатом; сам пост хранится только как короткая выдержка. */
export const FEED_POST_TABLES = `
CREATE TABLE IF NOT EXISTS candidate_feed_posts (
  draft_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  post_url TEXT,
  excerpt TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS candidate_feed_posts_candidate_created
  ON candidate_feed_posts(candidate_id, created_at);
`;
