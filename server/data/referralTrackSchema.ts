/**
 * B389 срез 2 — трек внутренней рекомендации на отклик. Новая маленькая
 * таблица: только CREATE TABLE IF NOT EXISTS, никаких ALTER (окно здоровья 20 с).
 */
export const MIGRATION_40 = `
CREATE TABLE IF NOT EXISTS application_referral_track (
  application_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  body_cipher TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_application_referral_track_candidate ON application_referral_track(candidate_id);
`;
