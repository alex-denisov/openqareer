/**
 * B374 срез 2 — журнал приглашений аккаунтов пула. Новая маленькая таблица:
 * только CREATE ... IF NOT EXISTS, без ALTER (окно здоровья 20 с).
 * Цель хранится хэшем адреса профиля, имени и адреса в журнале нет.
 */
export const MIGRATION_42 = `
CREATE TABLE IF NOT EXISTS linkedin_pool_invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  target_hash TEXT NOT NULL,
  company TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pool_invitations_target ON linkedin_pool_invitations(account_id, target_hash);
CREATE INDEX IF NOT EXISTS idx_pool_invitations_account_time ON linkedin_pool_invitations(account_id, created_at);
`;
