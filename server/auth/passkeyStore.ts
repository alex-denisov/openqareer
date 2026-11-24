import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';
import { PASSKEY_SCHEMA } from './passkeySchema';

const CHALLENGE_MS = 5 * 60_000;
const TOKEN_PATTERN = /^oqp_[A-Za-z0-9_-]{40,}$/u;

export type PasskeyPurpose = 'register' | 'login';

export interface StoredPasskey {
  readonly id: string;
  readonly userId: string;
  /** Имя входа владельца: по нему вход проверяет флаг нового кабинета. */
  readonly username: string;
  readonly credentialId: string;
  readonly publicKey: Uint8Array<ArrayBuffer>;
  readonly signCount: number;
  readonly transports: readonly string[];
}

/** То, что видит владелец: название устройства и даты, без ключей. */
export interface PasskeySummary {
  readonly id: string;
  readonly deviceLabel: string | null;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

export interface NewPasskey {
  readonly credentialId: string;
  readonly publicKey: Uint8Array;
  readonly signCount: number;
  readonly transports: readonly string[];
  readonly backedUp: boolean;
  readonly deviceLabel: string | null;
}

interface PasskeyRow {
  id: string;
  user_id: string;
  username: string;
  credential_id: string;
  public_key: Uint8Array;
  sign_count: number;
  transports_json: string;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

function parseTransports(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

/** B755: ключи доступа пользователя и одноразовые вызовы (5 минут, в базе только отпечаток токена). */
export class PasskeyStore {
  private readonly database: DatabaseSync;

  constructor(options: { readonly databasePath: string }) {
    this.database = new DatabaseSync(options.databasePath);
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    applySqliteBusyTimeout(this.database);
    this.database.exec(PASSKEY_SCHEMA);
  }

  close(): void {
    this.database.close();
  }

  /** Вызов для регистрации (с пользователем) или входа (`userId = null`); клиенту уходит только токен. */
  createChallenge(
    purpose: PasskeyPurpose,
    userId: string | null,
    challenge: string,
    now: Date,
  ): string {
    const token = `oqp_${randomBytes(32).toString('base64url')}`;
    this.database
      .prepare('DELETE FROM passkey_challenges WHERE expires_at <= ?')
      .run(now.toISOString());
    this.database
      .prepare(
        'INSERT INTO passkey_challenges (token_hash, user_id, purpose, challenge, expires_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        hashToken(token),
        userId,
        purpose,
        challenge,
        new Date(now.getTime() + CHALLENGE_MS).toISOString(),
      );
    return token;
  }

  /** Вызов отдаётся один раз: строка удаляется при чтении, просроченный и чужой по назначению не отдаётся. */
  takeChallenge(
    token: string,
    purpose: PasskeyPurpose,
    now: Date,
  ): { readonly userId: string | null; readonly challenge: string } | null {
    if (!TOKEN_PATTERN.test(token)) return null;
    const row = this.database
      .prepare(
        'DELETE FROM passkey_challenges WHERE token_hash = ? RETURNING user_id, purpose, challenge, expires_at',
      )
      .get(hashToken(token)) as
      | { user_id: string | null; purpose: PasskeyPurpose; challenge: string; expires_at: string }
      | undefined;
    if (!row || row.purpose !== purpose || row.expires_at <= now.toISOString()) return null;
    return { userId: row.user_id, challenge: row.challenge };
  }

  add(userId: string, key: NewPasskey, now: Date): string | null {
    const id = randomUUID();
    try {
      this.database
        .prepare(
          `INSERT INTO user_passkeys
             (id, user_id, credential_id, public_key, sign_count, transports_json, backed_up, device_label, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          userId,
          key.credentialId,
          key.publicKey,
          key.signCount,
          JSON.stringify(key.transports),
          key.backedUp ? 1 : 0,
          key.deviceLabel,
          now.toISOString(),
        );
      return id;
    } catch (error) {
      if (error instanceof Error && /UNIQUE/u.test(error.message)) return null;
      throw error;
    }
  }

  list(userId: string): PasskeySummary[] {
    const rows = this.database
      .prepare(
        'SELECT id, device_label, created_at, last_used_at FROM user_passkeys WHERE user_id = ? ORDER BY created_at DESC, id',
      )
      .all(userId) as Array<{
      id: string;
      device_label: string | null;
      created_at: string;
      last_used_at: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      deviceLabel: row.device_label,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
    }));
  }

  credentialIdsOf(
    userId: string,
  ): Array<{ readonly id: string; readonly transports: readonly string[] }> {
    const rows = this.database
      .prepare('SELECT credential_id, transports_json FROM user_passkeys WHERE user_id = ?')
      .all(userId) as Array<{ credential_id: string; transports_json: string }>;
    return rows.map((row) => ({
      id: row.credential_id,
      transports: parseTransports(row.transports_json),
    }));
  }

  findByCredentialId(credentialId: string): StoredPasskey | null {
    const row = this.database
      .prepare(
        `SELECT p.id, p.user_id, u.username, p.credential_id, p.public_key, p.sign_count, p.transports_json
         FROM user_passkeys p JOIN users u ON u.id = p.user_id
         WHERE p.credential_id = ?`,
      )
      .get(credentialId) as PasskeyRow | undefined;
    return row
      ? {
          id: row.id,
          userId: row.user_id,
          username: row.username,
          credentialId: row.credential_id,
          publicKey: Uint8Array.from(row.public_key),
          signCount: row.sign_count,
          transports: parseTransports(row.transports_json),
        }
      : null;
  }

  /** Счётчик меняется только с того значения, что мы прочли: две одновременные проверки одного ключа не проходят обе. */
  recordUse(id: string, previousCount: number, newCount: number, now: Date): boolean {
    const result = this.database
      .prepare(
        'UPDATE user_passkeys SET sign_count = ?, last_used_at = ? WHERE id = ? AND sign_count = ?',
      )
      .run(newCount, now.toISOString(), id, previousCount);
    return Number(result.changes) === 1;
  }

  /** Удаляет ключ только у владельца; чужой или несуществующий — `false`. */
  remove(userId: string, id: string): boolean {
    const result = this.database
      .prepare('DELETE FROM user_passkeys WHERE id = ? AND user_id = ?')
      .run(id, userId);
    return Number(result.changes) === 1;
  }
}
