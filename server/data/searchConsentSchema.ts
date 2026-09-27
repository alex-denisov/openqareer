/**
 * B263 срез 1 — согласие кандидата «Вы в поиске». Таблица пустая до первого
 * акцепта, поэтому `CREATE TABLE IF NOT EXISTS` ничего не стоит в окне
 * здоровья выката 20 с (правило B230), как и предыдущие миграции этого рода.
 */
export const MIGRATION_36 = `
CREATE TABLE IF NOT EXISTS search_consents (
  candidate_id TEXT PRIMARY KEY,
  granted INTEGER NOT NULL CHECK (granted IN (0, 1)),
  policy_version TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
`;
