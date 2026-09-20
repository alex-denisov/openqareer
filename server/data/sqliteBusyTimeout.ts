import type { DatabaseSync } from 'node:sqlite';

/**
 * Сколько соединение ждёт чужой write-lock, прежде чем бросить `SQLITE_BUSY`.
 *
 * С B230 базу пишут два процесса: HTTP (сессии, анкеты) и обслуживатель пула
 * (волны опроса площадок). Без ожидания вторая запись падала бы сразу —
 * SQLite по умолчанию не ждёт ни миллисекунды. Пять секунд с запасом
 * перекрывают одну транзакцию волны (≤ 1 с по контракту обслуживателя).
 */
export const SQLITE_BUSY_TIMEOUT_MS = 5_000;

/** Ставится сразу после открытия, до первой записи — включая миграции. */
export function applySqliteBusyTimeout(database: DatabaseSync): void {
  database.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`);
}
