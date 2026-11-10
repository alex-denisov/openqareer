/**
 * B643 — компания как источник, размещение отдельно. Три боковые таблицы
 * рядом с пулом; сам пул (930 тыс. строк) не перезаписывается. Пустые таблицы
 * создаются мгновенно, поэтому старт укладывается в окно проверки здоровья.
 *
 * - `company_placement` — одно размещение: сайт, доска ATS, LinkedIn или
 *   агрегатор. `source_id` — мост к `vacancy_pool` и `vacancy_source_state`.
 * - `vacancy_company` — компания записи агрегатора по точному имени; для досок
 *   работодателя связь выводится через `company_placement`.
 * - `company_discovery_queue` — компании, найденные агрегатором без сайта и ATS.
 */
export const PLACEMENT_TABLES = `
CREATE TABLE IF NOT EXISTS company_placement (
  placement_id TEXT PRIMARY KEY,
  company_key TEXT,
  type TEXT NOT NULL,
  provider TEXT,
  slug TEXT,
  url TEXT,
  priority INTEGER NOT NULL,
  source_id TEXT UNIQUE,
  health TEXT,
  last_full_read_at INTEGER,
  last_checked_at INTEGER,
  discovered_by TEXT NOT NULL,
  evidence TEXT,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS company_placement_company ON company_placement(company_key);
CREATE TABLE IF NOT EXISTS vacancy_company (
  vacancy_id TEXT PRIMARY KEY,
  company_key TEXT NOT NULL,
  match_how TEXT NOT NULL,
  linked_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS vacancy_company_company ON vacancy_company(company_key);
CREATE TABLE IF NOT EXISTS company_discovery_queue (
  name_key TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  vacancies_count INTEGER NOT NULL,
  sample_vacancy_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  updated_at INTEGER NOT NULL
) STRICT;
`;
