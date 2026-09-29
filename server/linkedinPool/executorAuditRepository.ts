import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type LinkedinPoolExecutorPageKind = 'company_search' | 'company_people';

export interface LinkedinPoolExecutorDailyUsage {
  readonly pageCount: number;
  readonly attemptedCompanyHashes: readonly string[];
  readonly lastPageAt: string | null;
}

const WORKER_ACTOR = { actorUserId: 'linkedin-pool-worker', actorUsername: 'maintenance' };
const COMPANY_HASH = /^[a-f0-9]{64}$/u;

/** Сохраняет stop-state в существующей схеме и сразу удаляет bearer cookies. */
export function markLinkedinPoolAccountNeedsReauth(
  database: DatabaseSync,
  accountId: string,
  reason: 'challenge_required' | 'expired' | 'login_required',
  now: Date,
): boolean {
  database.exec('BEGIN IMMEDIATE');
  try {
    const account = database
      .prepare('SELECT state FROM linkedin_pool_accounts WHERE id = ?')
      .get(accountId) as { state: string } | undefined;
    if (account?.state !== 'ready') {
      database.exec('ROLLBACK');
      return false;
    }
    const timestamp = now.toISOString();
    database
      .prepare(
        `UPDATE linkedin_pool_accounts SET state = 'user_action_required',
          last_failure_code = 'needs_reauth', last_heartbeat_at = ?, lease_until = NULL,
          revision = revision + 1, updated_at = ? WHERE id = ? AND state = 'ready'`,
      )
      .run(timestamp, timestamp, accountId);
    database.prepare('DELETE FROM linkedin_pool_sessions WHERE account_id = ?').run(accountId);
    insertAudit(database, 'needs_reauth', accountId, `reason=${reason}`, timestamp);
    database.exec('COMMIT');
    return true;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function recordLinkedinExecutorCompanyAttempt(
  database: DatabaseSync,
  accountId: string,
  companyHash: string,
  now: Date,
): void {
  assertCompanyHash(companyHash);
  insertAudit(database, 'linkedin_executor_company', accountId, companyHash, now.toISOString());
}

export function recordLinkedinExecutorPageAttempt(
  database: DatabaseSync,
  accountId: string,
  pageKind: LinkedinPoolExecutorPageKind,
  companyHash: string,
  now: Date,
): void {
  assertCompanyHash(companyHash);
  insertAudit(
    database,
    'linkedin_executor_page',
    accountId,
    `page=${pageKind};company=${companyHash}`,
    now.toISOString(),
  );
}

export function getLinkedinExecutorDailyUsage(
  database: DatabaseSync,
  accountId: string,
  since: string,
): LinkedinPoolExecutorDailyUsage {
  const rows = database
    .prepare(
      `SELECT action, detail, created_at FROM linkedin_pool_audit
       WHERE account_id = ? AND created_at >= ?
         AND action IN ('linkedin_executor_page', 'linkedin_executor_company')
       ORDER BY created_at ASC`,
    )
    .all(accountId, since) as Array<{ action: string; detail: string | null; created_at: string }>;
  const hashes = new Set<string>();
  let pageCount = 0;
  let lastPageAt: string | null = null;
  for (const row of rows) {
    if (row.action === 'linkedin_executor_company' && row.detail && COMPANY_HASH.test(row.detail)) {
      hashes.add(row.detail);
    }
    if (row.action === 'linkedin_executor_page') {
      pageCount += 1;
      lastPageAt = row.created_at;
    }
  }
  return { pageCount, attemptedCompanyHashes: [...hashes], lastPageAt };
}

function assertCompanyHash(companyHash: string): void {
  if (!COMPANY_HASH.test(companyHash)) throw new Error('linkedin_executor_company_hash_invalid');
}

function insertAudit(
  database: DatabaseSync,
  action: string,
  accountId: string,
  detail: string,
  createdAt: string,
): void {
  database
    .prepare(
      `INSERT INTO linkedin_pool_audit
        (id, actor_user_id, actor_username, action, account_id, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), WORKER_ACTOR.actorUserId, WORKER_ACTOR.actorUsername, action, accountId, detail, createdAt);
}
