export const MIGRATION_1 = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE candidates (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  data_class TEXT NOT NULL CHECK (data_class IN ('synthetic', 'personal')),
  locale TEXT NOT NULL CHECK (locale IN ('ru-RU', 'en-US')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE messages (
  id TEXT NOT NULL,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  body_cipher TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, id)
) STRICT;

CREATE INDEX messages_conversation_created
  ON messages(conversation_id, created_at, id);

CREATE TABLE turns (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_message_id TEXT NOT NULL,
  assistant_message_id TEXT,
  phase TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'failed', 'completed')),
  result_cipher TEXT,
  provider TEXT,
  model TEXT,
  response_id TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, idempotency_key)
) STRICT;

CREATE TABLE memory (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  statement_cipher TEXT NOT NULL,
  confidence TEXT NOT NULL,
  source_message_ids TEXT NOT NULL,
  sensitive INTEGER NOT NULL CHECK (sensitive IN (0, 1)),
  status TEXT NOT NULL CHECK (
    status IN ('proposed', 'confirmed', 'corrected', 'deleted')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX memory_candidate_status ON memory(candidate_id, status);

CREATE TABLE memory_revisions (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('confirm', 'correct', 'delete')),
  previous_digest TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
`;
