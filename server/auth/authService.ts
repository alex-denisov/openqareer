import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import type {
  CandidateIdentity,
  CandidateStore,
} from '../data/candidateStore';
import { MIGRATION_2 } from '../data/sqliteSchema';

const scrypt = promisify(scryptCallback);
const SESSION_HOURS = 12;

export type UserRole = 'candidate' | 'admin';

export interface AuthPrincipal {
  userId: string;
  username: string;
  role: UserRole;
  isTest: boolean;
  candidate: CandidateIdentity | null;
}

export interface SeedAccount {
  username: string;
  password: string;
  role: UserRole;
}

export interface SessionAuth {
  login(
    usernameInput: string,
    password: string,
  ): Promise<{ principal: AuthPrincipal; sessionToken: string } | null>;
  authenticate(sessionToken: string): AuthPrincipal | null;
  logout(sessionToken: string): void;
}

interface AuthServiceOptions {
  databasePath: string;
}

interface UserRow {
  id: string;
  username: string;
  role: UserRole;
  password_salt: string;
  password_hash: string;
  is_test: number;
  candidate_id: string | null;
  data_class: CandidateIdentity['dataClass'] | null;
  locale: CandidateIdentity['locale'] | null;
  candidate_created_at: string | null;
  user_created_at: string;
}

export class AuthService implements SessionAuth {
  private readonly database: DatabaseSync;

  constructor(options: AuthServiceOptions) {
    this.database = new DatabaseSync(options.databasePath, {
      timeout: 5_000,
      enableForeignKeyConstraints: true,
      defensive: true,
    });
    this.database.exec('PRAGMA journal_mode = WAL;');
    this.migrate();
  }

  async seedAccounts(
    accounts: SeedAccount[],
    candidateStore: CandidateStore,
  ): Promise<void> {
    for (const account of accounts) {
      const username = normalizeUsername(account.username);
      const existing = this.findUser(username);
      if (existing && existing.role !== account.role) {
        throw new Error('seed account role cannot change');
      }
      let candidateId =
        account.role === 'candidate' ? (existing?.candidate_id ?? null) : null;
      if (account.role === 'candidate' && !candidateId) {
        candidateId = candidateStore.createCandidate({
          dataClass: 'synthetic',
          locale: 'ru-RU',
        }).id;
      }
      const salt = randomBytes(16);
      const passwordHash = await derivePassword(account.password, salt);
      const now = new Date().toISOString();
      this.database
        .prepare(
          `INSERT INTO users
            (id, username, role, password_salt, password_hash, candidate_id,
             is_test, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
           ON CONFLICT(username) DO UPDATE SET
             role = excluded.role,
             password_salt = excluded.password_salt,
             password_hash = excluded.password_hash,
             candidate_id = excluded.candidate_id,
             is_test = 1,
             updated_at = excluded.updated_at`,
        )
        .run(
          existing?.id ?? randomUUID(),
          username,
          account.role,
          salt.toString('base64'),
          passwordHash.toString('base64'),
          candidateId,
          existing?.user_created_at ?? now,
          now,
        );
    }
  }

  async login(
    usernameInput: string,
    password: string,
  ): Promise<{ principal: AuthPrincipal; sessionToken: string } | null> {
    const username = normalizeUsername(usernameInput);
    const user = this.findUser(username);
    const salt = user
      ? Buffer.from(user.password_salt, 'base64')
      : Buffer.alloc(16, 0);
    const expected = user
      ? Buffer.from(user.password_hash, 'base64')
      : Buffer.alloc(64, 0);
    const actual = await derivePassword(password, salt);
    if (!user || !timingSafeEqual(actual, expected)) {
      return null;
    }

    const sessionToken = `oqs_${randomBytes(32).toString('base64url')}`;
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + SESSION_HOURS * 60 * 60 * 1_000,
    );
    this.database
      .prepare('DELETE FROM sessions WHERE expires_at <= ?')
      .run(now.toISOString());
    this.database
      .prepare(
        `INSERT INTO sessions
          (token_hash, user_id, expires_at, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        hashToken(sessionToken),
        user.id,
        expiresAt.toISOString(),
        now.toISOString(),
        now.toISOString(),
      );
    return {
      principal: principalFromRow(user),
      sessionToken,
    };
  }

  authenticate(sessionToken: string): AuthPrincipal | null {
    if (!/^oqs_[A-Za-z0-9_-]{40,}$/.test(sessionToken)) {
      return null;
    }
    const now = new Date().toISOString();
    const row = this.database
      .prepare(
        `${USER_SELECT}
         JOIN sessions ON sessions.user_id = users.id
         WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
      )
      .get(hashToken(sessionToken), now) as UserRow | undefined;
    if (!row) {
      return null;
    }
    this.database
      .prepare(
        'UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?',
      )
      .run(now, hashToken(sessionToken));
    return principalFromRow(row);
  }

  logout(sessionToken: string): void {
    this.database
      .prepare('DELETE FROM sessions WHERE token_hash = ?')
      .run(hashToken(sessionToken));
  }

  close(): void {
    this.database.close();
  }

  private migrate(): void {
    const row = this.database
      .prepare('SELECT MAX(version) AS version FROM schema_migrations')
      .get() as { version: number | null };
    if ((row.version ?? 0) < 2) {
      this.database.exec('BEGIN IMMEDIATE');
      try {
        this.database.exec(MIGRATION_2);
        this.database
          .prepare(
            'INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)',
          )
          .run(new Date().toISOString());
        this.database.exec('COMMIT');
      } catch (error) {
        this.database.exec('ROLLBACK');
        throw error;
      }
    }
  }

  private findUser(username: string): UserRow | null {
    return (
      (this.database
        .prepare(`${USER_SELECT} WHERE users.username = ?`)
        .get(username) as UserRow | undefined) ?? null
    );
  }
}

const USER_SELECT = `
  SELECT users.id, users.username, users.role, users.password_salt,
         users.password_hash, users.is_test, users.candidate_id,
         users.created_at AS user_created_at,
         candidates.data_class, candidates.locale,
         candidates.created_at AS candidate_created_at
  FROM users
  LEFT JOIN candidates ON candidates.id = users.candidate_id
`;

async function derivePassword(
  password: string,
  salt: Buffer,
): Promise<Buffer> {
  return (await scrypt(password, salt, 64)) as Buffer;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function principalFromRow(row: UserRow): AuthPrincipal {
  return {
    userId: row.id,
    username: row.username,
    role: row.role,
    isTest: row.is_test === 1,
    candidate:
      row.candidate_id &&
      row.data_class &&
      row.locale &&
      row.candidate_created_at
        ? {
            id: row.candidate_id,
            dataClass: row.data_class,
            locale: row.locale,
            createdAt: row.candidate_created_at,
          }
        : null,
  };
}
