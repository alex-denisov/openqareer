/**
 * B621: очередь и статусы поиска LinkedIn organization ID.
 *
 * Пишет только свою таблицу `company_linkedin_resolution` и столбцы
 * `linkedin_url` / `linkedin_org_id` реестра — и только когда ID пуст
 * (compare-and-set: уже записанный ID никогда не перезаписывается).
 */
import type { DatabaseSync } from 'node:sqlite';
import { COMPANY_DIRECTORY_MIGRATION } from '../../data/companyDirectorySchema';

export type ResolutionStatus = 'resolved' | 'no_page' | 'ambiguous' | 'retry_after';

export interface QueueRow {
  readonly companyKey: string;
  readonly companyName: string;
  readonly websiteUrl: string | null;
  readonly careersUrl: string | null;
  readonly linkedinUrl: string | null;
}

export interface ResolutionOutcome {
  readonly status: ResolutionStatus;
  readonly reason: string;
  readonly slug?: string;
  readonly orgId?: string;
  readonly evidenceUrl?: string;
  readonly retryAt?: string;
  /** Заменить неверную ссылку реестра подтверждённой по домену. */
  readonly replaceUrl?: boolean;
}

export const RESOLUTION_TABLE = 'company_linkedin_resolution';
const COOLDOWN_KEY = '__linkedin_guest_cooldown__';

/** Финальные статусы перепроверяются раз в этот срок: страницы и вакансии появляются. */
export const RECHECK_AFTER_DAYS = 30;

const MIGRATION = `
CREATE TABLE IF NOT EXISTS ${RESOLUTION_TABLE} (
  company_key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  slug TEXT,
  org_id TEXT,
  evidence_url TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  retry_at TEXT,
  checked_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_company_linkedin_resolution_retry ON ${RESOLUTION_TABLE}(retry_at);
`;

export class LinkedinOrgStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(COMPANY_DIRECTORY_MIGRATION);
    db.exec(MIGRATION);
  }

  /**
   * Следующая строка без ID: новые — первыми, затем просроченные повторы.
   * B645: только строки со ссылкой LinkedIn или сайтом (по нему резолвер ищет LinkedIn);
   * ~500 тыс. компаний freehire без того и другого в очередь не идут.
   */
  nextDue(now: Date): QueueRow | undefined {
    const iso = now.toISOString();
    const row = this.db
      .prepare(
        `SELECT d.company_key, d.company_name, d.website_url, d.careers_url, d.linkedin_url
         FROM company_directory d
         LEFT JOIN ${RESOLUTION_TABLE} r ON r.company_key = d.company_key
         WHERE (d.linkedin_org_id IS NULL OR d.linkedin_org_id = '')
           AND ((d.linkedin_url IS NOT NULL AND d.linkedin_url <> '') OR (d.website_url IS NOT NULL AND d.website_url <> ''))
           AND (r.company_key IS NULL OR r.retry_at IS NULL OR r.retry_at <= ?)
         ORDER BY (r.company_key IS NOT NULL), r.retry_at, d.company_key
         LIMIT 1`,
      )
      .get(iso) as Record<string, string | null> | undefined;
    if (!row) return undefined;
    return {
      companyKey: row.company_key!,
      companyName: row.company_name!,
      websiteUrl: row.website_url ?? null,
      careersUrl: row.careers_url ?? null,
      linkedinUrl: row.linkedin_url ?? null,
    };
  }

  record(companyKey: string, outcome: ResolutionOutcome, now: Date): void {
    const retryAt =
      outcome.retryAt ?? new Date(now.getTime() + RECHECK_AFTER_DAYS * 86_400_000).toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          `INSERT INTO ${RESOLUTION_TABLE}
             (company_key, status, reason, slug, org_id, evidence_url, attempts, retry_at, checked_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
           ON CONFLICT(company_key) DO UPDATE SET
             status = excluded.status, reason = excluded.reason, slug = excluded.slug,
             org_id = excluded.org_id, evidence_url = excluded.evidence_url,
             attempts = ${RESOLUTION_TABLE}.attempts + 1,
             retry_at = excluded.retry_at, checked_at = excluded.checked_at`,
        )
        .run(
          companyKey,
          outcome.status,
          outcome.reason,
          outcome.slug ?? null,
          outcome.orgId ?? null,
          outcome.evidenceUrl ?? null,
          outcome.status === 'resolved' ? null : retryAt,
          now.toISOString(),
        );
      if (outcome.status === 'resolved' && outcome.orgId && outcome.slug) {
        this.db
          .prepare(
            `UPDATE company_directory SET
               linkedin_org_id = ?,
               linkedin_url = CASE WHEN ? = 1 OR linkedin_url IS NULL OR linkedin_url = '' THEN ? ELSE linkedin_url END,
               updated_at = ?
             WHERE company_key = ? AND (linkedin_org_id IS NULL OR linkedin_org_id = '')`,
          )
          .run(
            outcome.orgId,
            outcome.replaceUrl ? 1 : 0,
            `https://www.linkedin.com/company/${outcome.slug}/jobs/`,
            now.toISOString(),
            companyKey,
          );
      }
      this.db.exec('COMMIT');
    } catch (error: unknown) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Общая пауза LinkedIn-запросов: переживает перезапуск процесса. */
  cooldownUntil(): { until: Date; strikes: number } | undefined {
    const row = this.db
      .prepare(`SELECT retry_at, attempts FROM ${RESOLUTION_TABLE} WHERE company_key = ?`)
      .get(COOLDOWN_KEY) as { retry_at: string | null; attempts: number } | undefined;
    if (!row?.retry_at) return undefined;
    return { until: new Date(row.retry_at), strikes: row.attempts };
  }

  setCooldown(until: Date, strikes: number, reason: string, now: Date): void {
    this.db
      .prepare(
        `INSERT INTO ${RESOLUTION_TABLE} (company_key, status, reason, attempts, retry_at, checked_at)
         VALUES (?, 'retry_after', ?, ?, ?, ?)
         ON CONFLICT(company_key) DO UPDATE SET reason = excluded.reason,
           attempts = excluded.attempts, retry_at = excluded.retry_at, checked_at = excluded.checked_at`,
      )
      .run(COOLDOWN_KEY, reason, strikes, until.toISOString(), now.toISOString());
  }

  counts(): Record<string, number> {
    const rows = this.db
      .prepare(
        `SELECT status, COUNT(*) AS n FROM ${RESOLUTION_TABLE}
         WHERE company_key <> ? GROUP BY status`,
      )
      .all(COOLDOWN_KEY) as { status: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  }
}
