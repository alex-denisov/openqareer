import type { DatabaseSync } from 'node:sqlite';

/**
 * B671: ключ настройки «Приглашения» (N02). У `preference_key` в прежних таблицах стоит CHECK,
 * а база по условию карточки меняется только добавлением, поэтому ключ живёт в своей таблице.
 * Пока строки нет, приглашения идут по ключу «Ответы» — как было до карточки.
 * Вторая таблица отмечает, какие уведомления об ответе были приглашением или оффером в момент
 * записи: по ней доставка на почту и в Telegram сверяет нужный ключ при отправке.
 */
export const MIGRATION_INVITATION_PREFERENCE = `
CREATE TABLE IF NOT EXISTS candidate_notification_invitation_preferences (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  app_enabled INTEGER NOT NULL CHECK (app_enabled IN (0, 1)),
  email_enabled INTEGER NOT NULL CHECK (email_enabled IN (0, 1)),
  telegram_enabled INTEGER NOT NULL CHECK (telegram_enabled IN (0, 1)),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS candidate_notification_invitation_events (
  notification_id TEXT PRIMARY KEY REFERENCES candidate_notifications(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE
) STRICT;
`;

export interface InvitationChannels {
  readonly app: boolean;
  readonly email: boolean;
  readonly telegram: boolean;
}

interface InvitationRow {
  app_enabled: number;
  email_enabled: number;
  telegram_enabled: number;
}

export function readInvitationPreference(
  database: DatabaseSync,
  candidateId: string,
): InvitationChannels | null {
  const row = database
    .prepare(
      `SELECT app_enabled, email_enabled, telegram_enabled
       FROM candidate_notification_invitation_preferences WHERE candidate_id = ?`,
    )
    .get(candidateId) as InvitationRow | undefined;
  if (!row) return null;
  return {
    app: row.app_enabled === 1,
    email: row.email_enabled === 1,
    telegram: row.telegram_enabled === 1,
  };
}

export function writeInvitationPreference(
  database: DatabaseSync,
  candidateId: string,
  channels: InvitationChannels,
  now: string,
): void {
  database
    .prepare(
      `INSERT INTO candidate_notification_invitation_preferences
        (candidate_id, app_enabled, email_enabled, telegram_enabled, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(candidate_id) DO UPDATE SET
         app_enabled = excluded.app_enabled,
         email_enabled = excluded.email_enabled,
         telegram_enabled = excluded.telegram_enabled,
         updated_at = excluded.updated_at`,
    )
    .run(
      candidateId,
      channels.app ? 1 : 0,
      channels.email ? 1 : 0,
      channels.telegram ? 1 : 0,
      now,
    );
}

/** Отписка по ссылке из письма выключает почту и для приглашений, если ключ сохранён. */
export function disableInvitationEmail(database: DatabaseSync, candidateId: string, now: string): void {
  database
    .prepare(
      `UPDATE candidate_notification_invitation_preferences
       SET email_enabled = 0, updated_at = ? WHERE candidate_id = ?`,
    )
    .run(now, candidateId);
}

export function markInvitationEvent(
  database: DatabaseSync,
  candidateId: string,
  notificationId: string,
): void {
  database
    .prepare(
      `INSERT INTO candidate_notification_invitation_events (notification_id, candidate_id)
       VALUES (?, ?) ON CONFLICT(notification_id) DO NOTHING`,
    )
    .run(notificationId, candidateId);
}

export function isInvitationEvent(database: DatabaseSync, notificationId: string): boolean {
  return (
    database
      .prepare('SELECT 1 FROM candidate_notification_invitation_events WHERE notification_id = ?')
      .get(notificationId) !== undefined
  );
}

export function deleteInvitationRows(database: DatabaseSync, candidateId: string): void {
  database
    .prepare('DELETE FROM candidate_notification_invitation_events WHERE candidate_id = ?')
    .run(candidateId);
  database
    .prepare('DELETE FROM candidate_notification_invitation_preferences WHERE candidate_id = ?')
    .run(candidateId);
}
