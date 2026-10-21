/**
 * B485 — итоги каталога для сводки подборки. Пишет процесс обслуживания после
 * сведения пула; HTTP читает одну строку по ключу и не трогает vacancy_clusters.
 */
export const CATALOG_TOTALS_TABLE = `
CREATE TABLE IF NOT EXISTS catalog_totals (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  catalog_total INTEGER NOT NULL,
  observed_at TEXT NOT NULL,
  computed_at TEXT NOT NULL
) STRICT;
`;
