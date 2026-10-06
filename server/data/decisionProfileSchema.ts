/**
 * B384 срез 2 — профиль ограничений кандидата на сервере. Новая маленькая
 * таблица: только CREATE TABLE IF NOT EXISTS, никаких ALTER (окно 20 с).
 * Содержимое запечатано: гражданство и семейное положение — конфиденциальны.
 */
export const MIGRATION_43 = `
CREATE TABLE IF NOT EXISTS candidate_decision_profile (
  candidate_id TEXT PRIMARY KEY,
  profile_cipher TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;
