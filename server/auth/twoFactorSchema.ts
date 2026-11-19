/** B401: двухфакторная защита — только новые таблицы; строки уходят вместе с пользователем. */
export const TWO_FACTOR_SCHEMA = `
CREATE TABLE IF NOT EXISTS user_two_factor (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_cipher TEXT,
  pending_cipher TEXT,
  enabled_at TEXT,
  last_step INTEGER NOT NULL DEFAULT -1,
  failed_count INTEGER NOT NULL DEFAULT 0,
  failed_since TEXT,
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS user_two_factor_backup_codes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TEXT,
  PRIMARY KEY (user_id, code_hash)
) STRICT;
CREATE TABLE IF NOT EXISTS two_factor_login_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_device_id TEXT,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
) STRICT;
`;
