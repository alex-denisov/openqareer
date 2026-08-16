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
const PASSWORD_RESET_HOURS = 1;

export type UserRole = 'candidate' | 'admin';

export interface AuthPrincipal {
  userId: string;
  username: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
  isTest: boolean;
  candidate: CandidateIdentity | null;
}

export interface RegistrationProfile {
  email?: string;
  displayName?: string;
}

export interface AccountSnapshot {
  username: string;
  email: string | null;
  displayName: string | null;
  profile: {
    headline: string | null;
    location: string | null;
    workMode: 'office' | 'hybrid' | 'remote' | 'flexible' | null;
    updatedAt: string | null;
  };
  sessions: Array<{
    id: string;
    current: boolean;
    createdAt: string;
    lastSeenAt: string;
    expiresAt: string;
  }>;
}

export interface AccountProfileUpdate {
  email?: string | null;
  displayName?: string | null;
  headline?: string | null;
  location?: string | null;
  workMode?: AccountSnapshot['profile']['workMode'];
}

export interface PasswordResetDelivery {
  email: string;
  displayName: string | null;
  token: string;
}

export interface SeedAccount {
  username: string;
  password: string;
  role: UserRole;
}

export interface SessionAuth {
  register(
    usernameInput: string,
    password: string,
    candidateStore: CandidateStore,
    profile?: RegistrationProfile,
  ): Promise<{ principal: AuthPrincipal; sessionToken: string }>;
  login(
    identifierInput: string,
    password: string,
  ): Promise<{ principal: AuthPrincipal; sessionToken: string } | null>;
  /** Lets the caller resolve collisions for handles it derives itself. */
  isUsernameTaken(username: string): boolean;
  authenticate(sessionToken: string): AuthPrincipal | null;
  logout(sessionToken: string): void;
  getAccount?(sessionToken: string): AccountSnapshot | null;
  updateAccount?(
    sessionToken: string,
    input: AccountProfileUpdate,
  ): AccountSnapshot | null;
  changePassword?(
    sessionToken: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ principal: AuthPrincipal; sessionToken: string } | null>;
  requestPasswordReset?(identifier: string): Promise<void>;
  resetPassword?(
    token: string,
    newPassword: string,
  ): Promise<{ principal: AuthPrincipal; sessionToken: string }>;
  revokeOtherSessions?(sessionToken: string): number | null;
}

interface AuthServiceOptions {
  databasePath: string;
  onPasswordReset?: (input: PasswordResetDelivery) => Promise<void>;
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
  email: string | null;
  display_name: string | null;
  headline: string | null;
  location: string | null;
  work_mode: AccountSnapshot['profile']['workMode'];
  profile_updated_at: string | null;
}

interface SessionRow {
  token_hash: string;
  expires_at: string;
  created_at: string;
  last_seen_at: string;
}

interface PasswordResetRow extends UserRow {
  reset_expires_at: string;
}

export class AuthService implements SessionAuth {
  private readonly database: DatabaseSync;
  private readonly onPasswordReset?: AuthServiceOptions['onPasswordReset'];

  constructor(options: AuthServiceOptions) {
    this.onPasswordReset = options.onPasswordReset;
    this.database = new DatabaseSync(options.databasePath, {
      timeout: 5_000,
      enableForeignKeyConstraints: true,
      defensive: true,
    });
    this.database.exec('PRAGMA journal_mode = WAL;');
    this.migrate();
  }

  async register(
    usernameInput: string,
    password: string,
    candidateStore: CandidateStore,
    profile: RegistrationProfile = {},
  ): Promise<{ principal: AuthPrincipal; sessionToken: string }> {
    const username = normalizeUsername(usernameInput);
    const email = profile.email ? normalizeEmail(profile.email) : null;
    const displayName = profile.displayName?.trim() || null;
    if (this.findUser(username)) throw new AuthUsernameTakenError();
    const salt = randomBytes(16);
    const passwordHash = await derivePassword(password, salt);
    const candidate = candidateStore.createCandidate({
      dataClass: 'personal',
      locale: 'ru-RU',
    });
    const now = new Date().toISOString();
    try {
      this.database
        .prepare(
          `INSERT INTO users
            (id, username, email, display_name, role, password_salt,
             password_hash, candidate_id, is_test, created_at, updated_at,
             profile_updated_at)
           VALUES (?, ?, ?, ?, 'candidate', ?, ?, ?, 0, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          username,
          email,
          displayName,
          salt.toString('base64'),
          passwordHash.toString('base64'),
          candidate.id,
          now,
          now,
          now,
        );
    } catch (error) {
      candidateStore.deleteCandidate(candidate.id);
      if (this.findUser(username)) throw new AuthUsernameTakenError();
      if (email && this.findUserByEmail(email)) {
        throw new AuthEmailTakenError();
      }
      throw error;
    }
    const authenticated = await this.login(username, password);
    if (!authenticated) throw new Error('registered account cannot authenticate');
    return authenticated;
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

  /**
   * B139 removed the login field from registration, so handles are derived
   * rather than chosen. Callers need to see collisions to resolve them.
   */
  isUsernameTaken(username: string): boolean {
    return this.findUser(normalizeUsername(username)) !== null;
  }

  async login(
    identifierInput: string,
    password: string,
  ): Promise<{ principal: AuthPrincipal; sessionToken: string } | null> {
    const identifier = normalizeUsername(identifierInput);
    // Accounts created before B139 have a handle their owner typed and knows;
    // accounts created after it only ever saw their email. Both must sign in.
    const user = identifier.includes('@')
      ? (this.findUserByEmail(normalizeEmail(identifier)) ?? this.findUser(identifier))
      : this.findUser(identifier);
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

  getAccount(sessionToken: string): AccountSnapshot | null {
    const principal = this.authenticate(sessionToken);
    if (!principal) return null;
    const user = this.findUserById(principal.userId);
    if (!user) return null;
    const currentTokenHash = hashToken(sessionToken);
    const sessions = this.database
      .prepare(
        `SELECT token_hash, expires_at, created_at, last_seen_at
         FROM sessions
         WHERE user_id = ? AND expires_at > ?
         ORDER BY last_seen_at DESC, created_at DESC`,
      )
      .all(user.id, new Date().toISOString()) as unknown as SessionRow[];
    return {
      username: user.username,
      email: user.email,
      displayName: user.display_name,
      profile: {
        headline: user.headline,
        location: user.location,
        workMode: user.work_mode,
        updatedAt: user.profile_updated_at,
      },
      sessions: sessions.map((session) => ({
        id: session.token_hash.slice(0, 16),
        current: session.token_hash === currentTokenHash,
        createdAt: session.created_at,
        lastSeenAt: session.last_seen_at,
        expiresAt: session.expires_at,
      })),
    };
  }

  updateAccount(
    sessionToken: string,
    input: AccountProfileUpdate,
  ): AccountSnapshot | null {
    const principal = this.authenticate(sessionToken);
    if (!principal) return null;
    const user = this.findUserById(principal.userId);
    if (!user) return null;
    const email =
      input.email === undefined
        ? user.email
        : input.email
          ? normalizeEmail(input.email)
          : null;
    const owner = email ? this.findUserByEmail(email) : null;
    if (owner && owner.id !== user.id) throw new AuthEmailTakenError();
    const normalizeNullable = (
      value: string | null | undefined,
      fallback: string | null,
    ) => (value === undefined ? fallback : value?.trim() || null);
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE users
         SET email = ?, display_name = ?, headline = ?, location = ?,
             work_mode = ?, profile_updated_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        email,
        normalizeNullable(input.displayName, user.display_name),
        normalizeNullable(input.headline, user.headline),
        normalizeNullable(input.location, user.location),
        input.workMode === undefined ? user.work_mode : input.workMode,
        now,
        now,
        user.id,
      );
    return this.getAccount(sessionToken);
  }

  async changePassword(
    sessionToken: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ principal: AuthPrincipal; sessionToken: string } | null> {
    const principal = this.authenticate(sessionToken);
    if (!principal) return null;
    const user = this.findUserById(principal.userId);
    if (!user) return null;
    const currentHash = await derivePassword(
      currentPassword,
      Buffer.from(user.password_salt, 'base64'),
    );
    if (
      !timingSafeEqual(
        currentHash,
        Buffer.from(user.password_hash, 'base64'),
      )
    ) {
      throw new AuthInvalidPasswordError();
    }
    const salt = randomBytes(16);
    const passwordHash = await derivePassword(newPassword, salt);
    const now = new Date().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `UPDATE users
           SET password_salt = ?, password_hash = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          salt.toString('base64'),
          passwordHash.toString('base64'),
          now,
          user.id,
        );
      this.database
        .prepare('DELETE FROM sessions WHERE user_id = ?')
        .run(user.id);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    const authenticated = await this.login(user.username, newPassword);
    if (!authenticated) throw new Error('changed password cannot authenticate');
    return authenticated;
  }

  async requestPasswordReset(identifierInput: string): Promise<void> {
    const identifier = identifierInput.trim().toLowerCase();
    const user = identifier.includes('@')
      ? this.findUserByEmail(identifier)
      : this.findUser(identifier);
    if (!user?.email || !this.onPasswordReset) return;
    const token = `oqr_${randomBytes(32).toString('base64url')}`;
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + PASSWORD_RESET_HOURS * 60 * 60 * 1_000,
    );
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `DELETE FROM password_reset_tokens
           WHERE user_id = ? OR expires_at <= ?`,
        )
        .run(user.id, now.toISOString());
      this.database
        .prepare(
          `INSERT INTO password_reset_tokens
            (token_hash, user_id, expires_at, consumed_at, created_at)
           VALUES (?, ?, ?, NULL, ?)`,
        )
        .run(
          hashToken(token),
          user.id,
          expiresAt.toISOString(),
          now.toISOString(),
        );
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    await this.onPasswordReset({
      email: user.email,
      displayName: user.display_name,
      token,
    });
  }

  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ principal: AuthPrincipal; sessionToken: string }> {
    if (!/^oqr_[A-Za-z0-9_-]{40,}$/.test(token)) {
      throw new AuthInvalidResetTokenError();
    }
    const now = new Date().toISOString();
    const row = this.database
      .prepare(
        `${USER_SELECT}
         JOIN password_reset_tokens
           ON password_reset_tokens.user_id = users.id
         WHERE password_reset_tokens.token_hash = ?
           AND password_reset_tokens.consumed_at IS NULL
           AND password_reset_tokens.expires_at > ?`,
      )
      .get(hashToken(token), now) as PasswordResetRow | undefined;
    if (!row) throw new AuthInvalidResetTokenError();
    const salt = randomBytes(16);
    const passwordHash = await derivePassword(newPassword, salt);
    this.commitPasswordReset(row.id, token, salt, passwordHash, now);
    const authenticated = await this.login(row.username, newPassword);
    if (!authenticated) throw new Error('reset password cannot authenticate');
    return authenticated;
  }

  private commitPasswordReset(
    userId: string,
    token: string,
    salt: Buffer,
    passwordHash: Buffer,
    now: string,
  ): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const consumed = this.database
        .prepare(
          `UPDATE password_reset_tokens
           SET consumed_at = ?
           WHERE token_hash = ? AND consumed_at IS NULL`,
        )
        .run(now, hashToken(token));
      if (consumed.changes !== 1) throw new AuthInvalidResetTokenError();
      this.database
        .prepare(
          `UPDATE users
           SET password_salt = ?, password_hash = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          salt.toString('base64'),
          passwordHash.toString('base64'),
          now,
          userId,
        );
      this.database
        .prepare('DELETE FROM sessions WHERE user_id = ?')
        .run(userId);
      this.database
        .prepare(
          `DELETE FROM password_reset_tokens
           WHERE user_id = ? AND token_hash <> ?`,
        )
        .run(userId, hashToken(token));
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  revokeOtherSessions(sessionToken: string): number | null {
    const principal = this.authenticate(sessionToken);
    if (!principal) return null;
    const result = this.database
      .prepare(
        `DELETE FROM sessions
         WHERE user_id = ? AND token_hash <> ?`,
      )
      .run(principal.userId, hashToken(sessionToken));
    return Number(result.changes);
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

  private findUserById(userId: string): UserRow | null {
    return (
      (this.database
        .prepare(`${USER_SELECT} WHERE users.id = ?`)
        .get(userId) as UserRow | undefined) ?? null
    );
  }

  private findUserByEmail(email: string): UserRow | null {
    return (
      (this.database
        .prepare(`${USER_SELECT} WHERE users.email = ?`)
        .get(email) as UserRow | undefined) ?? null
    );
  }
}

export class AuthUsernameTakenError extends Error {
  constructor() {
    super('username is already registered');
    this.name = 'AuthUsernameTakenError';
  }
}

export class AuthEmailTakenError extends Error {
  constructor() {
    super('email is already registered');
    this.name = 'AuthEmailTakenError';
  }
}

export class AuthInvalidPasswordError extends Error {
  constructor() {
    super('current password is invalid');
    this.name = 'AuthInvalidPasswordError';
  }
}

export class AuthInvalidResetTokenError extends Error {
  constructor() {
    super('password reset token is invalid or expired');
    this.name = 'AuthInvalidResetTokenError';
  }
}

const USER_SELECT = `
  SELECT users.id, users.username, users.role, users.password_salt,
         users.password_hash, users.is_test, users.candidate_id,
         users.email, users.display_name, users.headline, users.location,
         users.work_mode, users.profile_updated_at,
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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function principalFromRow(row: UserRow): AuthPrincipal {
  return {
    userId: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
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
