/** B436 adds empty conversation/history tables without touching the message table. */
export const MIGRATION_40 = `
CREATE TABLE IF NOT EXISTS consultant_conversations (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('today', 'profile', 'career', 'vacancies', 'responses', 'interviews')),
  opened_at TEXT NOT NULL,
  last_message_at TEXT NOT NULL,
  closed_at TEXT,
  close_reason TEXT CHECK (close_reason IS NULL OR close_reason IN ('stage_changed', 'idle_timeout')),
  message_count INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  first_user_message_id TEXT,
  UNIQUE (candidate_id, id)
) STRICT;

CREATE INDEX IF NOT EXISTS consultant_conversations_candidate_recent
  ON consultant_conversations(candidate_id, closed_at, opened_at DESC, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS consultant_conversation_one_active_per_candidate
  ON consultant_conversations(candidate_id) WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS consultant_conversation_messages (
  candidate_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  stage TEXT NOT NULL CHECK (stage IN ('today', 'profile', 'career', 'vacancies', 'responses', 'interviews')),
  created_at TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  PRIMARY KEY (candidate_id, conversation_id, message_id),
  UNIQUE (candidate_id, message_id),
  FOREIGN KEY (candidate_id, conversation_id)
    REFERENCES consultant_conversations(candidate_id, id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_id, message_id)
    REFERENCES messages(candidate_id, id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS consultant_conversation_messages_order
  ON consultant_conversation_messages(candidate_id, conversation_id, ordinal);

CREATE TABLE IF NOT EXISTS consultant_conversation_turns (
  candidate_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  PRIMARY KEY (candidate_id, idempotency_key),
  FOREIGN KEY (candidate_id, conversation_id)
    REFERENCES consultant_conversations(candidate_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS consultant_summaries (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_count INTEGER NOT NULL CHECK (message_count > 0),
  version INTEGER NOT NULL CHECK (version > 0),
  summary_cipher TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (candidate_id, conversation_id, message_count),
  FOREIGN KEY (candidate_id, conversation_id)
    REFERENCES consultant_conversations(candidate_id, id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS consultant_summaries_candidate_recent
  ON consultant_summaries(candidate_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS consultant_history_backfill (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  completed_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS consultant_summary_claims (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  message_count INTEGER NOT NULL CHECK (message_count > 0),
  claimed_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, conversation_id, message_count),
  FOREIGN KEY (candidate_id, conversation_id)
    REFERENCES consultant_conversations(candidate_id, id) ON DELETE CASCADE
) STRICT;

CREATE VIRTUAL TABLE IF NOT EXISTS consultant_messages_fts USING fts5(
  candidate_id UNINDEXED,
  conversation_id UNINDEXED,
  message_id UNINDEXED,
  tokens,
  tokenize = 'ascii'
);
`;
