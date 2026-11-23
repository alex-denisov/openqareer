/**
 * B752: разбиение кластеров, склеенных голым внешним id. Только
 * `CREATE TABLE/INDEX IF NOT EXISTS` — окно здоровья выката 20 с (B230).
 *
 * - `cluster_split_state` — курсор по `vacancy_clusters.rowid` и счётчики;
 * - `cluster_split_journal` — прежнее состояние каждого разбитого кластера
 *   (строка, ключи, строки каталога), по нему шаг откатывается целиком;
 * - `vacancy_catalog_redirects` — старый ключ карточки → новый кластер, когда
 *   страница каталога переехала к куску.
 */
export const CLUSTER_SPLIT_TABLES = `
CREATE TABLE IF NOT EXISTS cluster_split_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cursor_rowid INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  steps INTEGER NOT NULL DEFAULT 0,
  clusters_split INTEGER NOT NULL DEFAULT 0,
  pieces_created INTEGER NOT NULL DEFAULT 0,
  skipped_candidate_ref INTEGER NOT NULL DEFAULT 0,
  catalog_moved INTEGER NOT NULL DEFAULT 0,
  jobs_enqueued INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
) STRICT;
INSERT OR IGNORE INTO cluster_split_state (id) VALUES (1);
CREATE TABLE IF NOT EXISTS cluster_split_journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step_id TEXT NOT NULL,
  old_cluster_id TEXT NOT NULL,
  old_rowid INTEGER NOT NULL,
  old_fingerprint TEXT NOT NULL,
  old_title TEXT NOT NULL,
  old_company TEXT NOT NULL,
  old_cluster_json TEXT NOT NULL,
  old_representative TEXT,
  old_items_count INTEGER NOT NULL,
  old_updated_at INTEGER NOT NULL,
  old_keys_json TEXT NOT NULL,
  old_catalog_json TEXT NOT NULL,
  new_piece_ids_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS cluster_split_journal_step ON cluster_split_journal(step_id);
CREATE TABLE IF NOT EXISTS vacancy_catalog_redirects (
  old_key TEXT PRIMARY KEY,
  old_path TEXT NOT NULL,
  new_cluster_id TEXT NOT NULL,
  new_key TEXT NOT NULL,
  step_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
`;
