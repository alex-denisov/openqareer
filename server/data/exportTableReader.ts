import type { DatabaseSync } from 'node:sqlite';

export function tableExists(database: DatabaseSync, table: string): boolean {
  return (
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !==
    undefined
  );
}

/**
 * Читатель таблицы, которую создаёт маршрут под флагом или отдельный репозиторий. Пока таблицы
 * нет, выгрузка отдаёт пусто и схему не трогает; читатель открывается при первой выгрузке после
 * появления таблицы (B689).
 */
export function whenTableExists<Reader, Result>(
  database: DatabaseSync,
  table: string,
  open: () => Reader,
  read: (reader: Reader, candidateId: string) => Result,
  empty: () => Result,
): (candidateId: string) => Result {
  let reader: Reader | undefined;
  return (candidateId) => {
    if (!reader && !tableExists(database, table)) return empty();
    reader ??= open();
    return read(reader, candidateId);
  };
}
