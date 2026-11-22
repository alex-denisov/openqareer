/** B755: ключи доступа (Touch ID / Face ID) — только новые таблицы; строки уходят вместе с пользователем. */
export const PASSKEY_SCHEMA = `
CREATE TABLE IF NOT EXISTS user_passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key BLOB NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  transports_json TEXT NOT NULL DEFAULT '[]',
  backed_up INTEGER NOT NULL DEFAULT 0,
  device_label TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS user_passkeys_user ON user_passkeys(user_id);
CREATE TABLE IF NOT EXISTS passkey_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
  challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;
`;
