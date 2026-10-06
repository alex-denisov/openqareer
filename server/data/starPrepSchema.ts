/**
 * B392 срез 2 — подготовка по STAR, привязанная к отклику. Новая маленькая
 * таблица: только CREATE TABLE IF NOT EXISTS, никаких ALTER (окно здоровья 20 с).
 */
export const MIGRATION_39 = `
CREATE TABLE IF NOT EXISTS application_star_prep (
  application_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  body_cipher TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_application_star_prep_candidate ON application_star_prep(candidate_id);
`;
