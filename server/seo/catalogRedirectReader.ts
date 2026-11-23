import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { applySqliteBusyTimeout, SQLITE_HTTP_BUSY_TIMEOUT_MS } from '../data/sqliteBusyTimeout';

/**
 * B752: страница каталога, переехавшая к куску разбитого кластера. Старый
 * ключ адреса ведёт на текущий адрес нового кластера — одна строка по
 * первичному ключу, соединение только на чтение.
 */

const readers = new Map<string, { database: DatabaseSync; statement: StatementSync }>();

function statementFor(databasePath: string): StatementSync {
  const open = readers.get(databasePath);
  if (open?.database.isOpen) return open.statement;
  const database = new DatabaseSync(databasePath, { readOnly: true });
  applySqliteBusyTimeout(database, SQLITE_HTTP_BUSY_TIMEOUT_MS);
  const statement = database.prepare(
    `SELECT e.path AS path FROM vacancy_catalog_redirects r
       JOIN catalog_entries e ON e.cluster_id = r.new_cluster_id
      WHERE r.old_key = ?`,
  );
  readers.set(databasePath, { database, statement });
  return statement;
}

/** Текущий адрес карточки, куда переехал старый ключ, или `undefined`. */
export function readCatalogRedirect(databasePath: string, oldKey: string): string | undefined {
  if (databasePath === ':memory:') return undefined;
  try {
    const row = statementFor(databasePath).get(oldKey) as { path: string } | undefined;
    return row?.path;
  } catch {
    // Таблицы ещё нет (база до B752) — переадресации тоже нет.
    return undefined;
  }
}
