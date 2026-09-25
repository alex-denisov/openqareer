/**
 * B267 срез 1 — кеш разбора названия и узкий индекс смыслового подбора.
 * Обе таблицы пустые до шага наполнения воркера обслуживания (срез 2), поэтому
 * `CREATE TABLE/INDEX IF NOT EXISTS` не стоит ничего в окне здоровья выката
 * 20 с (B230), как и предыдущие срезы этого правила (`MIGRATION_32`).
 */
export const MIGRATION_35 = `
CREATE TABLE IF NOT EXISTS title_parse (
  title_key TEXT PRIMARY KEY,
  sample_title TEXT NOT NULL,
  functions TEXT NOT NULL,
  level_rank INTEGER,
  role_label TEXT,
  parsed_by TEXT NOT NULL CHECK (parsed_by IN ('model', 'rules')),
  model TEXT,
  taxonomy_version INTEGER NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  parsed_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS title_parse_queue
  ON title_parse(priority DESC, title_key) WHERE parsed_by = 'rules';

CREATE TABLE IF NOT EXISTS vacancy_semantic (
  id TEXT NOT NULL,
  function_code TEXT NOT NULL,
  level_rank INTEGER,
  title_key TEXT NOT NULL,
  published_ms INTEGER,
  is_remote INTEGER,
  PRIMARY KEY (id, function_code)
) STRICT;
CREATE INDEX IF NOT EXISTS vacancy_semantic_match
  ON vacancy_semantic(function_code, published_ms DESC, id);
CREATE INDEX IF NOT EXISTS vacancy_semantic_title ON vacancy_semantic(title_key);
`;
