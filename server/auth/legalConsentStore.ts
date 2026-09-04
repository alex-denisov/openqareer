import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { retentionCutoffFor } from '../domain/dataRetention';

/**
 * B173 хранит доказательство акцепта, B195 / PRB-014 — следит, чтобы оно не
 * жило дольше опубликованного срока. Обе задачи про одну таблицу, поэтому
 * работа с ней лежит здесь, а не в теле `AuthService`.
 */
export interface LegalConsentRecord {
  readonly versionId: string;
  readonly documents: readonly string[];
  readonly acceptedAt: string;
  readonly contractEndedAt: string | null;
}

export interface RetentionSweepResult {
  readonly consents: number;
  readonly securityLog: number;
}

interface ConsentRow {
  version_id: string;
  documents: string;
  accepted_at: string;
  contract_ended_at: string | null;
}

/** Документы хранятся строкой JSON; повреждённая строка не роняет чтение. */
function parseConsentDocuments(raw: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

export function recordLegalConsent(
  database: DatabaseSync,
  input: {
    userId: string;
    versionId: string;
    documents: readonly string[];
    acceptedAt?: string;
    contractEndedAt?: string;
  },
): void {
  database
    .prepare(
      `INSERT INTO legal_consents
         (id, user_id, version_id, documents, accepted_at, contract_ended_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      input.userId,
      input.versionId,
      JSON.stringify([...input.documents]),
      input.acceptedAt ?? new Date().toISOString(),
      input.contractEndedAt ?? null,
    );
}

/**
 * Записи акцепта одного пользователя. Существуют ради доказательства, что и
 * когда было принято, поэтому переживают удаление аккаунта — но не дольше
 * опубликованного срока.
 */
export function listConsents(
  database: DatabaseSync,
  userId: string,
): readonly LegalConsentRecord[] {
  const rows = database
    .prepare(
      `SELECT version_id, documents, accepted_at, contract_ended_at
         FROM legal_consents WHERE user_id = ? ORDER BY accepted_at`,
    )
    .all(userId) as unknown as readonly ConsentRow[];
  return rows.map((row) => ({
    versionId: row.version_id,
    documents: parseConsentDocuments(row.documents),
    acceptedAt: row.accepted_at,
    contractEndedAt: row.contract_ended_at,
  }));
}

/** Дата прекращения договора — точка отсчёта опубликованных трёх лет. */
export function stampContractEnd(database: DatabaseSync, userId: string, endedAt: string): void {
  database
    .prepare(
      `UPDATE legal_consents SET contract_ended_at = ?
        WHERE user_id = ? AND contract_ended_at IS NULL`,
    )
    .run(endedAt, userId);
}

/**
 * Уборка по опубликованной таблице сроков. Числа берутся из
 * `RETENTION_POLICIES`, а не пишутся здесь заново: иначе текст политики и
 * поведение уборщика снова разошлись бы.
 */
export function purgeExpiredRetention(
  database: DatabaseSync,
  now: string = new Date().toISOString(),
  limit = 500,
): RetentionSweepResult {
  const consentCutoff = retentionCutoffFor('записи об акцепте юридических документов', now);
  const auditCutoff = retentionCutoffFor('журналы безопасности', now);

  // Аккаунты, удалённые до B195, оставили согласия без даты прекращения —
  // считать три года было бы не от чего. Договор с исчезнувшим пользователем
  // прекращён; отметка ставится в момент первой уборки, потому что настоящей
  // даты удаления в данных не осталось.
  database
    .prepare(
      `UPDATE legal_consents SET contract_ended_at = ?
        WHERE contract_ended_at IS NULL
          AND user_id NOT IN (SELECT id FROM users)`,
    )
    .run(now);

  let consents = 0;
  if (consentCutoff) {
    consents = database
      .prepare(
        `DELETE FROM legal_consents
          WHERE id IN (
            SELECT id FROM legal_consents
             WHERE contract_ended_at IS NOT NULL
               AND contract_ended_at < ?
             LIMIT ?
          )`,
      )
      .run(consentCutoff, limit).changes as number;
  }

  let securityLog = 0;
  if (auditCutoff) {
    securityLog = database
      .prepare(
        `DELETE FROM admin_audit
          WHERE id IN (
            SELECT id FROM admin_audit WHERE created_at < ? LIMIT ?
          )`,
      )
      .run(auditCutoff, limit).changes as number;
  }

  return { consents, securityLog };
}
