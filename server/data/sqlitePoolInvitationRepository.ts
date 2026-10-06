import { createHmac, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { MIGRATION_42 } from './poolInvitationSchema';
import {
  INVITATION_LIMITS,
  planInvitations,
  canonicalizeInvitationProfileUrl,
  type InvitationAccountState,
} from '../linkedinPool/invitationBudgetPolicy';

export type PoolInvitationStatus = 'planned' | 'sent' | 'accepted' | 'pending' | 'declined' | 'failed';

export interface PoolInvitationCounters {
  readonly attemptedLast7d: number;
  readonly attemptedToday: number;
  readonly sentLast30d: number;
  readonly acceptedLast30d: number;
  readonly pending: number;
}

export interface PoolInvitationAccountState {
  readonly id: string;
  readonly state: string;
  readonly createdAt: string;
  readonly leaseUntil: string | null;
}

export interface PoolInvitationReservation {
  readonly id: number | null;
  readonly reason: string | null;
  readonly remaining: number;
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

export function hashInvitationTarget(profileUrl: string, key: Buffer): string {
  if (key.length < 32) throw new Error('linkedin_pool_hash_key_too_short');
  const canonical = canonicalizeInvitationProfileUrl(profileUrl);
  if (!canonical) throw new Error('linkedin_pool_invitation_profile_url_invalid');
  return createHmac('sha256', key).update(canonical).digest('hex');
}

/** Журнал приглашений пула (B374). Отправки здесь нет — только учёт. */
export class SqlitePoolInvitationRepository {
  constructor(private readonly database: DatabaseSync) {
    this.database.exec(MIGRATION_42);
  }

  getDatabase(): DatabaseSync {
    return this.database;
  }

  /** false — эту цель аккаунт уже приглашал (повторно не приглашаем). */
  plan(
    accountId: string,
    profileUrl: string,
    company: string,
    kind: string,
    hashKey: Buffer,
    now: Date,
  ): number | null {
    return this.withImmediateTransaction(() =>
      this.insertPlanned(accountId, profileUrl, company, kind, hashKey, now),
    );
  }

  reserve(
    accountId: string,
    profileUrl: string,
    company: string,
    kind: string,
    hashKey: Buffer,
    now: Date,
    dayStart: Date,
    accountState: Pick<InvitationAccountState, 'accountAgeDays' | 'restricted' | 'windowOpen'>,
  ): PoolInvitationReservation {
    return this.withImmediateTransaction(() =>
      this.reserveInside(accountId, profileUrl, company, kind, hashKey, now, dayStart, accountState),
    );
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

  /** Счётчики лимита попыток; `dayStart` — начало локальных суток аккаунта. */
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
      attemptedLast7d: count('created_at >= ?', since(7)),
      attemptedToday: count('created_at >= ?', dayStart.toISOString()),
      sentLast30d: count(`status IN ${DELIVERED} AND created_at >= ?`, since(30)),
      acceptedLast30d: count(`status = 'accepted' AND created_at >= ?`, since(30)),
      pending: count(`status IN ('sent','pending')`),
    };
  }

  poolAccount(accountId: string): PoolInvitationAccountState | null {
    const row = this.database
      .prepare('SELECT id, state, created_at, lease_until FROM linkedin_pool_accounts WHERE id = ?')
      .get(accountId) as
      | { id: string; state: string; created_at: string; lease_until: string | null }
      | undefined;
    return row
      ? { id: row.id, state: row.state, createdAt: row.created_at, leaseUntil: row.lease_until }
      : null;
  }

  resumeInvitationCooldown(accountId: string, now: Date): PoolInvitationAccountState | null {
    this.withImmediateTransaction(() => {
      const account = this.poolAccount(accountId);
      if (!account || account.state !== 'cooling_down') return;
      if (account.leaseUntil && Date.parse(account.leaseUntil) > now.getTime()) return;
      this.database
        .prepare(
          `UPDATE linkedin_pool_accounts SET state = 'ready', lease_until = NULL,
             revision = revision + 1, updated_at = ? WHERE id = ? AND state = 'cooling_down'`,
        )
        .run(now.toISOString(), accountId);
      this.auditInvitationPause(accountId, 'linkedin_pool_invitation_cooldown_ended', now);
    });
    return this.poolAccount(accountId);
  }

  recordFailedAttemptAndPause(
    invitationId: number,
    accountId: string,
    now: Date,
    pauseMs: number,
  ): boolean {
    if (!Number.isFinite(pauseMs) || pauseMs <= 0) throw new Error('linkedin_invitation_pause_invalid');
    return this.withImmediateTransaction(() => {
      this.setStatus(invitationId, 'failed', now);
      const account = this.poolAccount(accountId);
      if (!account || account.state !== 'ready') return false;
      const pauseUntil = new Date(now.getTime() + pauseMs).toISOString();
      this.database
        .prepare(
          `UPDATE linkedin_pool_accounts SET state = 'cooling_down', lease_until = ?,
             revision = revision + 1, updated_at = ? WHERE id = ? AND state = 'ready'`,
        )
        .run(pauseUntil, now.toISOString(), accountId);
      this.auditInvitationPause(accountId, 'linkedin_pool_invitation_cooldown_started', now, pauseUntil);
      return true;
    });
  }

  purgeExpired(now: Date, retentionDays = 90): number {
    if (!Number.isInteger(retentionDays) || retentionDays <= 0) {
      throw new Error('linkedin_pool_invitation_retention_invalid');
    }
    const before = new Date(now.getTime() - retentionDays * DAY_MS).toISOString();
    return Number(
      this.database
        .prepare('DELETE FROM linkedin_pool_invitations WHERE created_at < ?')
        .run(before).changes,
    );
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

  invitedCountForCompany(accountId: string, company: string): number {
    return this.companyAttemptCount(accountId, company);
  }

  private reserveInside(
    accountId: string,
    profileUrl: string,
    company: string,
    kind: string,
    hashKey: Buffer,
    now: Date,
    dayStart: Date,
    accountState: Pick<InvitationAccountState, 'accountAgeDays' | 'restricted' | 'windowOpen'>,
  ): PoolInvitationReservation {
    if (this.poolAccount(accountId)?.state !== 'ready') {
      return { id: null, reason: 'account_not_ready', remaining: 0 };
    }
    const plan = planInvitations({
      ...accountState,
      ...this.counters(accountId, now, dayStart),
    });
    if (plan.allowed < 1) {
      return { id: null, reason: plan.reason ?? 'blocked', remaining: 0 };
    }
    if (this.companyAttemptCount(accountId, company) >= INVITATION_LIMITS.perCompany) {
      return { id: null, reason: 'company_cap', remaining: plan.allowed };
    }
    const id = this.insertPlanned(accountId, profileUrl, company, kind, hashKey, now);
    return id === null
      ? { id: null, reason: 'already_invited', remaining: plan.allowed }
      : { id, reason: null, remaining: plan.allowed - 1 };
  }

  private insertPlanned(
    accountId: string,
    profileUrl: string,
    company: string,
    kind: string,
    hashKey: Buffer,
    now: Date,
  ): number | null {
    const stamp = now.toISOString();
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO linkedin_pool_invitations
         (account_id, target_hash, company, kind, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'planned', ?, ?)`,
      )
      .run(accountId, hashInvitationTarget(profileUrl, hashKey), company.trim(), kind, stamp, stamp);
    return result.changes === 1 ? Number(result.lastInsertRowid) : null;
  }

  private companyAttemptCount(accountId: string, company: string): number {
    return (
      this.database
        .prepare(
          'SELECT COUNT(*) AS count FROM linkedin_pool_invitations WHERE account_id = ? AND lower(trim(company)) = lower(trim(?))',
        )
        .get(accountId, company.trim()) as { count: number }
    ).count;
  }

  private withImmediateTransaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.database.exec('ROLLBACK'); } catch { /* SQLite may already have rolled back. */ }
      throw error;
    }
  }

  private auditInvitationPause(
    accountId: string,
    action: string,
    now: Date,
    pauseUntil?: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO linkedin_pool_audit
         (id, actor_user_id, actor_username, action, account_id, detail, created_at)
         VALUES (?, 'linkedin-pool-worker', 'maintenance', ?, ?, ?, ?)`,
      )
      .run(randomUUID(), action, accountId, pauseUntil ? 'pause_until=' + pauseUntil : null, now.toISOString());
  }
}
