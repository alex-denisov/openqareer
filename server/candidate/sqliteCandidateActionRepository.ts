import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';
import type {
  CandidateActionKind,
  CandidateActionUsageSummary,
} from '../../shared/candidateActionPolicy';

export interface StoredActionReceipt {
  readonly id: string;
  readonly batchId: string;
  readonly candidateId: string;
  readonly platform: 'hh' | 'linkedin';
  readonly actionKind: CandidateActionKind;
  readonly status: 'pending' | 'delivered' | 'attempted' | 'failed';
  readonly applicationId?: string | null;
  readonly failureCode?: string | null;
  readonly executedAt: string;
  readonly createdAt: string;
}

export interface RecordActionReceiptInput {
  readonly id?: string;
  readonly batchId: string;
  readonly candidateId: string;
  readonly platform: 'hh' | 'linkedin';
  readonly actionKind: CandidateActionKind;
  readonly status: 'pending' | 'delivered' | 'attempted' | 'failed';
  readonly applicationId?: string | null;
  readonly failureCode?: string | null;
  readonly executedAt?: string;
}

interface ActionReceiptRow {
  id: string;
  batch_id: string;
  candidate_id: string;
  platform: 'hh' | 'linkedin';
  action_kind: CandidateActionKind;
  status: 'pending' | 'delivered' | 'attempted' | 'failed';
  application_id: string | null;
  target_url: string;
  confirmation_url: string | null;
  snapshot_hash: string | null;
  letter_version: string | null;
  letter_cipher: string | null;
  resume_version: string | null;
  resume_id: string | null;
  failure_code: string | null;
  executed_at: string;
  created_at: string;
}

interface DailyUsageRow {
  candidate_id: string;
  local_date: string;
  hh_applies_count: number;
  linkedin_easy_applies_count: number;
  hh_boosts_count: number;
  last_hh_boost_at: string | null;
}

export const CANDIDATE_ACTION_SCHEMA = `
CREATE TABLE IF NOT EXISTS candidate_action_batches (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'partial_failure', 'aborted')),
  confirmed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS candidate_action_receipts (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('hh', 'linkedin')),
  action_kind TEXT NOT NULL CHECK (action_kind IN ('hh_apply', 'hh_resume_boost', 'linkedin_easy_apply')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'attempted', 'failed')),
  application_id TEXT,
  target_url TEXT NOT NULL,
  confirmation_url TEXT,
  snapshot_hash TEXT,
  letter_version TEXT,
  letter_cipher TEXT,
  resume_version TEXT,
  resume_id TEXT,
  failure_code TEXT,
  executed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_candidate_action_receipts_cand
  ON candidate_action_receipts(candidate_id, executed_at DESC);

CREATE TABLE IF NOT EXISTS candidate_action_kill_switches (
  scope TEXT PRIMARY KEY,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  reason TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS candidate_action_daily_usage (
  candidate_id TEXT NOT NULL,
  local_date TEXT NOT NULL,
  hh_applies_count INTEGER NOT NULL DEFAULT 0,
  linkedin_easy_applies_count INTEGER NOT NULL DEFAULT 0,
  hh_boosts_count INTEGER NOT NULL DEFAULT 0,
  last_hh_boost_at TEXT,
  PRIMARY KEY (candidate_id, local_date)
) STRICT;
`;

export class SqliteCandidateActionRepository {
  private readonly database: DatabaseSync;
  private readonly ownsDatabase: boolean;

  constructor(options: DatabaseSync | { databasePath: string }) {
    if (options instanceof DatabaseSync) {
      this.database = options;
      this.ownsDatabase = false;
    } else {
      this.database = new DatabaseSync(options.databasePath);
      this.database.exec('PRAGMA journal_mode = WAL;');
      this.ownsDatabase = true;
    }
    applySqliteBusyTimeout(this.database);
    this.database.exec(CANDIDATE_ACTION_SCHEMA);
    this.migrateReceiptStatusConstraint();
    this.clearRetiredActionPayloads();
    this.normalizeStoredFailureCodes();
  }

  close(): void {
    if (this.ownsDatabase) {
      try {
        this.database.close();
      } catch {
        // Ignore if database is already closed
      }
    }
  }

  getDatabase(): DatabaseSync {
    return this.database;
  }

  private migrateReceiptStatusConstraint(): void {
    const row = this.database
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'candidate_action_receipts'")
      .get() as { sql?: string } | undefined;
    if (row?.sql?.includes("'failed'") && row.sql.includes("'pending'")) return;

    this.database.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE candidate_action_receipts RENAME TO candidate_action_receipts_legacy;
      CREATE TABLE candidate_action_receipts (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        candidate_id TEXT NOT NULL,
        platform TEXT NOT NULL CHECK (platform IN ('hh', 'linkedin')),
        action_kind TEXT NOT NULL CHECK (action_kind IN ('hh_apply', 'hh_resume_boost', 'linkedin_easy_apply')),
        status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'attempted', 'failed')),
        application_id TEXT,
        target_url TEXT NOT NULL,
        confirmation_url TEXT,
        snapshot_hash TEXT,
        letter_version TEXT,
        letter_cipher TEXT,
        resume_version TEXT,
        resume_id TEXT,
        failure_code TEXT,
        executed_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO candidate_action_receipts (
        id, batch_id, candidate_id, platform, action_kind, status, application_id,
        target_url, confirmation_url, snapshot_hash, letter_version, letter_cipher,
        resume_version, resume_id, failure_code, executed_at, created_at
      )
      SELECT id, batch_id, candidate_id, platform, action_kind, status, application_id,
        '', NULL, NULL, NULL, NULL, NULL, NULL, failure_code, executed_at, created_at
      FROM candidate_action_receipts_legacy;
      DROP TABLE candidate_action_receipts_legacy;
      CREATE INDEX IF NOT EXISTS idx_candidate_action_receipts_cand
        ON candidate_action_receipts(candidate_id, executed_at DESC);
      COMMIT;
    `);
  }

  /** Retired action payloads are unnecessary after the receipt is written. */
  private clearRetiredActionPayloads(): void {
    this.database
      .prepare(
        `UPDATE candidate_action_receipts
         SET target_url = '', confirmation_url = NULL, snapshot_hash = NULL,
             letter_version = NULL, letter_cipher = NULL, resume_version = NULL, resume_id = NULL
         WHERE target_url <> '' OR confirmation_url IS NOT NULL OR snapshot_hash IS NOT NULL
            OR letter_version IS NOT NULL OR letter_cipher IS NOT NULL
            OR resume_version IS NOT NULL OR resume_id IS NOT NULL`,
      )
      .run();
  }

  private normalizeStoredFailureCodes(): void {
    const rows = this.database
      .prepare('SELECT id, failure_code FROM candidate_action_receipts WHERE failure_code IS NOT NULL')
      .all() as Array<{ id: string; failure_code: string }>;
    const normalize = this.database.prepare(
      "UPDATE candidate_action_receipts SET failure_code = 'legacy_failure' WHERE id = ?",
    );
    for (const row of rows) {
      if (!/^[a-z][a-z0-9_]{0,63}$/u.test(row.failure_code)) normalize.run(row.id);
    }
  }

  isKillSwitchActive(platform?: 'hh' | 'linkedin', candidateId?: string): boolean {
    const scopes = ['global'];
    if (platform) scopes.push(`platform:${platform}`);
    if (candidateId) scopes.push(`candidate:${candidateId}`);

    const placeholders = scopes.map(() => '?').join(', ');
    const row = this.database
      .prepare(
        `SELECT 1 FROM candidate_action_kill_switches WHERE scope IN (${placeholders}) AND active = 1 LIMIT 1`,
      )
      .get(...scopes);
    return Boolean(row);
  }

  setKillSwitch(scope: string, active: boolean, reason?: string): void {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO candidate_action_kill_switches (scope, active, reason, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(scope) DO UPDATE SET
           active = excluded.active,
           reason = excluded.reason,
           updated_at = excluded.updated_at`,
      )
      .run(scope, active ? 1 : 0, reason ?? null, now);
  }

  getDailyUsage(candidateId: string, localDate: string): CandidateActionUsageSummary {
    const row = this.database
      .prepare(
        `SELECT * FROM candidate_action_daily_usage WHERE candidate_id = ? AND local_date = ?`,
      )
      .get(candidateId, localDate) as DailyUsageRow | undefined;

    if (!row) {
      return {
        localDate,
        hhAppliesCount: 0,
        linkedinEasyAppliesCount: 0,
        hhBoostsCount: 0,
        lastHhBoostAt: null,
      };
    }
    return {
      localDate: row.local_date,
      hhAppliesCount: row.hh_applies_count,
      linkedinEasyAppliesCount: row.linkedin_easy_applies_count,
      hhBoostsCount: row.hh_boosts_count,
      lastHhBoostAt: row.last_hh_boost_at,
    };
  }

  recordActionUsage(
    candidateId: string,
    localDate: string,
    kind: CandidateActionKind,
    executedAt: string,
  ): void {
    const isHhApply = kind === 'hh_apply' ? 1 : 0;
    const isLinkedinApply = kind === 'linkedin_easy_apply' ? 1 : 0;
    const isHhBoost = kind === 'hh_resume_boost' ? 1 : 0;
    const lastBoostAt = isHhBoost ? executedAt : null;

    this.database
      .prepare(
        `INSERT INTO candidate_action_daily_usage
          (candidate_id, local_date, hh_applies_count, linkedin_easy_applies_count, hh_boosts_count, last_hh_boost_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id, local_date) DO UPDATE SET
           hh_applies_count = hh_applies_count + excluded.hh_applies_count,
           linkedin_easy_applies_count = linkedin_easy_applies_count + excluded.linkedin_easy_applies_count,
           hh_boosts_count = hh_boosts_count + excluded.hh_boosts_count,
           last_hh_boost_at = COALESCE(excluded.last_hh_boost_at, candidate_action_daily_usage.last_hh_boost_at)`,
      )
      .run(candidateId, localDate, isHhApply, isLinkedinApply, isHhBoost, lastBoostAt);
  }

  createBatch(batchId: string, candidateId: string, confirmedAt: string): void {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO candidate_action_batches (id, candidate_id, status, confirmed_at, created_at)
         VALUES (?, ?, 'running', ?, ?)`,
      )
      .run(batchId, candidateId, confirmedAt, now);
  }

  createPendingReceipts(
    batchId: string,
    candidateId: string,
    actions: readonly {
      id: string;
      platform: 'hh' | 'linkedin';
      actionKind: CandidateActionKind;
      applicationId?: string | null;
    }[],
    executedAt: string,
  ): void {
    for (const action of actions) {
      this.recordReceipt({
        id: action.id,
        batchId,
        candidateId,
        platform: action.platform,
        actionKind: action.actionKind,
        status: 'pending',
        applicationId: action.applicationId,
        executedAt,
      });
    }
  }

  updateReceiptStatus(input: {
    id: string;
    batchId: string;
    candidateId: string;
    status: 'delivered' | 'attempted' | 'failed';
    failureCode?: string | null;
    executedAt: string;
  }): StoredActionReceipt {
    const result = this.database
      .prepare(
        `UPDATE candidate_action_receipts
         SET status = ?, failure_code = ?, executed_at = ?
         WHERE id = ? AND batch_id = ? AND candidate_id = ? AND status = 'pending'`,
      )
      .run(
        input.status,
        input.failureCode ?? null,
        input.executedAt,
        input.id,
        input.batchId,
        input.candidateId,
      );
    if (result.changes !== 1) throw new Error('candidate_action_pending_receipt_missing');
    const row = this.database
      .prepare('SELECT * FROM candidate_action_receipts WHERE id = ? AND candidate_id = ?')
      .get(input.id, input.candidateId) as ActionReceiptRow | undefined;
    if (!row) throw new Error('candidate_action_pending_receipt_missing');
    return mapReceiptRow(row);
  }

  updateBatchStatus(
    batchId: string,
    status: 'completed' | 'partial_failure' | 'aborted',
  ): void {
    this.database
      .prepare(`UPDATE candidate_action_batches SET status = ? WHERE id = ?`)
      .run(status, batchId);
  }

  private insertReceiptRow(
    id: string,
    input: RecordActionReceiptInput,
    executedAt: string,
    now: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO candidate_action_receipts (
          id, batch_id, candidate_id, platform, action_kind, status,
          application_id, target_url, confirmation_url, snapshot_hash,
          letter_version, letter_cipher, resume_version, resume_id,
          failure_code, executed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.batchId,
        input.candidateId,
        input.platform,
        input.actionKind,
        input.status,
        input.applicationId ?? null,
        '',
        null,
        null,
        null,
        null,
        null,
        null,
        input.failureCode ?? null,
        executedAt,
        now,
      );
  }

  recordReceipt(input: RecordActionReceiptInput): StoredActionReceipt {
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    const executedAt = input.executedAt ?? now;

    this.insertReceiptRow(id, input, executedAt, now);

    return {
      id,
      batchId: input.batchId,
      candidateId: input.candidateId,
      platform: input.platform,
      actionKind: input.actionKind,
      status: input.status,
      applicationId: input.applicationId ?? null,
      failureCode: input.failureCode ?? null,
      executedAt,
      createdAt: now,
    };
  }

  listReceipts(candidateId: string, limit = 50, batchId?: string): StoredActionReceipt[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM candidate_action_receipts
         WHERE candidate_id = ? AND (? IS NULL OR batch_id = ?)
         ORDER BY executed_at DESC, id DESC LIMIT ?`,
      )
      .all(candidateId, batchId ?? null, batchId ?? null, limit) as unknown as ActionReceiptRow[];

    return rows.map(mapReceiptRow);
  }
}

function mapReceiptRow(row: ActionReceiptRow): StoredActionReceipt {
  return {
    id: row.id,
    batchId: row.batch_id,
    candidateId: row.candidate_id,
    platform: row.platform,
    actionKind: row.action_kind,
    status: row.status,
    applicationId: row.application_id,
    failureCode: row.failure_code,
    executedAt: row.executed_at,
    createdAt: row.created_at,
  };
}
