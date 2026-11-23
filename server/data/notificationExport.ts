import type { DatabaseSync } from 'node:sqlite';
import type { NotificationEventKind, NotificationPreference } from './notificationPolicy';
import { readInvitationPreference, type InvitationChannels } from './notificationInvitationPreference';
import type { SqliteNotificationRepository } from './sqliteNotificationRepository';

/** B738 · 2: чем уведомления читаются из хранилища — теми же методами, что у экрана настроек. */
export interface NotificationExportStore {
  readonly notificationRepository: Pick<
    SqliteNotificationRepository,
    'getPreferences' | 'getTelegramChat' | 'getTelegramLinkStatus'
  >;
}

export interface ExportedNotificationDelivery {
  readonly channel: 'email' | 'telegram';
  readonly status: string;
  readonly attempts: number;
  readonly updatedAt: string;
  readonly lastErrorCode: string | null;
}

/** Уведомление без служебного ключа повтора; доставки без номера сообщения у почтового провайдера. */
export interface ExportedNotification {
  readonly id: string;
  readonly kind: NotificationEventKind;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly readAt: string | null;
  readonly invitation: boolean;
  readonly deliveries: readonly ExportedNotificationDelivery[];
}

export interface NotificationExport {
  readonly items: readonly ExportedNotification[];
  readonly preferences: readonly NotificationPreference[];
  /** Отдельная настройка «Приглашения»; null — кандидат её не менял. */
  readonly invitationPreference: InvitationChannels | null;
  /** Привязанный чат Telegram; null — не привязан. */
  /** Привязан ли Telegram и когда; номер чата бота — служебный и не выгружается (B738 · 7). */
  readonly telegram: { readonly linked: true; readonly linkedAt: string | null } | null;
}

interface NotificationRow {
  id: string;
  event_kind: NotificationEventKind;
  source_type: string;
  source_id: string;
  created_at: string;
  expires_at: string;
  read_at: string | null;
  invitation: number;
}

interface DeliveryRow {
  notification_id: string;
  channel: 'email' | 'telegram';
  status: string;
  attempts: number;
  updated_at: string;
  last_error_code: string | null;
}

function readDeliveries(database: DatabaseSync, candidateId: string): Map<string, ExportedNotificationDelivery[]> {
  const rows = database
    .prepare(
      `SELECT notification_id, channel, status, attempts, updated_at, last_error_code
       FROM candidate_notification_deliveries WHERE candidate_id = ? ORDER BY notification_id, channel`,
    )
    .all(candidateId) as unknown as DeliveryRow[];
  const byNotification = new Map<string, ExportedNotificationDelivery[]>();
  for (const row of rows) {
    const delivery = {
      channel: row.channel,
      status: row.status,
      attempts: row.attempts,
      updatedAt: row.updated_at,
      lastErrorCode: row.last_error_code,
    };
    byNotification.set(row.notification_id, [...(byNotification.get(row.notification_id) ?? []), delivery]);
  }
  return byNotification;
}

function readNotifications(database: DatabaseSync, candidateId: string): ExportedNotification[] {
  const deliveries = readDeliveries(database, candidateId);
  const rows = database
    .prepare(
      `SELECT n.id, n.event_kind, n.source_type, n.source_id, n.created_at, n.expires_at, n.read_at,
         EXISTS (SELECT 1 FROM candidate_notification_invitation_events i WHERE i.notification_id = n.id) AS invitation
       FROM candidate_notifications n WHERE n.candidate_id = ? ORDER BY n.created_at DESC, n.id DESC`,
    )
    .all(candidateId) as unknown as NotificationRow[];
  return rows.map((row) => ({
    id: row.id,
    kind: row.event_kind,
    sourceType: row.source_type,
    sourceId: row.source_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    readAt: row.read_at,
    invitation: row.invitation === 1,
    deliveries: deliveries.get(row.id) ?? [],
  }));
}

export function exportNotifications(
  database: DatabaseSync,
  store: NotificationExportStore,
  candidateId: string,
): NotificationExport {
  const repository = store.notificationRepository;
  const chatId = repository.getTelegramChat(candidateId);
  return {
    items: readNotifications(database, candidateId),
    preferences: repository.getPreferences(candidateId),
    invitationPreference: readInvitationPreference(database, candidateId),
    telegram: chatId === null ? null : { linked: true, linkedAt: repository.getTelegramLinkStatus(candidateId).linkedAt },
  };
}
