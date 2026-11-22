import type { DatabaseSync } from 'node:sqlite';

/** B755: ключ доступа в выгрузке — название устройства и даты; сам ключ и счётчик не выгружаются. */
export interface ExportedPasskey {
  readonly deviceLabel: string | null;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

/** Таблицы ключей создаёт хранилище ключей при первом обращении к маршруту: нет таблицы — нет ключей. */
export function exportPasskeys(database: DatabaseSync, candidateId: string): ExportedPasskey[] {
  const exists = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'user_passkeys'").get();
  if (!exists) return [];
  const rows = database
    .prepare(
      `SELECT p.device_label, p.created_at, p.last_used_at
       FROM user_passkeys p JOIN users u ON u.id = p.user_id
       WHERE u.candidate_id = ? ORDER BY p.created_at, p.id`,
    )
    .all(candidateId) as Array<{ device_label: string | null; created_at: string; last_used_at: string | null }>;
  return rows.map((row) => ({ deviceLabel: row.device_label, createdAt: row.created_at, lastUsedAt: row.last_used_at }));
}
