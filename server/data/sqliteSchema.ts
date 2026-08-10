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

export const MIGRATION_2 = `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('candidate', 'admin')),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  candidate_id TEXT UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
  is_test INTEGER NOT NULL CHECK (is_test IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (role = 'candidate' AND candidate_id IS NOT NULL) OR
    (role = 'admin' AND candidate_id IS NULL)
  )
) STRICT;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
) STRICT;

CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
`;

export const MIGRATION_3 = `
ALTER TABLE memory
  ADD COLUMN domain TEXT NOT NULL DEFAULT 'other'
  CHECK (
    domain IN (
      'responsibility', 'outcome', 'skill', 'preference', 'constraint',
      'gap', 'role-evidence', 'other'
    )
  );
`;

export const MIGRATION_4 = `
CREATE TABLE assessments (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  assessment_id TEXT NOT NULL CHECK (
    assessment_id IN ('work-preferences-v1', 'product-case-v1')
  ),
  submission_cipher TEXT NOT NULL,
  result_cipher TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, assessment_id)
) STRICT;
`;

export const MIGRATION_5 = `
CREATE TABLE market_profiles (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  country TEXT NOT NULL CHECK (country = 'DE'),
  submission_cipher TEXT NOT NULL,
  result_cipher TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, country)
) STRICT;
`;

export const MIGRATION_6 = `
CREATE TABLE oauth_authorizations (
  state_digest TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('linkedin', 'hh')),
  code_verifier_cipher TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX oauth_authorizations_candidate
  ON oauth_authorizations(candidate_id, platform, expires_at);

CREATE TABLE oauth_connections (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('linkedin', 'hh')),
  connection_cipher TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, platform)
) STRICT;
`;
