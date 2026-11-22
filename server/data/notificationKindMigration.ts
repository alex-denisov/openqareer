import type { DatabaseSync } from 'node:sqlite';
import { CANDIDATE_NOTIFICATIONS_TABLE } from './notificationSchema';

/** Вид, которого нет в CHECK баз, созданных до B695. */
const NEWEST_KIND = 'post_reminder';
const TABLE = 'candidate_notifications';
const HOLD = 'candidate_notifications_b695';
const COLUMNS = 'id, candidate_id, event_kind, source_type, source_id, idempotency_key, created_at, expires_at, read_at';
/** Таблицы со ссылкой на уведомления: их строки не должны потеряться при пересборке. */
const CHECKED = [TABLE, 'candidate_notification_deliveries', 'candidate_notification_invitation_events'];

function tableSql(database: DatabaseSync): string | null {
  const row = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(TABLE) as
    | { sql: string }
    | undefined;
  return row?.sql ?? null;
}

const needsRebuild = (database: DatabaseSync): boolean => {
  const sql = tableSql(database);
  return sql !== null && !sql.includes(`'${NEWEST_KIND}'`);
};

function foreignKeyViolations(database: DatabaseSync): number {
  const existing = CHECKED.filter((name) =>
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  return existing.reduce((sum, name) => sum + database.prepare(`PRAGMA foreign_key_check(${name})`).all().length, 0);
}

function triggerSqls(database: DatabaseSync): string[] {
  return (database.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?").all(TABLE) as Array<{ sql: string }>)
    .map((row) => row.sql);
}

/** Копия строк → новая таблица тем же текстом, что у свежей базы → строки обратно. */
function rebuild(database: DatabaseSync): void {
  const triggers = triggerSqls(database);
  database.exec(`CREATE TABLE ${HOLD} AS SELECT ${COLUMNS} FROM ${TABLE};`);
  database.exec(`DROP TABLE ${TABLE};`);
  database.exec(CANDIDATE_NOTIFICATIONS_TABLE);
  database.exec(`INSERT INTO ${TABLE} (${COLUMNS}) SELECT ${COLUMNS} FROM ${HOLD};`);
  database.exec(`DROP TABLE ${HOLD};`);
  for (const sql of triggers) database.exec(`${sql};`);
}

/**
 * B695: в CHECK `event_kind` старых баз нет `post_reminder`. SQLite не меняет CHECK на месте,
 * поэтому таблица пересобирается одной транзакцией: те же столбцы, индексы и триггеры, все строки.
 * Внешние ключи выключаются до BEGIN (внутри транзакции PRAGMA не действует), иначе DROP
 * снёс бы каскадом доставки и отметки приглашений. Возвращает `true`, если пересобрала.
 */
export function widenNotificationKinds(database: DatabaseSync): boolean {
  if (!needsRebuild(database)) return false;
  const enforced = (database.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys === 1;
  if (enforced) database.exec('PRAGMA foreign_keys = OFF');
  try {
    database.exec('BEGIN IMMEDIATE');
    try {
      // Соседний процесс мог пересобрать, пока мы ждали блокировку.
      const rebuilt = needsRebuild(database);
      if (rebuilt) {
        const violationsBefore = foreignKeyViolations(database);
        rebuild(database);
        if (foreignKeyViolations(database) > violationsBefore) throw new Error('notification_rebuild_foreign_keys');
      }
      database.exec('COMMIT');
      return rebuilt;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  } finally {
    if (enforced) database.exec('PRAGMA foreign_keys = ON');
  }
}
