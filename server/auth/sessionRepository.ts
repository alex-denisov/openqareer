import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

const CLIENT_DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const LEGACY_SESSION_IDLE_MS = 24 * 60 * 60 * 1000;

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
): void {
  const deviceIdHash = hashClientDeviceId(input.clientDeviceId);
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(input.now.toISOString());
    if (deviceIdHash) {
      database
        .prepare('DELETE FROM sessions WHERE user_id = ? AND device_id_hash = ?')
        .run(input.userId, deviceIdHash);
      // Старые токены без устройства, которыми давно не пользовались, заменяет эта сессия.
      const staleBefore = new Date(input.now.getTime() - LEGACY_SESSION_IDLE_MS).toISOString();
      database
        .prepare(
          'DELETE FROM sessions WHERE user_id = ? AND device_id_hash IS NULL AND last_seen_at < ?',
        )
        .run(input.userId, staleBefore);
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
}

function hashClientDeviceId(deviceId?: string): string | null {
  if (!deviceId || !CLIENT_DEVICE_ID_PATTERN.test(deviceId)) return null;
  return createHash('sha256').update(deviceId.toLowerCase()).digest('hex');
}
