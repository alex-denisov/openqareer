import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  type CandidateCapability,
  isCandidateCapability,
} from '../../src/features/legal/capabilityConsents';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';

export interface CapabilityConsentRecord {
  readonly id: string;
  readonly userId: string;
  readonly capability: CandidateCapability;
  readonly versionId: string;
  readonly grantedAt: string;
  readonly revokedAt: string | null;
}

interface CapabilityConsentRow {
  id: string;
  user_id: string;
  capability: string;
  version_id: string;
  granted_at: string;
  revoked_at: string | null;
}

export const CAPABILITY_CONSENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS candidate_capability_consents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  version_id TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_capability_consents_user_cap
  ON candidate_capability_consents (user_id, capability);
`;

export function ensureCapabilityConsentsSchema(database: DatabaseSync): void {
  database.exec(CAPABILITY_CONSENTS_SCHEMA);
}

/** Строка с неизвестной возможностью (другая версия кода) не выдаётся за другую. */
function mapRow(row: CapabilityConsentRow): CapabilityConsentRecord | null {
  const cap = row.capability;
  if (!isCandidateCapability(cap)) return null;
  return {
    id: row.id,
    userId: row.user_id,
    capability: cap,
    versionId: row.version_id,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at,
  };
}

export function recordCapabilityConsent(
  database: DatabaseSync,
  input: {
    userId: string;
    capability: CandidateCapability;
    versionId: string;
    grantedAt?: string;
  },
): CapabilityConsentRecord {
  ensureCapabilityConsentsSchema(database);
  const active = getActiveCapabilityConsent(database, input.userId, input.capability);
  if (active && active.versionId === input.versionId) {
    return active;
  }
  const now = input.grantedAt ?? new Date().toISOString();
  if (active) {
    database
      .prepare('UPDATE candidate_capability_consents SET revoked_at = ? WHERE id = ?')
      .run(now, active.id);
  }
  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO candidate_capability_consents
         (id, user_id, capability, version_id, granted_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    )
    .run(id, input.userId, input.capability, input.versionId, now);
  return {
    id,
    userId: input.userId,
    capability: input.capability,
    versionId: input.versionId,
    grantedAt: now,
    revokedAt: null,
  };
}

export function revokeCapabilityConsent(
  database: DatabaseSync,
  userId: string,
  capability: CandidateCapability,
  revokedAt?: string,
): CapabilityConsentRecord | null {
  ensureCapabilityConsentsSchema(database);
  const active = getActiveCapabilityConsent(database, userId, capability);
  if (!active) {
    return null;
  }
  const stamp = revokedAt ?? new Date().toISOString();
  database
    .prepare('UPDATE candidate_capability_consents SET revoked_at = ? WHERE id = ?')
    .run(stamp, active.id);
  return {
    ...active,
    revokedAt: stamp,
  };
}

export function getActiveCapabilityConsent(
  database: DatabaseSync,
  userId: string,
  capability: CandidateCapability,
): CapabilityConsentRecord | null {
  ensureCapabilityConsentsSchema(database);
  const row = database
    .prepare(
      `SELECT id, user_id, capability, version_id, granted_at, revoked_at
         FROM candidate_capability_consents
        WHERE user_id = ? AND capability = ? AND revoked_at IS NULL`,
    )
    .get(userId, capability) as unknown as CapabilityConsentRow | undefined;
  return row ? mapRow(row) : null;
}

export function listCapabilityConsents(
  database: DatabaseSync,
  userId: string,
  capability?: CandidateCapability,
): readonly CapabilityConsentRecord[] {
  ensureCapabilityConsentsSchema(database);
  if (capability) {
    const rows = database
      .prepare(
        `SELECT id, user_id, capability, version_id, granted_at, revoked_at
           FROM candidate_capability_consents
          WHERE user_id = ? AND capability = ?
          ORDER BY granted_at ASC`,
      )
      .all(userId, capability) as unknown as readonly CapabilityConsentRow[];
    return rows.map(mapRow).filter((record): record is CapabilityConsentRecord => record !== null);
  }
  const rows = database
    .prepare(
      `SELECT id, user_id, capability, version_id, granted_at, revoked_at
         FROM candidate_capability_consents
        WHERE user_id = ?
        ORDER BY granted_at ASC`,
    )
    .all(userId) as unknown as readonly CapabilityConsentRow[];
  return rows.map(mapRow).filter((record): record is CapabilityConsentRecord => record !== null);
}

export function deleteCapabilityConsentsForUser(database: DatabaseSync, userId: string): number {
  ensureCapabilityConsentsSchema(database);
  const result = database
    .prepare('DELETE FROM candidate_capability_consents WHERE user_id = ?')
    .run(userId);
  return Number(result.changes);
}

/** Самоудаление: у кандидата есть строка в users; запись под id кандидата тоже уходит. */
export function deleteCapabilityConsentsForCandidate(
  database: DatabaseSync,
  candidateId: string,
): number {
  ensureCapabilityConsentsSchema(database);
  const hasUsers = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get() !== undefined;
  if (!hasUsers) return deleteCapabilityConsentsForUser(database, candidateId);
  const result = database
    .prepare(
      `DELETE FROM candidate_capability_consents
        WHERE user_id = ? OR user_id IN (SELECT id FROM users WHERE candidate_id = ?)`,
    )
    .run(candidateId, candidateId);
  return Number(result.changes);
}

export function purgeExpiredCapabilityConsents(
  database: DatabaseSync,
  cutoffIso: string,
  limit = 500,
): number {
  ensureCapabilityConsentsSchema(database);
  const result = database
    .prepare(
      `DELETE FROM candidate_capability_consents
        WHERE id IN (
          SELECT id FROM candidate_capability_consents
           WHERE revoked_at IS NOT NULL
             AND revoked_at < ?
           LIMIT ?
        )`,
    )
    .run(cutoffIso, limit);
  return Number(result.changes);
}

export class SqliteCapabilityConsentStore {
  private readonly database: DatabaseSync;
  private readonly ownsDatabase: boolean;

  constructor(options: DatabaseSync | { databasePath: string }) {
    if (options instanceof DatabaseSync) {
      this.database = options;
      this.ownsDatabase = false;
    } else {
      this.database = new DatabaseSync(options.databasePath);
      this.database.exec('PRAGMA journal_mode = WAL;');
      applySqliteBusyTimeout(this.database);
      this.ownsDatabase = true;
    }
    ensureCapabilityConsentsSchema(this.database);
  }

  getDatabase(): DatabaseSync {
    return this.database;
  }

  recordConsent(input: {
    userId: string;
    capability: CandidateCapability;
    versionId: string;
    grantedAt?: string;
  }): CapabilityConsentRecord {
    return recordCapabilityConsent(this.database, input);
  }

  revokeConsent(
    userId: string,
    capability: CandidateCapability,
    revokedAt?: string,
  ): CapabilityConsentRecord | null {
    return revokeCapabilityConsent(this.database, userId, capability, revokedAt);
  }

  getActiveConsent(userId: string, capability: CandidateCapability): CapabilityConsentRecord | null {
    return getActiveCapabilityConsent(this.database, userId, capability);
  }

  listConsents(userId: string, capability?: CandidateCapability): readonly CapabilityConsentRecord[] {
    return listCapabilityConsents(this.database, userId, capability);
  }

  deleteForCandidate(candidateId: string): number {
    return deleteCapabilityConsentsForCandidate(this.database, candidateId);
  }

  deleteForUser(userId: string): number {
    return deleteCapabilityConsentsForUser(this.database, userId);
  }

  purgeExpired(cutoffIso: string, limit = 500): number {
    return purgeExpiredCapabilityConsents(this.database, cutoffIso, limit);
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
}
