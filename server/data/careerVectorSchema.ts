/**
 * B383 срез 2 — вектор перехода кандидата (гипотеза). Новая маленькая таблица:
 * только CREATE TABLE IF NOT EXISTS, никаких ALTER (окно здоровья 20 с).
 */
export const MIGRATION_41 = `
CREATE TABLE IF NOT EXISTS candidate_career_vector (
  candidate_id TEXT PRIMARY KEY,
  answers_cipher TEXT NOT NULL,
  vector TEXT,
  rationale_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'hypothesis',
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
`;
