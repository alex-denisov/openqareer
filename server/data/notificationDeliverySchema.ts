/** Channel delivery state contains opaque references and hashes, never message bodies or raw tokens. */
export const MIGRATION_46 = `
CREATE TABLE IF NOT EXISTS candidate_notification_telegram_preferences (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  preference_key TEXT NOT NULL CHECK (preference_key IN (
    'ev-reply', 'ev-reminder', 'ev-approval', 'ev-delivery-error',
    'ev-target-company', 'ev-weekly-digest'
  )),
  telegram_enabled INTEGER NOT NULL CHECK (telegram_enabled IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, preference_key)
) STRICT;

CREATE TABLE IF NOT EXISTS candidate_notification_telegram_chats (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  chat_id_cipher TEXT NOT NULL,
  linked_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS candidate_notification_telegram_link_codes (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS candidate_notification_telegram_link_expiry
  ON candidate_notification_telegram_link_codes(expires_at);

CREATE TABLE IF NOT EXISTS candidate_notification_deliveries (
  notification_id TEXT NOT NULL REFERENCES candidate_notifications(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'telegram')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'delivered', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  provider_id TEXT,
  last_error_code TEXT,
  PRIMARY KEY (notification_id, channel)
) STRICT;
CREATE INDEX IF NOT EXISTS candidate_notification_deliveries_due
  ON candidate_notification_deliveries(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS candidate_notification_unsubscribe_tokens (
  token_hash TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS candidate_notification_unsubscribe_candidate
  ON candidate_notification_unsubscribe_tokens(candidate_id, expires_at);
`;
