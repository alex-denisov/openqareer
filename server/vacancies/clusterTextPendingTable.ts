/**
 * 01.11: записи, которым сведение должно заново найти двойника по тексту
 * (текст hh и Workday дочитывается после сведения), и курсор однократного
 * прохода по записям, дочитанным до этого.
 */
export const CLUSTER_TEXT_PENDING_TABLE = `
CREATE TABLE IF NOT EXISTS cluster_text_pending (
  vacancy_id TEXT PRIMARY KEY,
  requested_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS cluster_text_backfill_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cursor_rowid INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1))
);
INSERT OR IGNORE INTO cluster_text_backfill_state (id) VALUES (1);
`;
