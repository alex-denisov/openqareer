import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { transitionCandidateAutomationQueue } from '../domain/candidateAutomation';
import type {
  CandidateAutomationPlatform,
  CandidateAutomationQueueAction,
  CandidateAutomationQueueStatus,
  CandidateAutomationRules,
} from '../domain/candidateAutomation';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';
import { SealedText } from '../data/sealedText';
import { SqliteCandidateAutomationScheduleRepository } from './sqliteCandidateAutomationScheduleRepository';

export type CandidateAutomationMode = 'drafts_only' | 'approval_required' | 'automatic';
export type CandidateAutomationConsentKey =
  | 'drafts'
  | 'send_after_approval'
  | 'notifications'
  | 'automatic_submission';
export type CandidateAutomationStopOrigin = 'manual' | 'rejection';

export interface CandidateAutomationSettings {
  readonly candidateId: string;
  readonly enabled: boolean;
  readonly mode: CandidateAutomationMode;
  readonly pausedUntil: string | null;
  readonly rules: CandidateAutomationRules;
  readonly updatedAt: string | null;
}

export interface CandidateAutomationConsent {
  readonly id: string;
  readonly key: CandidateAutomationConsentKey;
  readonly version: string;
  readonly text: string;
  readonly acceptedAt: string;
  readonly revokedAt: string | null;
}

export interface CandidateAutomationStopCompany {
  readonly company: string;
  readonly origin: CandidateAutomationStopOrigin;
  readonly createdAt: string;
}

export interface CandidateAutomationMaterial {
  readonly documentId: string;
  readonly kind: 'resume' | 'cover_letter' | 'portfolio' | 'certificate' | 'other' | 'profile_export';
  readonly fileName: string;
  readonly version: number;
}

export interface CandidateAutomationQueuePayload {
  readonly clusterId: string;
  readonly applicationId: string | null;
  readonly platform: CandidateAutomationPlatform;
  readonly title: string;
  readonly role: string;
  readonly company: string;
  readonly targetUrl: string;
  readonly requirements: { readonly matched: number; readonly total: number };
  readonly letterText: string;
  readonly materials: readonly CandidateAutomationMaterial[];
  readonly approvalType?: 'candidate' | 'automatic_consent';
  readonly approvedAt?: string | null;
}

export interface CandidateAutomationQueueItem {
  readonly id: string;
  readonly candidateId: string;
  readonly applicationId: string | null;
  readonly status: CandidateAutomationQueueStatus;
  readonly sendTiming: 'today' | 'later';
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly payload: CandidateAutomationQueuePayload;
}

export type CandidateAutomationJournalResult = 'delivered' | 'error' | 'removed';
export type CandidateAutomationJournalReceiptStatus = 'delivered' | 'attempted' | 'failed' | 'pending';

export interface CandidateAutomationJournalEntry {
  readonly id: string;
  readonly queueItemId: string;
  readonly platform: CandidateAutomationPlatform;
  readonly result: CandidateAutomationJournalResult;
  readonly receiptStatus: CandidateAutomationJournalReceiptStatus | null;
  readonly attempted: boolean;
  readonly localDate: string;
  readonly company: string;
  readonly occurredAt: string;
  readonly receiptId: string | null;
  readonly failureCode: string | null;
}

export type CandidateAutomationRuntimeStatus =
  | 'ready'
  | 'waiting'
  | 'paused'
  | 'daily_limit_reached'
  | 'error'
  | 'linkedin_not_connected'
  | 'prepared';

export interface CandidateAutomationRuntime {
  readonly candidateId: string;
  readonly nextSendAt: string | null;
  readonly pauseUntil: string | null;
  readonly status: CandidateAutomationRuntimeStatus;
  readonly consecutiveErrors: number;
  readonly sentSinceBreak: number;
  readonly emergencyPaused: boolean;
  readonly lastFailureCode: string | null;
  readonly leaseToken: string | null;
  readonly leaseUntil: string | null;
  readonly updatedAt: string | null;
}

interface SettingsRow {
  candidate_id: string;
  enabled: number;
  mode: CandidateAutomationMode;
  paused_until: string | null;
  rules_cipher: string;
  updated_at: string;
}

interface ConsentRow {
  id: string;
  consent_key: CandidateAutomationConsentKey;
  text_version: string;
  consent_text: string;
  accepted_at: string;
  revoked_at: string | null;
}

interface StopRow {
  company_key: string;
  company_cipher: string;
  origin: CandidateAutomationStopOrigin;
  created_at: string;
}

interface QueueRow {
  id: string;
  candidate_id: string;
  application_id: string | null;
  status: CandidateAutomationQueueStatus;
  send_timing: 'today' | 'later';
  payload_cipher: string;
  created_at: string;
  updated_at: string;
}

export const DEFAULT_CANDIDATE_AUTOMATION_RULES: CandidateAutomationRules = {
  roles: [],
  minimumMatchPercent: 80,
  platforms: ['hh', 'linkedin'],
  excludeStopCompanies: true,
};
export const MAX_OPEN_CANDIDATE_AUTOMATION_ITEMS = 500;

export const CANDIDATE_AUTOMATION_SCHEMA = `
CREATE TABLE IF NOT EXISTS candidate_auto_apply_settings (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  mode TEXT NOT NULL DEFAULT 'drafts_only' CHECK (mode IN ('drafts_only', 'approval_required', 'automatic')),
  paused_until TEXT,
  rules_cipher TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS candidate_auto_apply_consents (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  consent_key TEXT NOT NULL CHECK (consent_key IN ('drafts', 'send_after_approval', 'notifications', 'automatic_submission')),
  text_version TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS candidate_auto_apply_consents_active
  ON candidate_auto_apply_consents(candidate_id, consent_key, accepted_at DESC);
CREATE TABLE IF NOT EXISTS candidate_auto_apply_stops (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  company_key TEXT NOT NULL,
  company_cipher TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('manual', 'rejection')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(candidate_id, company_key)
) STRICT;
CREATE TABLE IF NOT EXISTS candidate_auto_apply_queue (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  cluster_id TEXT NOT NULL,
  application_id TEXT,
  platform TEXT NOT NULL CHECK (platform IN ('hh', 'linkedin')),
  status TEXT NOT NULL CHECK (status IN ('letter_not_ready', 'pending_approval', 'approved', 'removed', 'consultant', 'sent', 'attempted', 'failed')),
  send_timing TEXT NOT NULL CHECK (send_timing IN ('today', 'later')),
  payload_cipher TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(candidate_id, cluster_id)
) STRICT;
CREATE INDEX IF NOT EXISTS candidate_auto_apply_queue_candidate_status
  ON candidate_auto_apply_queue(candidate_id, status, created_at DESC);
`;

export class SqliteCandidateAutomationRepository {
  private readonly database: DatabaseSync;
  private readonly ownsDatabase: boolean;
  private readonly sealedText: SealedText;
  readonly schedulerRepository: SqliteCandidateAutomationScheduleRepository;

  constructor(options: DatabaseSync | { databasePath: string; encryptionKey: Buffer }, key?: Buffer) {
    this.ownsDatabase = !(options instanceof DatabaseSync);
    this.database = options instanceof DatabaseSync ? options : new DatabaseSync(options.databasePath);
    const encryptionKey = options instanceof DatabaseSync ? key : options.encryptionKey;
    if (!encryptionKey || encryptionKey.length !== 32) throw new Error('automation_encryption_key_invalid');
    this.sealedText = new SealedText(encryptionKey);
    if (this.ownsDatabase) this.database.exec('PRAGMA journal_mode = WAL;');
    applySqliteBusyTimeout(this.database);
    this.database.exec(CANDIDATE_AUTOMATION_SCHEMA);
    this.schedulerRepository = new SqliteCandidateAutomationScheduleRepository(this.database, encryptionKey);
    this.installDeletionTrigger();
  }

  close(): void {
    if (this.ownsDatabase) this.database.close();
  }

  getSettings(candidateId: string): CandidateAutomationSettings {
    const row = this.database.prepare(
      'SELECT * FROM candidate_auto_apply_settings WHERE candidate_id = ?',
    ).get(candidateId) as SettingsRow | undefined;
    if (!row) return defaultSettings(candidateId);
    return {
      candidateId,
      enabled: row.enabled === 1,
      mode: row.mode,
      pausedUntil: row.paused_until,
      rules: JSON.parse(this.sealedText.open(row.rules_cipher, rulesAad(candidateId))) as CandidateAutomationRules,
      updatedAt: row.updated_at,
    };
  }

  saveSettings(
    candidateId: string,
    input: { readonly enabled: boolean; readonly mode: CandidateAutomationMode; readonly rules: CandidateAutomationRules },
    now = new Date().toISOString(),
  ): CandidateAutomationSettings {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.writeSettings(candidateId, input, now);
      if (!input.enabled) this.returnApprovedItemsToReview(candidateId, now);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return this.getSettings(candidateId);
  }

  private writeSettings(
    candidateId: string,
    input: { readonly enabled: boolean; readonly mode: CandidateAutomationMode; readonly rules: CandidateAutomationRules },
    now: string,
  ): void {
    const rulesCipher = this.sealedText.seal(JSON.stringify(input.rules), rulesAad(candidateId));
    this.database.prepare(`
      INSERT INTO candidate_auto_apply_settings (candidate_id, enabled, mode, rules_cipher, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(candidate_id) DO UPDATE SET enabled = excluded.enabled,
        mode = excluded.mode, rules_cipher = excluded.rules_cipher, updated_at = excluded.updated_at
    `).run(candidateId, Number(input.enabled), input.mode, rulesCipher, now);
  }

  setPause(candidateId: string, pausedUntil: string | null, now = new Date().toISOString()): CandidateAutomationSettings {
    const current = this.getSettings(candidateId);
    this.saveSettings(candidateId, { enabled: current.enabled, mode: current.mode, rules: current.rules }, now);
    this.database.prepare(
      'UPDATE candidate_auto_apply_settings SET paused_until = ?, updated_at = ? WHERE candidate_id = ?',
    ).run(pausedUntil, now, candidateId);
    return this.getSettings(candidateId);
  }

  acceptConsent(
    candidateId: string,
    key: CandidateAutomationConsentKey,
    version: string,
    text: string,
    acceptedAt = new Date().toISOString(),
  ): CandidateAutomationConsent {
    const existing = this.database.prepare(`SELECT * FROM candidate_auto_apply_consents
      WHERE candidate_id = ? AND consent_key = ? AND text_version = ? AND consent_text = ? AND revoked_at IS NULL
      ORDER BY accepted_at DESC LIMIT 1`).get(candidateId, key, version, text) as ConsentRow | undefined;
    if (existing) return consentFromRow(existing);
    this.database.prepare(`UPDATE candidate_auto_apply_consents SET revoked_at = ?
      WHERE candidate_id = ? AND consent_key = ? AND revoked_at IS NULL`).run(acceptedAt, candidateId, key);
    const id = randomUUID();
    this.database.prepare(`INSERT INTO candidate_auto_apply_consents
      (id, candidate_id, consent_key, text_version, consent_text, accepted_at, revoked_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)`).run(id, candidateId, key, version, text, acceptedAt);
    const stored = this.database.prepare('SELECT * FROM candidate_auto_apply_consents WHERE id = ?').get(id) as ConsentRow | undefined;
    if (!stored) throw new Error('automation_consent_not_persisted');
    return consentFromRow(stored);
  }

  listConsents(candidateId: string): CandidateAutomationConsent[] {
    const rows = this.database.prepare(`SELECT * FROM candidate_auto_apply_consents
      WHERE candidate_id = ? ORDER BY accepted_at, id`).all(candidateId) as unknown as ConsentRow[];
    return rows.map(consentFromRow);
  }

  hasActiveConsent(candidateId: string, key: CandidateAutomationConsentKey): boolean {
    return Boolean(this.database.prepare(`SELECT 1 FROM candidate_auto_apply_consents
      WHERE candidate_id = ? AND consent_key = ? AND revoked_at IS NULL LIMIT 1`).get(candidateId, key));
  }

  revokeConsent(candidateId: string, key: CandidateAutomationConsentKey, now = new Date().toISOString()): boolean {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = this.database.prepare(`UPDATE candidate_auto_apply_consents SET revoked_at = ?
        WHERE candidate_id = ? AND consent_key = ? AND revoked_at IS NULL`).run(now, candidateId, key);
      if (result.changes > 0) {
        const current = this.getSettings(candidateId);
        this.writeSettings(candidateId, { enabled: false, mode: current.mode, rules: current.rules }, now);
        this.returnApprovedItemsToReview(candidateId, now);
      }
      this.database.exec('COMMIT');
      return result.changes > 0;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private returnApprovedItemsToReview(candidateId: string, now: string): void {
    const rows = this.database.prepare(`SELECT * FROM candidate_auto_apply_queue
      WHERE candidate_id = ? AND status = 'approved'`).all(candidateId) as unknown as QueueRow[];
    for (const row of rows) {
      const current = this.queueFromRow(row);
      const payload: CandidateAutomationQueuePayload = {
        clusterId: current.payload.clusterId,
        applicationId: current.payload.applicationId,
        platform: current.payload.platform,
        title: current.payload.title,
        role: current.payload.role,
        company: current.payload.company,
        targetUrl: current.payload.targetUrl,
        requirements: current.payload.requirements,
        letterText: current.payload.letterText,
        materials: current.payload.materials,
      };
      this.database.prepare(`UPDATE candidate_auto_apply_queue SET status = 'pending_approval',
        payload_cipher = ?, updated_at = ? WHERE candidate_id = ? AND id = ? AND status = 'approved'`)
        .run(this.encryptQueuePayload(candidateId, row.id, payload), now, candidateId, row.id);
    }
  }

  addStopCompany(candidateId: string, company: string, origin: CandidateAutomationStopOrigin, now = new Date().toISOString()): boolean {
    const key = this.stopCompanyKey(candidateId, company);
    if (!key) return false;
    const companyCipher = this.sealedText.seal(company.trim(), stopAad(candidateId, key));
    this.database.prepare(`INSERT INTO candidate_auto_apply_stops
      (candidate_id, company_key, company_cipher, origin, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(candidate_id, company_key) DO UPDATE SET
        company_cipher = excluded.company_cipher,
        origin = CASE WHEN candidate_auto_apply_stops.origin = 'manual' THEN 'manual' ELSE excluded.origin END,
        created_at = CASE WHEN candidate_auto_apply_stops.origin = 'manual' THEN candidate_auto_apply_stops.created_at ELSE excluded.created_at END
    `).run(candidateId, key, companyCipher, origin, now);
    return true;
  }

  listStopCompanies(candidateId: string): CandidateAutomationStopCompany[] {
    const rows = this.database.prepare(`SELECT company_key, company_cipher, origin, created_at
      FROM candidate_auto_apply_stops WHERE candidate_id = ? ORDER BY created_at DESC`).all(candidateId) as unknown as StopRow[];
    return rows.map((row) => ({
      company: this.sealedText.open(row.company_cipher, stopAad(candidateId, row.company_key)),
      origin: row.origin,
      createdAt: row.created_at,
    }));
  }

  removeStopCompany(candidateId: string, company: string): boolean {
    const key = this.stopCompanyKey(candidateId, company);
    if (!key) return false;
    return this.database.prepare('DELETE FROM candidate_auto_apply_stops WHERE candidate_id = ? AND company_key = ?')
      .run(candidateId, key).changes === 1;
  }

  listStopCompanyKeys(candidateId: string): ReadonlySet<string> {
    return new Set(this.listStopCompanies(candidateId).map((stop) => stop.company.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ru')));
  }

  addQueueItem(
    candidateId: string,
    payload: CandidateAutomationQueuePayload,
    sendTiming: 'today' | 'later',
    approveAutomatically = false,
    now = new Date().toISOString(),
  ): CandidateAutomationQueueItem {
    const id = randomUUID();
    const letterReady = payload.letterText.trim().length > 0;
    const status: CandidateAutomationQueueStatus = letterReady
      ? approveAutomatically ? 'approved' : 'pending_approval'
      : 'letter_not_ready';
    const storedPayload = approveAutomatically && letterReady
      ? { ...payload, approvalType: 'automatic_consent' as const, approvedAt: now }
      : payload;
    this.database.prepare(`INSERT INTO candidate_auto_apply_queue
      (id, candidate_id, cluster_id, application_id, platform, status, send_timing, payload_cipher, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(candidate_id, cluster_id) DO NOTHING`).run(
      id, candidateId, payload.clusterId, payload.applicationId, payload.platform, status, sendTiming,
      this.encryptQueuePayload(candidateId, id, storedPayload), now, now,
    );
    const row = this.database.prepare(`SELECT * FROM candidate_auto_apply_queue
      WHERE candidate_id = ? AND cluster_id = ?`).get(candidateId, payload.clusterId) as QueueRow | undefined;
    if (!row) throw new Error('automation_queue_item_not_persisted');
    return this.queueFromRow(row);
  }

  getQueueItem(candidateId: string, id: string): CandidateAutomationQueueItem | null {
    const row = this.database.prepare(`SELECT * FROM candidate_auto_apply_queue
      WHERE candidate_id = ? AND id = ?`).get(candidateId, id) as QueueRow | undefined;
    return row ? this.queueFromRow(row) : null;
  }

  getQueueItemByCluster(candidateId: string, clusterId: string): CandidateAutomationQueueItem | null {
    const row = this.database.prepare(`SELECT * FROM candidate_auto_apply_queue
      WHERE candidate_id = ? AND cluster_id = ?`).get(candidateId, clusterId) as QueueRow | undefined;
    return row ? this.queueFromRow(row) : null;
  }

  getNextApprovedQueueItem(candidateId: string): CandidateAutomationQueueItem | null {
    const row = this.database.prepare(`SELECT * FROM candidate_auto_apply_queue
      WHERE candidate_id = ? AND status = 'approved' ORDER BY created_at, rowid LIMIT 1`)
      .get(candidateId) as QueueRow | undefined;
    return row ? this.queueFromRow(row) : null;
  }

  listQueue(candidateId: string, options: {
    readonly status?: CandidateAutomationQueueStatus;
    readonly platform?: CandidateAutomationPlatform;
    readonly limit?: number;
    readonly offset?: number;
  } = {}): CandidateAutomationQueueItem[] {
    const where = ['candidate_id = ?'];
    const values: Array<string | number> = [candidateId];
    if (options.status) { where.push('status = ?'); values.push(options.status); }
    if (options.platform) { where.push('platform = ?'); values.push(options.platform); }
    const limit = Math.min(500, Math.max(1, Math.floor(options.limit ?? 20)));
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const rows = this.database.prepare(`SELECT * FROM candidate_auto_apply_queue
      WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...values, limit, offset) as unknown as QueueRow[];
    return rows.map((row) => this.queueFromRow(row));
  }

  transitionQueueItem(
    candidateId: string,
    id: string,
    action: CandidateAutomationQueueAction,
    now = new Date().toISOString(),
  ): CandidateAutomationQueueItem | null {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const current = this.getQueueItem(candidateId, id);
      if (!current) {
        this.database.exec('COMMIT');
        return null;
      }
      const status = transitionCandidateAutomationQueue(current.status, action, current.payload.letterText.trim().length > 0);
      const payload = status === 'approved'
        ? { ...current.payload, approvalType: 'candidate' as const, approvedAt: now }
        : status === 'removed' || status === 'sent' || status === 'attempted' || status === 'failed'
          ? scrubQueuePayload(current.payload)
          : current.payload;
      const result = this.database.prepare(`UPDATE candidate_auto_apply_queue
        SET status = ?, application_id = ?, payload_cipher = ?, updated_at = ?
        WHERE candidate_id = ? AND id = ? AND status = ?`).run(
        status, payload.applicationId, this.encryptQueuePayload(candidateId, id, payload), now,
        candidateId, id, current.status,
      );
      if (result.changes === 1 && status === 'removed') {
        this.schedulerRepository.appendJournalEntry({
          candidateId, queueItemId: id, platform: current.payload.platform, result: 'removed',
          attempted: false, localDate: now.slice(0, 10), company: current.payload.company,
          occurredAt: now, eventKey: `${id}:removed`,
        });
      }
      this.database.exec('COMMIT');
      return result.changes === 1 ? this.getQueueItem(candidateId, id) : null;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  completeScheduledQueueItem(input: {
    readonly candidateId: string;
    readonly queueItemId: string;
    readonly action: 'sent' | 'attempted' | 'failed';
    readonly localDate: string;
    readonly occurredAt: string;
    readonly receiptId: string | null;
    readonly failureCode: string | null;
    readonly receiptStatus: CandidateAutomationJournalReceiptStatus;
    readonly attempted: boolean;
  }): CandidateAutomationQueueItem | null {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const current = this.getQueueItem(input.candidateId, input.queueItemId);
      if (!current) {
        this.database.exec('COMMIT');
        return null;
      }
      if (current.status === 'approved' || current.status === 'pending_approval') {
        const payload = scrubQueuePayload(current.payload);
        this.database.prepare(`UPDATE candidate_auto_apply_queue SET status = ?,
          payload_cipher = ?, updated_at = ? WHERE candidate_id = ? AND id = ? AND status = ?`)
          .run(input.action, this.encryptQueuePayload(input.candidateId, current.id, payload), input.occurredAt,
            input.candidateId, current.id, current.status);
      }
      this.schedulerRepository.appendJournalEntry({
        candidateId: input.candidateId, queueItemId: current.id, platform: current.payload.platform,
        result: input.action === 'sent' ? 'delivered' : 'error', receiptStatus: input.receiptStatus,
        attempted: input.attempted, localDate: input.localDate, company: current.payload.company,
        occurredAt: input.occurredAt, receiptId: input.receiptId, failureCode: input.failureCode,
        eventKey: `${current.id}:${input.receiptId ?? input.occurredAt}:${input.receiptStatus}`,
      });
      this.database.exec('COMMIT');
      return this.getQueueItem(input.candidateId, current.id);
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  updateQueueLetter(candidateId: string, id: string, letterText: string, now = new Date().toISOString()): CandidateAutomationQueueItem | null {
    const current = this.getQueueItem(candidateId, id);
    if (!current) return null;
    const status = transitionCandidateAutomationQueue(current.status, 'update_letter', letterText.trim().length > 0);
    const payload = { ...current.payload, letterText };
    const result = this.database.prepare(`UPDATE candidate_auto_apply_queue
      SET status = ?, payload_cipher = ?, updated_at = ? WHERE candidate_id = ? AND id = ? AND status = ?`)
      .run(status, this.encryptQueuePayload(candidateId, id, payload), now, candidateId, id, current.status);
    return result.changes === 1 ? this.getQueueItem(candidateId, id) : null;
  }

  queueCounts(candidateId: string): Readonly<Record<CandidateAutomationQueueStatus, number>> {
    const counts: Record<CandidateAutomationQueueStatus, number> = {
      letter_not_ready: 0, pending_approval: 0, approved: 0, removed: 0,
      consultant: 0, sent: 0, attempted: 0, failed: 0,
    };
    const rows = this.database.prepare(`SELECT status, COUNT(*) AS count FROM candidate_auto_apply_queue
      WHERE candidate_id = ? GROUP BY status`).all(candidateId) as Array<{ status: CandidateAutomationQueueStatus; count: number }>;
    for (const row of rows) counts[row.status] = row.count;
    return counts;
  }

  countQueue(
    candidateId: string,
    status?: CandidateAutomationQueueStatus,
    platform?: CandidateAutomationPlatform,
  ): number {
    const where = ['candidate_id = ?'];
    const values: string[] = [candidateId];
    if (status) { where.push('status = ?'); values.push(status); }
    if (platform) { where.push('platform = ?'); values.push(platform); }
    const row = this.database.prepare(`SELECT COUNT(*) AS count FROM candidate_auto_apply_queue
      WHERE ${where.join(' AND ')}`).get(...values) as { count: number };
    return row.count;
  }

  countOpenQueue(candidateId: string): number {
    const row = this.database.prepare(`SELECT COUNT(*) AS count FROM candidate_auto_apply_queue
      WHERE candidate_id = ? AND status IN ('letter_not_ready', 'pending_approval', 'approved')`)
      .get(candidateId) as { count: number };
    return row.count;
  }

  private queueFromRow(row: QueueRow): CandidateAutomationQueueItem {
    return {
      id: row.id,
      candidateId: row.candidate_id,
      applicationId: row.application_id,
      status: row.status,
      sendTiming: row.send_timing,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      payload: JSON.parse(this.sealedText.open(row.payload_cipher, queueAad(row.candidate_id, row.id))) as CandidateAutomationQueuePayload,
    };
  }

  private encryptQueuePayload(candidateId: string, id: string, payload: CandidateAutomationQueuePayload): string {
    return this.sealedText.seal(JSON.stringify(payload), queueAad(candidateId, id));
  }

  private stopCompanyKey(candidateId: string, company: string): string | null {
    const normalized = company.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ru');
    return normalized ? this.sealedText.indexToken(candidateId, normalized) : null;
  }

  private installDeletionTrigger(): void {
    if (!this.database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'candidates'").get()) return;
    const trigger = this.database.prepare(`SELECT sql FROM sqlite_master WHERE type = 'trigger'
      AND name = 'candidate_auto_apply_delete_candidate'`).get() as { sql?: string } | undefined;
    if (trigger?.sql?.includes('candidate_auto_apply_journal')) return;
    this.database.exec('DROP TRIGGER IF EXISTS candidate_auto_apply_delete_candidate;');
    this.database.exec(`CREATE TRIGGER IF NOT EXISTS candidate_auto_apply_delete_candidate
      AFTER DELETE ON candidates BEGIN
        DELETE FROM candidate_auto_apply_settings WHERE candidate_id = OLD.id;
        DELETE FROM candidate_auto_apply_consents WHERE candidate_id = OLD.id;
        DELETE FROM candidate_auto_apply_stops WHERE candidate_id = OLD.id;
        DELETE FROM candidate_auto_apply_queue WHERE candidate_id = OLD.id;
        DELETE FROM candidate_auto_apply_schedule WHERE candidate_id = OLD.id;
        DELETE FROM candidate_auto_apply_runtime WHERE candidate_id = OLD.id;
        DELETE FROM candidate_auto_apply_journal WHERE candidate_id = OLD.id;
      END;`);
  }
}

function defaultSettings(candidateId: string): CandidateAutomationSettings {
  return { candidateId, enabled: false, mode: 'drafts_only', pausedUntil: null, rules: DEFAULT_CANDIDATE_AUTOMATION_RULES, updatedAt: null };
}

function consentFromRow(row: ConsentRow): CandidateAutomationConsent {
  return { id: row.id, key: row.consent_key, version: row.text_version, text: row.consent_text, acceptedAt: row.accepted_at, revokedAt: row.revoked_at };
}

function scrubQueuePayload(payload: CandidateAutomationQueuePayload): CandidateAutomationQueuePayload {
  return { ...payload, targetUrl: '', letterText: '', materials: [] };
}

function rulesAad(candidateId: string): string { return `candidate-auto-apply:${candidateId}:rules`; }
function stopAad(candidateId: string, key: string): string { return `candidate-auto-apply:${candidateId}:stop:${key}`; }
function queueAad(candidateId: string, id: string): string { return `candidate-auto-apply:${candidateId}:queue:${id}`; }
