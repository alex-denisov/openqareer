import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATION_46 } from './notificationDeliverySchema';
import { MIGRATION_DELIVERY_SETTINGS } from './notificationDeliverySettings';
import { MIGRATION_INVITATION_PREFERENCE } from './notificationInvitationPreference';
import { widenNotificationKinds } from './notificationKindMigration';
import { MIGRATION_45 } from './notificationSchema';
import { SqliteNotificationRepository } from './sqliteNotificationRepository';

/** Схема уведомлений до B695: та же таблица, но CHECK ещё без `post_reminder`. */
const BEFORE_B695 = MIGRATION_45.replace(", 'post_reminder'", '');
const NOW = '2026-11-22T12:00:00.000Z';
const ROWS = 40;

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).reverse().forEach((cleanup) => cleanup()));

function openFile(path: string): DatabaseSync {
  const database = new DatabaseSync(path, { enableForeignKeyConstraints: true, defensive: true });
  cleanups.push(() => database.close());
  return database;
}

function tempPath(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'b695-notifications-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, name);
}

/** Копия базы как на проде до выката: старая схема, строки уведомлений, доставок и приглашений. */
function legacyDatabase(): DatabaseSync {
  const database = openFile(tempPath('legacy.db'));
  database.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;');
  database.exec(BEFORE_B695);
  database.exec(MIGRATION_46);
  database.exec(MIGRATION_INVITATION_PREFERENCE);
  database.exec(MIGRATION_DELIVERY_SETTINGS);
  database.prepare("INSERT INTO candidates (id) VALUES ('candidate-a'), ('candidate-b')").run();
  const insert = database.prepare(`INSERT INTO candidate_notifications
    (id, candidate_id, event_kind, source_type, source_id, idempotency_key, created_at, expires_at, read_at)
    VALUES (?, ?, ?, 'application', ?, ?, ?, '2027-01-01T00:00:00.000Z', ?)`);
  const delivery = database.prepare(`INSERT INTO candidate_notification_deliveries
    (notification_id, candidate_id, channel, status, attempts, next_attempt_at, updated_at)
    VALUES (?, ?, 'telegram', 'delivered', 1, ?, ?)`);
  for (let index = 0; index < ROWS; index += 1) {
    const candidate = index % 2 ? 'candidate-b' : 'candidate-a';
    const kind = index % 3 ? 'employer_reply' : 'interview_reminder';
    const at = new Date(Date.parse(NOW) - index * 60_000).toISOString();
    insert.run(`n-${index}`, candidate, kind, `s-${index}`, `key-${index}`, at, index % 4 ? null : at);
    delivery.run(`n-${index}`, candidate, at, at);
  }
  database.prepare("INSERT INTO candidate_notification_invitation_events (notification_id, candidate_id) VALUES ('n-1', 'candidate-b')").run();
  return database;
}

const schemaOf = (database: DatabaseSync) =>
  database.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_stat%' ORDER BY type, name").all();
const rowsOf = (database: DatabaseSync, table: string) =>
  database.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all();
const columnsOf = (database: DatabaseSync) => database.prepare('PRAGMA table_xinfo(candidate_notifications)').all();
const indexesOf = (database: DatabaseSync) =>
  database.prepare('PRAGMA index_list(candidate_notifications)').all().map((row) => {
    const { name, unique, origin, partial } = row as { name: string; unique: number; origin: string; partial: number };
    return { name, unique, origin, partial, columns: database.prepare(`PRAGMA index_xinfo(${JSON.stringify(name)})`).all() };
  }).sort((a, b) => a.name.localeCompare(b.name));
const triggersOf = (database: DatabaseSync) =>
  database.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'candidate_notifications'").all();

function freshDatabase(): DatabaseSync {
  const database = openFile(tempPath('fresh.db'));
  database.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;');
  const repository = new SqliteNotificationRepository(database);
  cleanups.push(() => repository.close());
  return database;
}

describe('B695: пересборка candidate_notifications под новый вид post_reminder', () => {
  it('сохраняет все строки, доставки и приглашения; схема совпадает со свежей базой', () => {
    const database = legacyDatabase();
    const before = {
      notifications: rowsOf(database, 'candidate_notifications'),
      deliveries: rowsOf(database, 'candidate_notification_deliveries'),
      invitations: rowsOf(database, 'candidate_notification_invitation_events'),
      columns: columnsOf(database),
      indexes: indexesOf(database),
      triggers: triggersOf(database),
    };
    expect(before.notifications).toHaveLength(ROWS);

    expect(widenNotificationKinds(database)).toBe(true);

    expect(rowsOf(database, 'candidate_notifications')).toEqual(before.notifications);
    expect(rowsOf(database, 'candidate_notification_deliveries')).toEqual(before.deliveries);
    expect(rowsOf(database, 'candidate_notification_invitation_events')).toEqual(before.invitations);
    expect(columnsOf(database)).toEqual(before.columns);
    expect(indexesOf(database)).toEqual(before.indexes);
    expect(triggersOf(database)).toEqual(before.triggers);
    expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(database.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    // Конструктор доставит остальные таблицы; после него схема как у свежей базы, кроме вида.
    const repository = new SqliteNotificationRepository(database);
    cleanups.push(() => repository.close());
    expect(schemaOf(database)).toEqual(schemaOf(freshDatabase()));
  });

  it('после пересборки CHECK принимает post_reminder и по-прежнему отвергает чужой вид', () => {
    const database = legacyDatabase();
    const insert = (id: string, kind: string) => database.prepare(`INSERT INTO candidate_notifications
      (id, candidate_id, event_kind, source_type, source_id, idempotency_key, created_at, expires_at)
      VALUES (?, 'candidate-a', ?, 'linkedin_queue', 'q-1', ?, ?, '2027-01-01T00:00:00.000Z')`).run(id, kind, id, NOW);
    expect(() => insert('before', 'post_reminder')).toThrow(/CHECK/u);

    widenNotificationKinds(database);

    expect(() => insert('after', 'post_reminder')).not.toThrow();
    expect(() => insert('alien', 'made_up_kind')).toThrow(/CHECK/u);
  });

  it('повторный запуск и свежая база ничего не пересобирают', () => {
    const database = legacyDatabase();
    widenNotificationKinds(database);
    const once = schemaOf(database);
    expect(widenNotificationKinds(database)).toBe(false);
    expect(schemaOf(database)).toEqual(once);
    expect(widenNotificationKinds(freshDatabase())).toBe(false);
  });

  it('при сбое посреди пересборки откатывается целиком: старая таблица и строки на месте', () => {
    const database = legacyDatabase();
    const before = rowsOf(database, 'candidate_notifications');
    const schema = schemaOf(database);
    // Чужая таблица с именем промежуточной ломает шаг CREATE TABLE … AS.
    database.exec('CREATE TABLE candidate_notifications_b695 (x INTEGER)');
    expect(() => widenNotificationKinds(database)).toThrow();
    database.exec('DROP TABLE candidate_notifications_b695');
    expect(schemaOf(database)).toEqual(schema);
    expect(rowsOf(database, 'candidate_notifications')).toEqual(before);
    expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  });

  it('конструктор репозитория пересобирает старую базу и пишет post_reminder', () => {
    const database = legacyDatabase();
    const repository = new SqliteNotificationRepository(database);
    cleanups.push(() => repository.close());
    const item = repository.recordEvent('candidate-a', {
      kind: 'post_reminder', sourceType: 'linkedin_queue', sourceId: 'q-1',
      idempotencyKey: 'post-reminder:q-1:2026-11-22T11:00:00.000Z', createdAt: '2026-11-22T11:00:00.000Z',
    }, NOW);
    expect(item?.kind).toBe('post_reminder');
    expect(rowsOf(database, 'candidate_notifications')).toHaveLength(ROWS + 1);
  });
});
