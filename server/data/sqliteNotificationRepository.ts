import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from './sqliteBusyTimeout';
import { MIGRATION_43 } from './notificationSchema';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  notificationPreferenceKey,
  presentNotification,
  type NotificationEventInput,
  type NotificationEventKind,
  type NotificationItem,
  type NotificationPage,
  type NotificationPreference,
  type NotificationPreferenceKey,
} from './notificationPolicy';

export const NOTIFICATION_RETENTION_DAYS = 90;
const RETENTION_MS = NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1_000;

interface NotificationRow {
  id: string;
  event_kind: NotificationEventKind;
  source_id: string;
  created_at: string;
  expires_at: string;
  read_at: string | null;
}

interface PreferenceRow {
  preference_key: NotificationPreferenceKey;
  app_enabled: number;
  email_enabled: number;
}

interface Cursor {
  readonly createdAt: string;
  readonly id: string;
}

export class NotificationCursorError extends Error {
  constructor() {
    super('invalid_notification_cursor');
    this.name = 'NotificationCursorError';
  }
}

export class SqliteNotificationRepository {
  private readonly database: DatabaseSync;
  private readonly ownsDatabase: boolean;
  private readonly retentionSweep: ReturnType<typeof setInterval>;

  constructor(options: DatabaseSync | { readonly databasePath: string }) {
    this.ownsDatabase = !(options instanceof DatabaseSync);
    if (options instanceof DatabaseSync) {
      this.database = options;
    } else {
      this.database = new DatabaseSync(options.databasePath, {
        timeout: 5_000,
        enableForeignKeyConstraints: true,
        defensive: true,
      });
      if (options.databasePath !== ':memory:') this.database.exec('PRAGMA journal_mode = WAL;');
      applySqliteBusyTimeout(this.database);
    }
    this.database.exec(MIGRATION_43);
    this.deleteExpired();
    this.retentionSweep = setInterval(() => this.deleteExpired(), 60 * 60 * 1_000);
    this.retentionSweep.unref();
  }

  recordEvent(
    candidateId: string,
    input: NotificationEventInput,
    now = new Date().toISOString(),
  ): NotificationItem | null {
    this.deleteExpired(now);
    const existing = this.readByIdempotencyKey(candidateId, input.idempotencyKey);
    if (existing) return this.toItem(existing);
    const preferenceKey = notificationPreferenceKey(input.kind);
    if (preferenceKey && !this.isAppEnabled(candidateId, preferenceKey)) return null;
    const createdAt = input.createdAt ?? now;
    const expiresAt = new Date(Date.parse(createdAt) + RETENTION_MS).toISOString();
    if (expiresAt <= now) return null;
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO candidate_notifications
          (id, candidate_id, event_kind, source_type, source_id, idempotency_key, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id, idempotency_key) DO NOTHING`,
      )
      .run(id, candidateId, input.kind, input.sourceType, input.sourceId, input.idempotencyKey, createdAt, expiresAt);
    const row = this.readByIdempotencyKey(candidateId, input.idempotencyKey);
    return row ? this.toItem(row) : null;
  }

  list(
    candidateId: string,
    options: { readonly limit: number; readonly cursor?: string; readonly now: string },
  ): NotificationPage {
    this.deleteExpired(options.now);
    const cursor = options.cursor ? decodeCursor(options.cursor) : null;
    const rows = this.database
      .prepare(
        `SELECT id, event_kind, source_id, created_at, expires_at, read_at
         FROM candidate_notifications
         WHERE candidate_id = ? AND expires_at > ?
           AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?))
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(
        candidateId,
        options.now,
        cursor ? 1 : null,
        cursor?.createdAt ?? null,
        cursor?.createdAt ?? null,
        cursor?.id ?? null,
        options.limit + 1,
      ) as unknown as NotificationRow[];
    const hasMore = rows.length > options.limit;
    const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
    const unread = this.database
      .prepare(
        'SELECT COUNT(*) AS count FROM candidate_notifications WHERE candidate_id = ? AND read_at IS NULL AND expires_at > ?',
      )
      .get(candidateId, options.now) as { count: number };
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((row) => this.toItem(row)),
      unreadCount: unread.count,
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    };
  }

  markRead(candidateId: string, notificationId: string, now = new Date().toISOString()): boolean {
    this.deleteExpired(now);
    const result = this.database
      .prepare(
        `UPDATE candidate_notifications SET read_at = COALESCE(read_at, ?)
         WHERE candidate_id = ? AND id = ? AND expires_at > ?`,
      )
      .run(now, candidateId, notificationId, now);
    return result.changes > 0;
  }

  markAllRead(candidateId: string, now = new Date().toISOString()): number {
    this.deleteExpired(now);
    const result = this.database
      .prepare(
        `UPDATE candidate_notifications SET read_at = ?
         WHERE candidate_id = ? AND read_at IS NULL AND expires_at > ?`,
      )
      .run(now, candidateId, now);
    return Number(result.changes);
  }

  getPreferences(candidateId: string): NotificationPreference[] {
    const stored = this.database
      .prepare(
        'SELECT preference_key, app_enabled, email_enabled FROM candidate_notification_preferences WHERE candidate_id = ?',
      )
      .all(candidateId) as unknown as PreferenceRow[];
    const byKey = new Map(stored.map((row) => [row.preference_key, row]));
    return DEFAULT_NOTIFICATION_PREFERENCES.map((defaults) => {
      const row = byKey.get(defaults.key);
      return row
        ? { key: defaults.key, app: row.app_enabled === 1, email: row.email_enabled === 1 }
        : defaults;
    });
  }

  setPreference(
    candidateId: string,
    key: NotificationPreferenceKey,
    channels: { readonly app: boolean; readonly email: boolean },
    now = new Date().toISOString(),
  ): NotificationPreference {
    this.database
      .prepare(
        `INSERT INTO candidate_notification_preferences
          (candidate_id, preference_key, app_enabled, email_enabled, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id, preference_key) DO UPDATE SET
           app_enabled = excluded.app_enabled,
           email_enabled = excluded.email_enabled,
           updated_at = excluded.updated_at`,
      )
      .run(candidateId, key, channels.app ? 1 : 0, channels.email ? 1 : 0, now);
    return { key, ...channels };
  }

  deleteExpired(now = new Date().toISOString()): number {
    return Number(this.database
      .prepare('DELETE FROM candidate_notifications WHERE expires_at <= ?')
      .run(now).changes);
  }

  deleteByCandidate(candidateId: string): number {
    const removed = Number(this.database
      .prepare('DELETE FROM candidate_notifications WHERE candidate_id = ?')
      .run(candidateId).changes);
    this.database
      .prepare('DELETE FROM candidate_notification_preferences WHERE candidate_id = ?')
      .run(candidateId);
    return removed;
  }

  close(): void {
    clearInterval(this.retentionSweep);
    if (this.ownsDatabase) this.database.close();
  }

  private isAppEnabled(candidateId: string, key: NotificationPreferenceKey): boolean {
    const stored = this.database
      .prepare(
        'SELECT app_enabled FROM candidate_notification_preferences WHERE candidate_id = ? AND preference_key = ?',
      )
      .get(candidateId, key) as { app_enabled: number } | undefined;
    return stored ? stored.app_enabled === 1 : true;
  }

  private readByIdempotencyKey(candidateId: string, key: string): NotificationRow | undefined {
    return this.database
      .prepare(
        `SELECT id, event_kind, source_id, created_at, expires_at, read_at
         FROM candidate_notifications WHERE candidate_id = ? AND idempotency_key = ?`,
      )
      .get(candidateId, key) as NotificationRow | undefined;
  }

  private toItem(row: NotificationRow): NotificationItem {
    return presentNotification({
      id: row.id,
      kind: row.event_kind,
      createdAt: row.created_at,
      readAt: row.read_at,
      sourceId: row.source_id,
    });
  }
}

function encodeCursor(row: NotificationRow): string {
  return Buffer.from(JSON.stringify({ createdAt: row.created_at, id: row.id })).toString('base64url');
}

function decodeCursor(value: string): Cursor {
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (typeof cursor.createdAt === 'string' && typeof cursor.id === 'string') return cursor as Cursor;
  } catch {
    // Invalid cursors return an empty cursor and are rejected by the route schema before access.
  }
  throw new NotificationCursorError();
}
