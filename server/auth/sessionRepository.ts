import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

const CLIENT_DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const LEGACY_SESSION_IDLE_MS = 24 * 60 * 60 * 1000;

/** Enough of the device hash to match log lines to one device; never the token or the raw id. */
const LOGGED_DEVICE_HASH_LENGTH = 12;

export type SessionDeletionReason = 'expired' | 'same-device-login' | 'stale-legacy-session';

export interface SessionDeletionLog {
  info(fields: Record<string, unknown>, message: string): void;
}

export function ensureSessionDeviceHashSchema(database: DatabaseSync): void {
  const columns = database.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'device_id_hash')) {
    database.exec('ALTER TABLE sessions ADD COLUMN device_id_hash TEXT;');
  }
  database.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS sessions_user_device
     ON sessions(user_id, device_id_hash)
     WHERE device_id_hash IS NOT NULL;`,
  );
}

export function storeAuthSession(
  database: DatabaseSync,
  input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    now: Date;
    clientDeviceId?: string;
  },
  log?: SessionDeletionLog,
): void {
  const deviceIdHash = hashClientDeviceId(input.clientDeviceId);
  const deletions: SessionDeletion[] = [];
  database.exec('BEGIN IMMEDIATE');
  try {
    const expired = database
      .prepare('DELETE FROM sessions WHERE expires_at <= ?')
      .run(input.now.toISOString());
    deletions.push({ reason: 'expired', deleted: Number(expired.changes) });
    if (deviceIdHash) {
      deletions.push(
        ...deleteReplacedDeviceSessions(database, input.userId, deviceIdHash, input.now),
      );
    }
    database
      .prepare(
        `INSERT INTO sessions
          (token_hash, user_id, expires_at, created_at, last_seen_at, device_id_hash)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.tokenHash,
        input.userId,
        input.expiresAt.toISOString(),
        input.now.toISOString(),
        input.now.toISOString(),
        deviceIdHash,
      );
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  logSessionDeletions(log, deletions, input.userId, deviceIdHash);
}

type SessionDeletion = { reason: SessionDeletionReason; deleted: number };

function deleteReplacedDeviceSessions(
  database: DatabaseSync,
  userId: string,
  deviceIdHash: string,
  now: Date,
): SessionDeletion[] {
  // PRB-041: вход с того же устройства молча выкидывал прежнюю сессию — теперь это видно в журнале.
  const replaced = database
    .prepare('DELETE FROM sessions WHERE user_id = ? AND device_id_hash = ?')
    .run(userId, deviceIdHash);
  // Старые токены без устройства, которыми давно не пользовались, заменяет эта сессия.
  const staleBefore = new Date(now.getTime() - LEGACY_SESSION_IDLE_MS).toISOString();
  const stale = database
    .prepare(
      'DELETE FROM sessions WHERE user_id = ? AND device_id_hash IS NULL AND last_seen_at < ?',
    )
    .run(userId, staleBefore);
  return [
    { reason: 'same-device-login', deleted: Number(replaced.changes) },
    { reason: 'stale-legacy-session', deleted: Number(stale.changes) },
  ];
}

function logSessionDeletions(
  log: SessionDeletionLog | undefined,
  deletions: readonly SessionDeletion[],
  userId: string,
  deviceIdHash: string | null,
): void {
  for (const { reason, deleted } of deletions) {
    if (!log || deleted === 0) continue;
    // Истёкшие сессии чужие: у этой выборки нет ни пользователя, ни устройства входа.
    const owner =
      reason === 'expired'
        ? {}
        : { userId, deviceIdHash: deviceIdHash?.slice(0, LOGGED_DEVICE_HASH_LENGTH) };
    log.info({ reason, deleted, ...owner }, 'auth-sessions-deleted');
  }
}

function hashClientDeviceId(deviceId?: string): string | null {
  if (!deviceId || !CLIENT_DEVICE_ID_PATTERN.test(deviceId)) return null;
  return createHash('sha256').update(deviceId.toLowerCase()).digest('hex');
}
