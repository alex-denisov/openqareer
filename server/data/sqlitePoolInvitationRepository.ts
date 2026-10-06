import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { MIGRATION_42 } from './poolInvitationSchema';

export type PoolInvitationStatus = 'planned' | 'sent' | 'accepted' | 'pending' | 'declined' | 'failed';

export interface PoolInvitationCounters {
  readonly sentLast7d: number;
  readonly sentToday: number;
  readonly sentLast30d: number;
  readonly acceptedLast30d: number;
  readonly pending: number;
}

export interface CompanyVisibility {
  readonly company: string;
  readonly invited: number;
  readonly accepted: number;
  readonly share: number;
}

const DAY_MS = 86_400_000;
/** Статусы, при которых приглашение реально ушло на площадку. */
const DELIVERED = `('sent','accepted','pending','declined')`;

export const hashInvitationTarget = (profileUrl: string): string =>
  createHash('sha256').update(profileUrl.trim().toLowerCase()).digest('hex').slice(0, 32);

/** Журнал приглашений пула (B374). Отправки здесь нет — только учёт. */
export class SqlitePoolInvitationRepository {
  constructor(private readonly database: DatabaseSync) {
    this.database.exec(MIGRATION_42);
  }

  /** false — эту цель аккаунт уже приглашал (повторно не приглашаем). */
  plan(accountId: string, profileUrl: string, company: string, kind: string, now: Date): number | null {
    const stamp = now.toISOString();
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO linkedin_pool_invitations
         (account_id, target_hash, company, kind, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'planned', ?, ?)`,
      )
      .run(accountId, hashInvitationTarget(profileUrl), company, kind, stamp, stamp);
    return result.changes === 1 ? Number(result.lastInsertRowid) : null;
  }

  setStatus(id: number, status: PoolInvitationStatus, now: Date): void {
    this.database
      .prepare('UPDATE linkedin_pool_invitations SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now.toISOString(), id);
  }

  invitedHashes(accountId: string): ReadonlySet<string> {
    const rows = this.database
      .prepare('SELECT target_hash FROM linkedin_pool_invitations WHERE account_id = ?')
      .all(accountId) as Array<{ target_hash: string }>;
    return new Set(rows.map((row) => row.target_hash));
  }

  /** Счётчики для политики; `dayStart` — начало локальных суток аккаунта. */
  counters(accountId: string, now: Date, dayStart: Date): PoolInvitationCounters {
    const since = (days: number): string => new Date(now.getTime() - days * DAY_MS).toISOString();
    const count = (where: string, ...params: string[]): number =>
      (
        this.database
          .prepare(
            `SELECT COUNT(*) AS n FROM linkedin_pool_invitations WHERE account_id = ? AND ${where}`,
          )
          .get(accountId, ...params) as { n: number }
      ).n;
    return {
      sentLast7d: count(`status IN ${DELIVERED} AND created_at >= ?`, since(7)),
      sentToday: count(`status IN ${DELIVERED} AND created_at >= ?`, dayStart.toISOString()),
      sentLast30d: count(`status IN ${DELIVERED} AND created_at >= ?`, since(30)),
      acceptedLast30d: count(`status = 'accepted' AND created_at >= ?`, since(30)),
      pending: count(`status IN ('sent','pending')`),
    };
  }

  /** Отчёт: доля принявших (профиль стал виден) среди доставленных, по компаниям. */
  visibilityByCompany(accountId: string): readonly CompanyVisibility[] {
    const rows = this.database
      .prepare(
        `SELECT company, COUNT(*) AS invited,
           SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted
         FROM linkedin_pool_invitations
         WHERE account_id = ? AND status IN ${DELIVERED}
         GROUP BY company ORDER BY company`,
      )
      .all(accountId) as Array<{ company: string; invited: number; accepted: number }>;
    return rows.map((row) => ({ ...row, share: row.invited === 0 ? 0 : row.accepted / row.invited }));
  }
}
