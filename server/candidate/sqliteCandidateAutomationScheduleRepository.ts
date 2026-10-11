import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { SealedText } from '../data/sealedText';
import {
  DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE,
  validateCandidateAutomationSchedule,
  type CandidateAutomationSchedule,
} from './candidateAutomationScheduler';
import type { CandidateAutomationPlatform } from '../domain/candidateAutomation';
import type {
  CandidateAutomationJournalEntry,
  CandidateAutomationJournalReceiptStatus,
  CandidateAutomationJournalResult,
  CandidateAutomationRuntime,
  CandidateAutomationRuntimeStatus,
} from './sqliteCandidateAutomationRepository';

interface RuntimeRow {
  candidate_id: string;
  next_send_at: string | null;
  pause_until: string | null;
  status: CandidateAutomationRuntimeStatus;
  consecutive_errors: number;
  sent_since_break: number;
  emergency_paused: number;
  last_failure_code: string | null;
  lease_token: string | null;
  lease_until: string | null;
  updated_at: string;
}

interface JournalRow {
  id: string;
  candidate_id: string;
  event_key: string;
  queue_item_id: string;
  platform: CandidateAutomationPlatform;
  result: CandidateAutomationJournalResult;
  receipt_status: CandidateAutomationJournalReceiptStatus | null;
  attempted: number;
  local_date: string;
  company_cipher: string;
  occurred_at: string;
  receipt_id: string | null;
  failure_code: string | null;
}

export interface AppendCandidateAutomationJournalInput {
  readonly candidateId: string;
  readonly queueItemId: string;
  readonly platform: CandidateAutomationPlatform;
  readonly result: CandidateAutomationJournalResult;
  readonly receiptStatus?: CandidateAutomationJournalReceiptStatus | null;
  readonly attempted: boolean;
  readonly localDate: string;
  readonly company: string;
  readonly occurredAt: string;
  readonly receiptId?: string | null;
  readonly failureCode?: string | null;
  readonly eventKey?: string;
}

export const CANDIDATE_AUTOMATION_SCHEDULE_SCHEMA = `
CREATE TABLE IF NOT EXISTS candidate_auto_apply_schedule (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  schedule_cipher TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS candidate_auto_apply_runtime (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  next_send_at TEXT,
  pause_until TEXT,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'waiting', 'paused', 'daily_limit_reached', 'error', 'linkedin_not_connected', 'prepared')),
  consecutive_errors INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_errors >= 0),
  sent_since_break INTEGER NOT NULL DEFAULT 0 CHECK (sent_since_break >= 0),
  emergency_paused INTEGER NOT NULL DEFAULT 0 CHECK (emergency_paused IN (0, 1)),
  last_failure_code TEXT,
  lease_token TEXT,
  lease_until TEXT,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS candidate_auto_apply_runtime_due
  ON candidate_auto_apply_runtime(next_send_at, pause_until, lease_until);
CREATE TABLE IF NOT EXISTS candidate_auto_apply_journal (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  queue_item_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('hh', 'linkedin')),
  result TEXT NOT NULL CHECK (result IN ('delivered', 'error', 'removed')),
  receipt_status TEXT CHECK (receipt_status IN ('delivered', 'attempted', 'failed', 'pending')),
  attempted INTEGER NOT NULL CHECK (attempted IN (0, 1)),
  local_date TEXT NOT NULL,
  company_cipher TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  receipt_id TEXT,
  failure_code TEXT,
  UNIQUE(candidate_id, event_key)
) STRICT;
CREATE INDEX IF NOT EXISTS candidate_auto_apply_journal_recent
  ON candidate_auto_apply_journal(candidate_id, occurred_at DESC);
CREATE TRIGGER IF NOT EXISTS candidate_auto_apply_journal_immutable
  BEFORE UPDATE ON candidate_auto_apply_journal
  BEGIN SELECT RAISE(ABORT, 'automation_journal_immutable'); END;
CREATE TRIGGER IF NOT EXISTS candidate_auto_apply_journal_no_delete
  BEFORE DELETE ON candidate_auto_apply_journal
  WHEN EXISTS (SELECT 1 FROM candidates WHERE id = OLD.candidate_id)
  BEGIN SELECT RAISE(ABORT, 'automation_journal_immutable'); END;
`;

export class SqliteCandidateAutomationScheduleRepository {
  private readonly database: DatabaseSync;
  private readonly sealedText: SealedText;

  constructor(database: DatabaseSync, encryptionKey: Buffer) {
    this.database = database;
    this.sealedText = new SealedText(encryptionKey);
    this.database.exec(CANDIDATE_AUTOMATION_SCHEDULE_SCHEMA);
  }

  getSchedule(candidateId: string): CandidateAutomationSchedule {
    const row = this.database
      .prepare(
        `SELECT schedule_cipher FROM candidate_auto_apply_schedule
      WHERE candidate_id = ?`,
      )
      .get(candidateId) as { schedule_cipher: string } | undefined;
    if (!row) return DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE;
    const value = JSON.parse(
      this.sealedText.open(row.schedule_cipher, scheduleAad(candidateId)),
    ) as CandidateAutomationSchedule;
    if (!validateCandidateAutomationSchedule(value).valid)
      throw new Error('automation_schedule_invalid_at_rest');
    return value;
  }

  saveSchedule(
    candidateId: string,
    schedule: CandidateAutomationSchedule,
    now = new Date().toISOString(),
  ): CandidateAutomationSchedule {
    if (!validateCandidateAutomationSchedule(schedule).valid)
      throw new Error('automation_schedule_invalid');
    const encrypted = this.sealedText.seal(JSON.stringify(schedule), scheduleAad(candidateId));
    this.database
      .prepare(
        `INSERT INTO candidate_auto_apply_schedule(candidate_id, schedule_cipher, updated_at)
      VALUES (?, ?, ?) ON CONFLICT(candidate_id) DO UPDATE SET
      schedule_cipher = excluded.schedule_cipher, updated_at = excluded.updated_at`,
      )
      .run(candidateId, encrypted, now);
    return this.getSchedule(candidateId);
  }

  getRuntime(candidateId: string): CandidateAutomationRuntime {
    const row = this.database
      .prepare('SELECT * FROM candidate_auto_apply_runtime WHERE candidate_id = ?')
      .get(candidateId) as RuntimeRow | undefined;
    return row ? runtimeFromRow(row) : defaultRuntime(candidateId);
  }

  setRuntime(
    candidateId: string,
    update: Partial<Omit<CandidateAutomationRuntime, 'candidateId' | 'updatedAt'>>,
    now = new Date().toISOString(),
  ): CandidateAutomationRuntime {
    const current = this.getRuntime(candidateId);
    const next = { ...current, ...update, updatedAt: now };
    this.database
      .prepare(
        `INSERT INTO candidate_auto_apply_runtime (
      candidate_id, next_send_at, pause_until, status, consecutive_errors, sent_since_break,
      emergency_paused, last_failure_code, lease_token, lease_until, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(candidate_id) DO UPDATE SET
      next_send_at = excluded.next_send_at, pause_until = excluded.pause_until,
      status = excluded.status, consecutive_errors = excluded.consecutive_errors,
      sent_since_break = excluded.sent_since_break, emergency_paused = excluded.emergency_paused,
      last_failure_code = excluded.last_failure_code, lease_token = excluded.lease_token,
      lease_until = excluded.lease_until, updated_at = excluded.updated_at`,
      )
      .run(
        candidateId,
        next.nextSendAt,
        next.pauseUntil,
        next.status,
        next.consecutiveErrors,
        next.sentSinceBreak,
        Number(next.emergencyPaused),
        next.lastFailureCode,
        next.leaseToken,
        next.leaseUntil,
        now,
      );
    return this.getRuntime(candidateId);
  }

  setEmergencyPause(
    candidateId: string,
    paused: boolean,
    now = new Date().toISOString(),
  ): CandidateAutomationRuntime {
    return this.setRuntime(
      candidateId,
      {
        emergencyPaused: paused,
        nextSendAt: paused ? null : now,
        pauseUntil: null,
        status: paused ? 'paused' : 'ready',
        consecutiveErrors: paused ? this.getRuntime(candidateId).consecutiveErrors : 0,
        lastFailureCode: paused ? this.getRuntime(candidateId).lastFailureCode : null,
      },
      now,
    );
  }

  listDueCandidateIds(now: string, requestedLimit = 50): string[] {
    const limit = Math.min(200, Math.max(1, Math.floor(requestedLimit)));
    const rows = this.database
      .prepare(
        `SELECT DISTINCT q.candidate_id FROM candidate_auto_apply_queue q
      JOIN candidate_auto_apply_settings s ON s.candidate_id = q.candidate_id
      LEFT JOIN candidate_auto_apply_runtime r ON r.candidate_id = q.candidate_id
      WHERE q.status = 'approved' AND s.enabled = 1
      AND (s.paused_until IS NULL OR s.paused_until <= ?)
      AND COALESCE(r.emergency_paused, 0) = 0
      AND (r.status IS NULL OR r.status NOT IN ('error', 'linkedin_not_connected'))
      AND (r.status IS NULL OR r.status NOT IN ('prepared', 'paused') OR s.updated_at > r.updated_at OR q.updated_at > r.updated_at)
      AND (r.next_send_at IS NULL OR r.next_send_at <= ?)
      AND (r.pause_until IS NULL OR r.pause_until <= ?)
      AND (r.lease_until IS NULL OR r.lease_until <= ?)
      ORDER BY COALESCE(r.next_send_at, q.updated_at), q.candidate_id LIMIT ?`,
      )
      .all(now, now, now, now, limit) as unknown as Array<{ candidate_id: string }>;
    return rows.map((row) => row.candidate_id);
  }

  claimCandidate(candidateId: string, token: string, now: string, leaseUntil: string): boolean {
    this.database
      .prepare(
        `INSERT OR IGNORE INTO candidate_auto_apply_runtime(candidate_id, status, updated_at)
      VALUES (?, 'ready', ?)`,
      )
      .run(candidateId, now);
    return (
      this.database
        .prepare(
          `UPDATE candidate_auto_apply_runtime SET lease_token = ?, lease_until = ?, updated_at = ?
      WHERE candidate_id = ? AND (lease_until IS NULL OR lease_until <= ?)`,
        )
        .run(token, leaseUntil, now, candidateId, now).changes === 1
    );
  }

  releaseCandidate(candidateId: string, token: string, now = new Date().toISOString()): void {
    this.database
      .prepare(
        `UPDATE candidate_auto_apply_runtime SET lease_token = NULL, lease_until = ?, updated_at = ?
      WHERE candidate_id = ? AND lease_token = ?`,
      )
      .run(now, now, candidateId, token);
  }

  appendJournalEntry(
    input: AppendCandidateAutomationJournalInput,
  ): CandidateAutomationJournalEntry {
    const failureCode = safeFailureCode(input.failureCode);
    const eventKey =
      input.eventKey ??
      `${input.queueItemId}:${input.receiptId ?? input.occurredAt}:${input.result}`;
    this.database
      .prepare(
        `INSERT OR IGNORE INTO candidate_auto_apply_journal (
      id, candidate_id, event_key, queue_item_id, platform, result, receipt_status, attempted,
      local_date, company_cipher, occurred_at, receipt_id, failure_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        input.candidateId,
        eventKey,
        input.queueItemId,
        input.platform,
        input.result,
        input.receiptStatus ?? null,
        Number(input.attempted),
        input.localDate,
        this.sealedText.seal(input.company, journalAad(input.candidateId, input.queueItemId)),
        input.occurredAt,
        input.receiptId ?? null,
        failureCode,
      );
    const row = this.database
      .prepare(
        `SELECT * FROM candidate_auto_apply_journal
      WHERE candidate_id = ? AND event_key = ?`,
      )
      .get(input.candidateId, eventKey) as JournalRow | undefined;
    if (!row) throw new Error('automation_journal_not_persisted');
    return journalFromRow(row, this.sealedText);
  }

  listJournal(
    candidateId: string,
    options: {
      readonly result?: CandidateAutomationJournalResult;
      readonly platform?: CandidateAutomationPlatform;
      readonly periodDays?: number;
      readonly limit?: number;
      readonly offset?: number;
      readonly now?: string;
    } = {},
  ): CandidateAutomationJournalEntry[] {
    const periodDays = Math.min(30, Math.max(1, Math.floor(options.periodDays ?? 30)));
    const now = options.now ? Date.parse(options.now) : Date.now();
    const since = new Date(now - periodDays * 86_400_000).toISOString();
    const where = ['candidate_id = ?', 'occurred_at >= ?'];
    const values: Array<string | number> = [candidateId, since];
    if (options.result) {
      where.push('result = ?');
      values.push(options.result);
    }
    if (options.platform) {
      where.push('platform = ?');
      values.push(options.platform);
    }
    const limit = Math.min(5_000, Math.max(1, Math.floor(options.limit ?? 100)));
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const rows = this.database
      .prepare(
        `SELECT * FROM candidate_auto_apply_journal WHERE ${where.join(' AND ')}
      ORDER BY occurred_at DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .all(...values, limit, offset) as unknown as JournalRow[];
    return rows.map((row) => journalFromRow(row, this.sealedText));
  }

  countDailyAttempts(
    candidateId: string,
    localDate: string,
    platform: CandidateAutomationPlatform,
  ): number {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM candidate_auto_apply_journal
      WHERE candidate_id = ? AND local_date = ? AND platform = ? AND attempted = 1`,
      )
      .get(candidateId, localDate, platform) as { count: number };
    return row.count;
  }

  journalCounts(
    candidateId: string,
    now = new Date().toISOString(),
  ): Readonly<{
    total: number;
    delivered: number;
    errors: number;
    removed: number;
  }> {
    const since = new Date(Date.parse(now) - 30 * 86_400_000).toISOString();
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS total,
      SUM(CASE WHEN result = 'delivered' THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN result = 'error' THEN 1 ELSE 0 END) AS errors,
      SUM(CASE WHEN result = 'removed' THEN 1 ELSE 0 END) AS removed
      FROM candidate_auto_apply_journal WHERE candidate_id = ? AND occurred_at >= ?`,
      )
      .get(candidateId, since) as {
      total: number;
      delivered: number | null;
      errors: number | null;
      removed: number | null;
    };
    return {
      total: row.total,
      delivered: row.delivered ?? 0,
      errors: row.errors ?? 0,
      removed: row.removed ?? 0,
    };
  }
}

function defaultRuntime(candidateId: string): CandidateAutomationRuntime {
  return {
    candidateId,
    nextSendAt: null,
    pauseUntil: null,
    status: 'ready',
    consecutiveErrors: 0,
    sentSinceBreak: 0,
    emergencyPaused: false,
    lastFailureCode: null,
    leaseToken: null,
    leaseUntil: null,
    updatedAt: null,
  };
}

function runtimeFromRow(row: RuntimeRow): CandidateAutomationRuntime {
  return {
    candidateId: row.candidate_id,
    nextSendAt: row.next_send_at,
    pauseUntil: row.pause_until,
    status: row.status,
    consecutiveErrors: row.consecutive_errors,
    sentSinceBreak: row.sent_since_break,
    emergencyPaused: row.emergency_paused === 1,
    lastFailureCode: row.last_failure_code,
    leaseToken: row.lease_token,
    leaseUntil: row.lease_until,
    updatedAt: row.updated_at,
  };
}

function journalFromRow(row: JournalRow, sealedText: SealedText): CandidateAutomationJournalEntry {
  return {
    id: row.id,
    queueItemId: row.queue_item_id,
    platform: row.platform,
    result: row.result,
    receiptStatus: row.receipt_status,
    attempted: row.attempted === 1,
    localDate: row.local_date,
    company: sealedText.open(row.company_cipher, journalAad(row.candidate_id, row.queue_item_id)),
    occurredAt: row.occurred_at,
    receiptId: row.receipt_id,
    failureCode: row.failure_code,
  };
}

function safeFailureCode(value?: string | null): string | null {
  return value && /^[a-z][a-z0-9_]{0,63}$/u.test(value) ? value : null;
}

function scheduleAad(candidateId: string): string {
  return `candidate-auto-apply:${candidateId}:schedule`;
}
function journalAad(candidateId: string, queueItemId: string): string {
  return `candidate-auto-apply:${candidateId}:journal:${queueItemId}`;
}
