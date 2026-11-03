import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  ensureSessionDeviceHashSchema,
  storeAuthSession,
  type SessionDeletionLog,
} from './sessionRepository';

const DEVICE = '0f8fad5b-d9cb-469f-a165-70867728950e';
const NOW = new Date('2026-11-03T10:00:00.000Z');

function openDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)`);
  ensureSessionDeviceHashSchema(database);
  return database;
}

function recorder(): { log: SessionDeletionLog; lines: Array<Record<string, unknown>> } {
  const lines: Array<Record<string, unknown>> = [];
  return { lines, log: { info: (fields, message) => lines.push({ ...fields, msg: message }) } };
}

function login(database: DatabaseSync, tokenHash: string, log?: SessionDeletionLog, at = NOW) {
  storeAuthSession(
    database,
    {
      userId: 'user-1',
      tokenHash,
      expiresAt: new Date(at.getTime() + 60_000),
      now: at,
      clientDeviceId: DEVICE,
    },
    log,
  );
}

describe('session deletion log (PRB-041)', () => {
  it('names the reason, user and device when a login from the same device replaces a session', () => {
    const database = openDatabase();
    login(database, 'token-hash-first');
    const { log, lines } = recorder();

    login(database, 'token-hash-second', log);

    expect(lines).toEqual([
      expect.objectContaining({
        msg: 'auth-sessions-deleted',
        reason: 'same-device-login',
        userId: 'user-1',
        deleted: 1,
        deviceIdHash: expect.stringMatching(/^[0-9a-f]{12}$/u),
      }),
    ]);
  });

  it('logs expired sessions swept on login, without user or device', () => {
    const database = openDatabase();
    login(database, 'token-hash-old', undefined, new Date(NOW.getTime() - 120_000));
    const { log, lines } = recorder();

    storeAuthSession(
      database,
      { userId: 'user-2', tokenHash: 'token-hash-other', expiresAt: NOW, now: NOW },
      log,
    );

    expect(lines).toEqual([{ msg: 'auth-sessions-deleted', reason: 'expired', deleted: 1 }]);
  });

  it('logs stale sessions without a device that a device login replaces', () => {
    const database = openDatabase();
    const longAgo = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    database
      .prepare(
        `INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_seen_at)
         VALUES ('legacy', 'user-1', ?, ?, ?)`,
      )
      .run(new Date(NOW.getTime() + 60_000).toISOString(), longAgo, longAgo);
    const { log, lines } = recorder();

    login(database, 'token-hash-new', log);

    expect(lines).toEqual([
      expect.objectContaining({ reason: 'stale-legacy-session', userId: 'user-1', deleted: 1 }),
    ]);
  });

  it('logs nothing when nothing is deleted and never logs a token', () => {
    const database = openDatabase();
    const { log, lines } = recorder();

    login(database, 'token-hash-first', log);
    login(database, 'token-hash-second', log);

    expect(lines).toHaveLength(1);
    expect(JSON.stringify(lines)).not.toMatch(/token-hash|0f8fad5b/u);
  });
});
