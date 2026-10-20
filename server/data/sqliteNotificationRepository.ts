import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from './sqliteBusyTimeout';
import { MIGRATION_45 } from './notificationSchema';
import { MIGRATION_46 } from './notificationDeliverySchema';
import type { SealedText } from './sealedText';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  notificationPreferenceKey,
  presentNotification,
  type NotificationEventInput,
  type NotificationEventKind,
  type NotificationItem,
  type NotificationPage,
  type NotificationPreference,
  type NotificationPreferenceChannels,
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

export type NotificationDeliveryChannel = 'email' | 'telegram';

export interface ClaimedNotificationDelivery {
  readonly candidateId: string;
  readonly notificationId: string;
  readonly channel: NotificationDeliveryChannel;
  readonly attempt: number;
  readonly notification: NotificationItem;
}

interface DeliveryRow extends NotificationRow {
  notification_id: string;
  candidate_id: string;
  channel: NotificationDeliveryChannel;
  attempts: number;
}

const EVENT_PREFERENCE_SQL = `CASE n.event_kind
  WHEN 'email_approval' THEN 'ev-approval'
  WHEN 'post_approval' THEN 'ev-approval'
  WHEN 'interview_reminder' THEN 'ev-reminder'
  WHEN 'new_vacancies_by_role' THEN 'ev-target-company'
  WHEN 'employer_opened_letter' THEN 'ev-reply'
  WHEN 'consultant_edits' THEN 'ev-weekly-digest'
  WHEN 'footprint_findings' THEN 'ev-weekly-digest'
  WHEN 'import_completed' THEN 'ev-weekly-digest'
  WHEN 'employer_reply' THEN 'ev-reply'
  WHEN 'delivery_error' THEN 'ev-delivery-error'
END`;

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
  private readonly sealedText?: SealedText;

  constructor(options: DatabaseSync | { readonly databasePath: string }, sealedText?: SealedText) {
    this.ownsDatabase = !(options instanceof DatabaseSync);
    this.sealedText = sealedText;
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
    this.database.exec(MIGRATION_45);
    this.database.exec(MIGRATION_46);
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
    const createdAt = input.createdAt ?? now;
    const expiresAt = new Date(Date.parse(createdAt) + RETENTION_MS).toISOString();
    if (expiresAt <= now) return null;
    const id = randomUUID();
    this.database.exec('SAVEPOINT record_candidate_notification');
    try {
      this.database
        .prepare(
          `INSERT INTO candidate_notifications
            (id, candidate_id, event_kind, source_type, source_id, idempotency_key, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(candidate_id, idempotency_key) DO NOTHING`,
        )
        .run(id, candidateId, input.kind, input.sourceType, input.sourceId, input.idempotencyKey, createdAt, expiresAt);
      const row = this.readByIdempotencyKey(candidateId, input.idempotencyKey);
      if (row?.id === id) this.enqueueSelectedChannels(candidateId, row.id, input.kind, now);
      this.database.exec('RELEASE SAVEPOINT record_candidate_notification');
    } catch (error) {
      this.database.exec('ROLLBACK TO SAVEPOINT record_candidate_notification');
      this.database.exec('RELEASE SAVEPOINT record_candidate_notification');
      throw error;
    }
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
        `SELECT n.id, n.event_kind, n.source_id, n.created_at, n.expires_at, n.read_at
         FROM candidate_notifications n
         WHERE n.candidate_id = ? AND n.expires_at > ?
           AND COALESCE((SELECT p.app_enabled FROM candidate_notification_preferences p
             WHERE p.candidate_id = n.candidate_id AND p.preference_key = ${EVENT_PREFERENCE_SQL}), 1) = 1
           AND (? IS NULL OR n.created_at < ? OR (n.created_at = ? AND n.id < ?))
         ORDER BY n.created_at DESC, n.id DESC LIMIT ?`,
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
        `SELECT COUNT(*) AS count FROM candidate_notifications n
         WHERE n.candidate_id = ? AND n.read_at IS NULL AND n.expires_at > ?
           AND COALESCE((SELECT p.app_enabled FROM candidate_notification_preferences p
             WHERE p.candidate_id = n.candidate_id AND p.preference_key = ${EVENT_PREFERENCE_SQL}), 1) = 1`,
      )
      .get(candidateId, options.now) as { count: number };
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((row) => this.toItem(row)),
      unreadCount: unread.count,
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    };
  }

  /** B542: письмо открыто и ответ работодателя по откликам после `since`, для полосы «Сегодня». */
  listCompanyEventsSince(
    candidateId: string,
    since: string,
    now = new Date().toISOString(),
  ): { kind: 'letter_opened' | 'employer_reply'; applicationId: string; at: string }[] {
    const rows = this.database
      .prepare(
        `SELECT event_kind, source_id, created_at FROM candidate_notifications
         WHERE candidate_id = ? AND source_type = 'application' AND created_at > ? AND expires_at > ?
           AND event_kind IN ('employer_opened_letter', 'employer_reply')
         ORDER BY created_at, id LIMIT 50`,
      )
      .all(candidateId, since, now) as unknown as {
      event_kind: string;
      source_id: string;
      created_at: string;
    }[];
    return rows.map((row) => ({
      kind: row.event_kind === 'employer_reply' ? 'employer_reply' : 'letter_opened',
      applicationId: row.source_id,
      at: row.created_at,
    }));
  }

  /** B543: отмена ручной отметки снимает её уведомление и неотправленные доставки. */
  withdrawEvent(candidateId: string, idempotencyKey: string): boolean {
    const row = this.readByIdempotencyKey(candidateId, idempotencyKey);
    if (!row) return false;
    this.database
      .prepare('DELETE FROM candidate_notification_deliveries WHERE notification_id = ?')
      .run(row.id);
    this.database
      .prepare('DELETE FROM candidate_notifications WHERE candidate_id = ? AND id = ?')
      .run(candidateId, row.id);
    return true;
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
        `UPDATE candidate_notifications AS n SET read_at = ?
         WHERE candidate_id = ? AND read_at IS NULL AND expires_at > ?
           AND COALESCE((SELECT p.app_enabled FROM candidate_notification_preferences p
             WHERE p.candidate_id = n.candidate_id AND p.preference_key = ${EVENT_PREFERENCE_SQL}), 1) = 1`,
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
    const telegram = this.database
      .prepare(
        'SELECT preference_key, telegram_enabled FROM candidate_notification_telegram_preferences WHERE candidate_id = ?',
      )
      .all(candidateId) as Array<{ preference_key: NotificationPreferenceKey; telegram_enabled: number }>;
    const telegramByKey = new Map(telegram.map((row) => [row.preference_key, row.telegram_enabled === 1]));
    return DEFAULT_NOTIFICATION_PREFERENCES.map((defaults) => {
      const row = byKey.get(defaults.key);
      return row
        ? {
            key: defaults.key,
            app: row.app_enabled === 1,
            email: row.email_enabled === 1,
            telegram: telegramByKey.get(defaults.key) ?? defaults.telegram,
          }
        : { ...defaults, telegram: telegramByKey.get(defaults.key) ?? defaults.telegram };
    });
  }

  isDeliveryEnabled(candidateId: string, channel: NotificationDeliveryChannel, kind: NotificationEventKind): boolean {
    const key = notificationPreferenceKey(kind);
    if (!key) return false;
    const preference = this.getPreferences(candidateId).find((item) => item.key === key);
    if (!preference) return false;
    return channel === 'email' ? preference.email : preference.telegram && this.getTelegramChat(candidateId) !== null;
  }

  setPreference(
    candidateId: string,
    key: NotificationPreferenceKey,
    channels: NotificationPreferenceChannels,
    now = new Date().toISOString(),
  ): NotificationPreference {
    const telegram = channels.telegram ?? this.getPreferences(candidateId).find((item) => item.key === key)!.telegram;
    this.database.exec('SAVEPOINT set_candidate_notification_preference');
    try {
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
      if (channels.telegram !== undefined) {
        this.database
          .prepare(
            `INSERT INTO candidate_notification_telegram_preferences
              (candidate_id, preference_key, telegram_enabled, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(candidate_id, preference_key) DO UPDATE SET
               telegram_enabled = excluded.telegram_enabled, updated_at = excluded.updated_at`,
          )
          .run(candidateId, key, channels.telegram ? 1 : 0, now);
      }
      this.database.exec('RELEASE SAVEPOINT set_candidate_notification_preference');
    } catch (error) {
      this.database.exec('ROLLBACK TO SAVEPOINT set_candidate_notification_preference');
      this.database.exec('RELEASE SAVEPOINT set_candidate_notification_preference');
      throw error;
    }
    return { key, app: channels.app, email: channels.email, telegram };
  }

  linkTelegramChat(candidateId: string, chatId: string, now = new Date().toISOString()): void {
    if (!/^-?[0-9]{1,20}$/u.test(chatId)) throw new Error('invalid_telegram_chat_id');
    const sealedText = this.requireSealedText();
    this.database
      .prepare(
        `INSERT INTO candidate_notification_telegram_chats (candidate_id, chat_id_cipher, linked_at)
         VALUES (?, ?, ?) ON CONFLICT(candidate_id) DO UPDATE SET
         chat_id_cipher = excluded.chat_id_cipher, linked_at = excluded.linked_at`,
      )
      .run(candidateId, sealedText.seal(chatId, telegramChatAssociatedData(candidateId)), now);
  }

  unlinkTelegramChat(candidateId: string): boolean {
    this.database.prepare('DELETE FROM candidate_notification_telegram_link_codes WHERE candidate_id = ?').run(candidateId);
    return Number(
      this.database.prepare('DELETE FROM candidate_notification_telegram_chats WHERE candidate_id = ?').run(candidateId).changes,
    ) > 0;
  }

  getTelegramChat(candidateId: string): string | null {
    const row = this.database
      .prepare('SELECT chat_id_cipher FROM candidate_notification_telegram_chats WHERE candidate_id = ?')
      .get(candidateId) as { chat_id_cipher: string } | undefined;
    return row ? this.requireSealedText().open(row.chat_id_cipher, telegramChatAssociatedData(candidateId)) : null;
  }

  getTelegramLinkStatus(candidateId: string): { readonly connected: boolean; readonly linkedAt: string | null } {
    const row = this.database
      .prepare('SELECT linked_at FROM candidate_notification_telegram_chats WHERE candidate_id = ?')
      .get(candidateId) as { linked_at: string } | undefined;
    return { connected: Boolean(row), linkedAt: row?.linked_at ?? null };
  }

  createTelegramLinkCode(candidateId: string, codeHash: string, expiresAt: string, now = new Date().toISOString()): void {
    this.database
      .prepare(
        `INSERT INTO candidate_notification_telegram_link_codes (candidate_id, code_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?) ON CONFLICT(candidate_id) DO UPDATE SET
         code_hash = excluded.code_hash, expires_at = excluded.expires_at, created_at = excluded.created_at`,
      )
      .run(candidateId, codeHash, expiresAt, now);
  }

  consumeTelegramLinkCode(codeHash: string, chatId: string, now = new Date().toISOString()): string | null {
    const row = this.database
      .prepare('SELECT candidate_id FROM candidate_notification_telegram_link_codes WHERE code_hash = ? AND expires_at > ?')
      .get(codeHash, now) as { candidate_id: string } | undefined;
    if (!row) return null;
    this.database.exec('SAVEPOINT consume_telegram_link');
    try {
      const result = this.database
        .prepare('DELETE FROM candidate_notification_telegram_link_codes WHERE candidate_id = ? AND code_hash = ? AND expires_at > ?')
        .run(row.candidate_id, codeHash, now);
      if (Number(result.changes) === 0) {
        this.database.exec('RELEASE SAVEPOINT consume_telegram_link');
        return null;
      }
      this.linkTelegramChat(row.candidate_id, chatId, now);
      this.database.exec('RELEASE SAVEPOINT consume_telegram_link');
      return row.candidate_id;
    } catch (error) {
      this.database.exec('ROLLBACK TO SAVEPOINT consume_telegram_link');
      this.database.exec('RELEASE SAVEPOINT consume_telegram_link');
      throw error;
    }
  }

  claimDueDeliveries(now: string, limit: number): ClaimedNotificationDelivery[] {
    const batchSize = Math.max(1, Math.min(100, Math.trunc(limit)));
    const staleAt = new Date(Date.parse(now) - 10 * 60 * 1_000).toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(
        `UPDATE candidate_notification_deliveries SET status = 'pending', next_attempt_at = ?, updated_at = ?
         WHERE status = 'sending' AND updated_at <= ?`,
      ).run(now, now, staleAt);
      const rows = this.database.prepare(
        `SELECT d.notification_id, d.candidate_id, d.channel, d.attempts,
                n.id, n.event_kind, n.source_id, n.created_at, n.expires_at, n.read_at
         FROM candidate_notification_deliveries d
         JOIN candidate_notifications n ON n.id = d.notification_id AND n.candidate_id = d.candidate_id
         WHERE d.status = 'pending' AND d.next_attempt_at <= ? AND n.expires_at > ?
         ORDER BY d.next_attempt_at, d.notification_id, d.channel LIMIT ?`,
      ).all(now, now, batchSize) as unknown as DeliveryRow[];
      const claimed: DeliveryRow[] = [];
      for (const row of rows) {
        const updated = this.database.prepare(
          `UPDATE candidate_notification_deliveries SET status = 'sending', attempts = attempts + 1, updated_at = ?
           WHERE notification_id = ? AND channel = ? AND status = 'pending'`,
        ).run(now, row.notification_id, row.channel);
        if (Number(updated.changes) > 0) claimed.push(row);
      }
      this.database.exec('COMMIT');
      return claimed.map((row) => ({
      candidateId: row.candidate_id,
      notificationId: row.notification_id,
      channel: row.channel,
      attempt: row.attempts + 1,
      notification: this.toItem(row),
      }));
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  completeDelivery(
    candidateId: string,
    notificationId: string,
    channel: NotificationDeliveryChannel,
    providerId: string | null,
    now = new Date().toISOString(),
  ): void {
    this.database.prepare(
      `UPDATE candidate_notification_deliveries SET status = 'delivered', provider_id = ?, last_error_code = NULL, updated_at = ?
       WHERE candidate_id = ? AND notification_id = ? AND channel = ? AND status = 'sending'`,
    ).run(providerId, now, candidateId, notificationId, channel);
  }

  retryDelivery(
    candidateId: string,
    notificationId: string,
    channel: NotificationDeliveryChannel,
    errorCode: string,
    now = new Date().toISOString(),
  ): void {
    const row = this.database.prepare(
      `SELECT attempts FROM candidate_notification_deliveries
       WHERE candidate_id = ? AND notification_id = ? AND channel = ? AND status = 'sending'`,
    ).get(candidateId, notificationId, channel) as { attempts: number } | undefined;
    if (!row) return;
    const status = row.attempts >= 5 ? 'failed' : 'pending';
    const delayMinutes = Math.min(360, 2 ** row.attempts);
    const nextAttempt = new Date(Date.parse(now) + delayMinutes * 60 * 1_000).toISOString();
    const safeError = /^[a-z0-9_-]{1,48}$/u.test(errorCode) ? errorCode : 'delivery_failed';
    this.database.prepare(
      `UPDATE candidate_notification_deliveries SET status = ?, next_attempt_at = ?, last_error_code = ?, updated_at = ?
       WHERE candidate_id = ? AND notification_id = ? AND channel = ? AND status = 'sending'`,
    ).run(status, nextAttempt, safeError, now, candidateId, notificationId, channel);
  }

  skipDelivery(
    candidateId: string,
    notificationId: string,
    channel: NotificationDeliveryChannel,
    now = new Date().toISOString(),
  ): void {
    this.database.prepare(
      `UPDATE candidate_notification_deliveries SET status = 'skipped', updated_at = ?
       WHERE candidate_id = ? AND notification_id = ? AND channel = ? AND status = 'sending'`,
    ).run(now, candidateId, notificationId, channel);
  }

  issueUnsubscribeToken(candidateId: string, tokenHash: string, expiresAt: string, now = new Date().toISOString()): void {
    this.database.prepare(
      `INSERT INTO candidate_notification_unsubscribe_tokens (candidate_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?) ON CONFLICT(token_hash) DO UPDATE SET
       expires_at = excluded.expires_at, created_at = excluded.created_at`,
    ).run(candidateId, tokenHash, expiresAt, now);
  }

  unsubscribeEmail(tokenHash: string, now = new Date().toISOString()): boolean {
    const row = this.database.prepare(
      'SELECT candidate_id FROM candidate_notification_unsubscribe_tokens WHERE token_hash = ? AND expires_at > ?',
    ).get(tokenHash, now) as { candidate_id: string } | undefined;
    if (!row) return false;
    this.database.exec('SAVEPOINT unsubscribe_notification_email');
    try {
      const deleted = this.database.prepare(
        'DELETE FROM candidate_notification_unsubscribe_tokens WHERE candidate_id = ? AND token_hash = ? AND expires_at > ?',
      ).run(row.candidate_id, tokenHash, now);
      if (Number(deleted.changes) === 0) {
        this.database.exec('RELEASE SAVEPOINT unsubscribe_notification_email');
        return false;
      }
      for (const preference of this.getPreferences(row.candidate_id)) {
        this.setPreference(row.candidate_id, preference.key, { ...preference, email: false }, now);
      }
      this.database.exec('RELEASE SAVEPOINT unsubscribe_notification_email');
      return true;
    } catch (error) {
      this.database.exec('ROLLBACK TO SAVEPOINT unsubscribe_notification_email');
      this.database.exec('RELEASE SAVEPOINT unsubscribe_notification_email');
      throw error;
    }
  }

  deleteExpired(now = new Date().toISOString()): number {
    const candidatesTable = this.database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'candidates'")
      .get();
    if (!candidatesTable) return 0;
    const removed = Number(this.database
      .prepare('DELETE FROM candidate_notifications WHERE expires_at <= ?')
      .run(now).changes);
    this.database.prepare('DELETE FROM candidate_notification_unsubscribe_tokens WHERE expires_at <= ?').run(now);
    this.database.prepare('DELETE FROM candidate_notification_telegram_link_codes WHERE expires_at <= ?').run(now);
    return removed;
  }

  deleteByCandidate(candidateId: string): number {
    const removed = Number(this.database
      .prepare('DELETE FROM candidate_notifications WHERE candidate_id = ?')
      .run(candidateId).changes);
    this.database
      .prepare('DELETE FROM candidate_notification_preferences WHERE candidate_id = ?')
      .run(candidateId);
    this.database.prepare('DELETE FROM candidate_notification_telegram_preferences WHERE candidate_id = ?').run(candidateId);
    this.database.prepare('DELETE FROM candidate_notification_telegram_chats WHERE candidate_id = ?').run(candidateId);
    this.database.prepare('DELETE FROM candidate_notification_telegram_link_codes WHERE candidate_id = ?').run(candidateId);
    this.database.prepare('DELETE FROM candidate_notification_unsubscribe_tokens WHERE candidate_id = ?').run(candidateId);
    return removed;
  }

  close(): void {
    clearInterval(this.retentionSweep);
    if (this.ownsDatabase) this.database.close();
  }

  private enqueueSelectedChannels(
    candidateId: string,
    notificationId: string,
    kind: NotificationEventKind,
    now: string,
  ): void {
    const key = notificationPreferenceKey(kind);
    if (!key) return;
    const preference = this.getPreferences(candidateId).find((item) => item.key === key);
    if (!preference) return;
    if (preference.email) this.enqueue(candidateId, notificationId, 'email', now);
    if (preference.telegram && this.getTelegramChat(candidateId) !== null) {
      this.enqueue(candidateId, notificationId, 'telegram', now);
    }
  }

  private enqueue(candidateId: string, notificationId: string, channel: NotificationDeliveryChannel, now: string): void {
    this.database.prepare(
      `INSERT INTO candidate_notification_deliveries
        (notification_id, candidate_id, channel, status, attempts, next_attempt_at, updated_at)
       VALUES (?, ?, ?, 'pending', 0, ?, ?) ON CONFLICT(notification_id, channel) DO NOTHING`,
    ).run(notificationId, candidateId, channel, now, now);
  }

  private requireSealedText(): SealedText {
    if (!this.sealedText) throw new Error('notification_encryption_unavailable');
    return this.sealedText;
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

function telegramChatAssociatedData(candidateId: string): string {
  return `candidate-notification-telegram-chat:v1:${candidateId}`;
}
