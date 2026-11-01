/**
 * «История изменений» профиля: один журнал на все разделы и всех авторов.
 * Раздел — свободная строка (проверяется в коде), чтобы проекты, образование,
 * сертификаты и языки добавлялись без миграции. Тексты запечатаны.
 * `fact_states_json` хранит прежние status/confidence фактов, которые запись
 * подтвердила, чтобы откат вернул их как было.
 */
export const PROFILE_CHANGE_LOG_MIGRATION = `
CREATE TABLE IF NOT EXISTS profile_change_log (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  actor TEXT NOT NULL CHECK (actor IN ('candidate', 'consultant', 'import', 'skill_check')),
  section TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'value' CHECK (kind IN ('value', 'confirmation')),
  item_id TEXT,
  label_cipher TEXT NOT NULL,
  previous_cipher TEXT NOT NULL,
  applied_cipher TEXT NOT NULL,
  command_id TEXT,
  fact_states_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  reverted_at TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS profile_change_log_candidate
  ON profile_change_log(candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS profile_change_log_command
  ON profile_change_log(candidate_id, command_id);
`;
