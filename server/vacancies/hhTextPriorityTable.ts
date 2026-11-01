/**
 * Подборки кандидатов первыми в очереди дочитывания текста hh (01.11). HTTP пишет
 * id подборки, которой ещё нужен процент; воркер обслуживания читает голову очереди
 * раньше каталога и убирает строку после попытки. Отдельная таблица: в большие
 * таблицы колонки не добавляются.
 */
export const HH_TEXT_PRIORITY_TABLE = `
CREATE TABLE IF NOT EXISTS hh_text_priority (
  vacancy_id TEXT PRIMARY KEY,
  rank INTEGER NOT NULL,
  requested_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS hh_text_priority_order ON hh_text_priority (rank, requested_ms DESC);
CREATE TABLE IF NOT EXISTS hh_text_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cursor TEXT
) STRICT;
`;

/** Строк одной подборки за запись: больше, чем у самого широкого тарифа в приоритете. */
export const HH_TEXT_PRIORITY_MAX_IDS = 5_000;
