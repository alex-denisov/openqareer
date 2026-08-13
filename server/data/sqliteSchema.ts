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

export const MIGRATION_7 = `
ALTER TABLE turns ADD COLUMN request_digest TEXT;
`;

export const MIGRATION_8 = `
CREATE TABLE career_commands (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  command_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'awaiting_approval', 'prepared', 'queued', 'executing',
      'completed_with_receipt', 'paused', 'failed', 'native_handoff'
    )
  ),
  command_cipher TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, command_id)
) STRICT;

CREATE TABLE career_command_approvals (
  approval_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  command_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (candidate_id, command_id)
    REFERENCES career_commands(candidate_id, command_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE career_command_outbox (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  command_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'delivered')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, command_id),
  FOREIGN KEY (candidate_id, command_id)
    REFERENCES career_commands(candidate_id, command_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX career_command_outbox_pending
  ON career_command_outbox(status, created_at);
`;

export const MIGRATION_9 = `
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN headline TEXT;
ALTER TABLE users ADD COLUMN location TEXT;
ALTER TABLE users ADD COLUMN work_mode TEXT CHECK (
  work_mode IS NULL OR work_mode IN ('office', 'hybrid', 'remote', 'flexible')
);
ALTER TABLE users ADD COLUMN profile_updated_at TEXT;

CREATE UNIQUE INDEX users_email_unique
  ON users(email) WHERE email IS NOT NULL;
`;

export const MIGRATION_10 = `
CREATE TABLE password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX password_reset_tokens_user
  ON password_reset_tokens(user_id, expires_at);
`;

export const MIGRATION_11 = `
CREATE TABLE candidate_documents (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  family_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  kind TEXT NOT NULL CHECK (
    kind IN (
      'resume', 'cover_letter', 'certificate', 'portfolio',
      'profile_export', 'other'
    )
  ),
  source TEXT NOT NULL CHECK (source IN ('upload', 'generated', 'import')),
  file_name_cipher TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  content_sha256 TEXT NOT NULL,
  content_cipher TEXT,
  extracted_text_cipher TEXT,
  parse_status TEXT NOT NULL CHECK (
    parse_status IN ('pending', 'ready', 'failed', 'not_applicable')
  ),
  supersedes_document_id TEXT REFERENCES candidate_documents(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;

CREATE UNIQUE INDEX candidate_documents_active_hash
  ON candidate_documents(candidate_id, content_sha256)
  WHERE deleted_at IS NULL;
CREATE INDEX candidate_documents_candidate
  ON candidate_documents(candidate_id, kind, created_at);
`;

export const MIGRATION_12 = `
CREATE TABLE vacancy_subscriptions (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source = 'hh'),
  query_cipher TEXT NOT NULL,
  cadence_minutes INTEGER NOT NULL CHECK (
    cadence_minutes BETWEEN 60 AND 10080
  ),
  status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
  next_run_at TEXT NOT NULL,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error_code TEXT,
  lease_until TEXT,
  source_found INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX vacancy_subscriptions_due
  ON vacancy_subscriptions(status, next_run_at, lease_until);
CREATE INDEX vacancy_subscriptions_candidate
  ON vacancy_subscriptions(candidate_id, created_at);

CREATE TABLE vacancies (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source = 'hh'),
  external_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  latest_version INTEGER NOT NULL CHECK (latest_version > 0),
  UNIQUE (source, external_id)
) STRICT;

CREATE TABLE vacancy_versions (
  vacancy_id TEXT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  content_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (vacancy_id, version)
) STRICT;

CREATE TABLE vacancy_subscription_items (
  subscription_id TEXT NOT NULL REFERENCES vacancy_subscriptions(id) ON DELETE CASCADE,
  vacancy_id TEXT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  first_matched_at TEXT NOT NULL,
  last_matched_at TEXT NOT NULL,
  PRIMARY KEY (subscription_id, vacancy_id)
) STRICT;

CREATE TABLE vacancy_source_health (
  source TEXT PRIMARY KEY CHECK (source = 'hh'),
  status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'unavailable')),
  last_attempt_at TEXT NOT NULL,
  last_success_at TEXT,
  last_error_code TEXT,
  retry_after_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
) STRICT;
`;
