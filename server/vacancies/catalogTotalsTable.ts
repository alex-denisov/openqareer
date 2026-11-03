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

/**
 * PRB-041: the public listings (place and place × role counts), written by maintenance next to
 * the totals. Prod 03.11: their GROUP BY over 3 004 listings held the HTTP event loop 0.75–1.1 s
 * every five minutes; the web process now reads one row.
 */
export const CATALOG_LISTINGS_TABLE = `
CREATE TABLE IF NOT EXISTS catalog_listings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  listings_json TEXT NOT NULL,
  computed_at TEXT NOT NULL
) STRICT;
`;
