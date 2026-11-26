import type { DatabaseSync } from 'node:sqlite';
import type { DeliveryFrequency } from '../notifications/deliverySchedule';

/**
 * n02: «Как часто» присылать почту и Telegram и «Не показывать название компании». Одна строка
 * на кандидата; пока строки нет — сразу и с названием. 09:00 сводки считаются по поясу из
 * «Приложения» (аккаунт кандидата), его доставка читает при отправке.
 */
export const MIGRATION_DELIVERY_SETTINGS = `
CREATE TABLE IF NOT EXISTS candidate_notification_delivery_settings (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL CHECK (frequency IN ('immediate', 'daily', 'weekly')),
  hide_company INTEGER NOT NULL CHECK (hide_company IN (0, 1)),
  updated_at TEXT NOT NULL
) STRICT;
`;

export interface DeliverySettings {
  readonly frequency: DeliveryFrequency;
  readonly hideCompany: boolean;
}

export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = {
  frequency: 'immediate',
  hideCompany: false,
};

interface SettingsRow {
  frequency: DeliveryFrequency;
  hide_company: number;
}

export function readDeliverySettings(database: DatabaseSync, candidateId: string): DeliverySettings {
  const row = database
    .prepare(
      `SELECT frequency, hide_company
       FROM candidate_notification_delivery_settings WHERE candidate_id = ?`,
    )
    .get(candidateId) as SettingsRow | undefined;
  if (!row) return DEFAULT_DELIVERY_SETTINGS;
  return { frequency: row.frequency, hideCompany: row.hide_company === 1 };
}

export function writeDeliverySettings(
  database: DatabaseSync,
  candidateId: string,
  settings: DeliverySettings,
  now: string,
): DeliverySettings {
  database
    .prepare(
      `INSERT INTO candidate_notification_delivery_settings
        (candidate_id, frequency, hide_company, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(candidate_id) DO UPDATE SET
         frequency = excluded.frequency,
         hide_company = excluded.hide_company,
         updated_at = excluded.updated_at`,
    )
    .run(candidateId, settings.frequency, settings.hideCompany ? 1 : 0, now);
  return readDeliverySettings(database, candidateId);
}

/**
 * Доставка ждёт сводки: снова `pending` до `until`, попытка, взятая при выдаче, возвращается —
 * ожидание сводки не сбой провайдера и не приближает отказ после пяти попыток.
 */
export function deferDeliveryUntil(
  database: DatabaseSync,
  input: {
    readonly candidateId: string;
    readonly notificationId: string;
    readonly channel: string;
    readonly until: string;
    readonly now: string;
  },
): void {
  database
    .prepare(
      `UPDATE candidate_notification_deliveries
       SET status = 'pending', next_attempt_at = ?, attempts = MAX(attempts - 1, 0), updated_at = ?
       WHERE candidate_id = ? AND notification_id = ? AND channel = ? AND status = 'sending'`,
    )
    .run(input.until, input.now, input.candidateId, input.notificationId, input.channel);
}
