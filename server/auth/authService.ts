import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import type { CandidateIdentity, CandidateStore } from '../data/candidateStore';
import {
  MIGRATION_2,
  MIGRATION_17,
  MIGRATION_18,
  MIGRATION_22,
  MIGRATION_29,
} from '../data/sqliteSchema';
import {
  listConsents,
  purgeExpiredRetention,
  recordLegalConsent,
  stampContractEnd,
} from './legalConsentStore';
import type { LegalConsentRecord, RetentionSweepResult } from './legalConsentStore';
import type {
  UserRole,
  AuthPrincipal,
  RegistrationProfile,
  AccountSnapshot,
  AccountProfileUpdate,
  PasswordResetDelivery,
  SeedAccount,
  AdminUserRecord,
  AdminUserPage,
  AdminUserQuery,
  AdminAuditPage,
  AdminUserUpdateInput,
  SessionAuth,
} from './authTypes';
import {
  AuthUsernameTakenError,
  AuthEmailTakenError,
  AuthInvalidPasswordError,
  AuthInvalidResetTokenError,
  AuthUserBlockedError,
} from './authErrors';
import { isReservedUsername } from '../../shared/reservedUsernames';
import {
  listUsers as adminListUsers,
  getUser as adminGetUser,
  setUserRole as adminSetUserRole,
  setUserBlocked as adminSetUserBlocked,
  updateUserByAdmin as adminUpdateUser,
  adminSetUserPassword as adminSetPassword,
  deleteUserByAdmin as adminDeleteUser,
  listAudit as adminListAudit,
  recordAdminAudit,
} from './adminUserManager';

const scrypt = promisify(scryptCallback);
const SESSION_HOURS = 12;
const PASSWORD_RESET_HOURS = 1;

export type {
  UserRole,
  AuthPrincipal,
  RegistrationProfile,
  AccountSnapshot,
  AccountProfileUpdate,
  PasswordResetDelivery,
  SeedAccount,
  AdminUserRecord,
  AdminUserPage,
  AdminUserQuery,
  AdminAuditPage,
  AdminUserUpdateInput,
  SessionAuth,
} from './authTypes';

export {
  AuthUsernameTakenError,
  AuthEmailTakenError,
  AuthInvalidPasswordError,
  AuthInvalidResetTokenError,
} from './authErrors';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';

interface AuthServiceOptions {
  databasePath: string;
  onPasswordReset?: (input: PasswordResetDelivery) => Promise<void>;
  candidateStore?: CandidateStore;
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
  blocked_at: string | null;
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
  private candidateStore?: CandidateStore;

  constructor(options: AuthServiceOptions) {
    this.onPasswordReset = options.onPasswordReset;
    this.candidateStore = options.candidateStore;
    this.database = new DatabaseSync(options.databasePath, {
      timeout: 5_000,
      enableForeignKeyConstraints: true,
      defensive: true,
    });
    this.database.exec('PRAGMA journal_mode = WAL;');
    applySqliteBusyTimeout(this.database);
    this.migrate();
  }

  setCandidateStore(candidateStore: CandidateStore): void {
    this.candidateStore = candidateStore;
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
    if (isReservedUsername(username) || this.findUser(username)) {
      throw new AuthUsernameTakenError();
    }
    const salt = randomBytes(16);
    const passwordHash = await derivePassword(password, salt);
    const candidate = candidateStore.createCandidate({
      dataClass: 'personal',
      locale: 'ru-RU',
    });
    const now = new Date().toISOString();
    try {
      this.insertRegisteredUser(
        username,
        email,
        displayName,
        salt,
        passwordHash,
        candidate.id,
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

  private insertRegisteredUser(
    username: string,
    email: string | null,
    displayName: string | null,
    salt: Buffer,
    passwordHash: Buffer,
    candidateId: string,
    now: string,
  ): void {
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
        candidateId,
        now,
        now,
        now,
      );
  }

  async seedAccounts(accounts: SeedAccount[], candidateStore: CandidateStore): Promise<void> {
    for (const account of accounts) {
      const username = normalizeUsername(account.username);
      const existing = this.findUser(username);
      if (existing && existing.role !== account.role) {
        throw new Error('seed account role cannot change');
      }
      let candidateId = account.role === 'candidate' ? (existing?.candidate_id ?? null) : null;
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

  isUsernameTaken(username: string): boolean {
    const normalized = normalizeUsername(username);
    return isReservedUsername(normalized) || this.findUser(normalized) !== null;
  }

  async login(
    identifierInput: string,
    password: string,
  ): Promise<{ principal: AuthPrincipal; sessionToken: string } | null> {
    const identifier = normalizeUsername(identifierInput);
    const user = identifier.includes('@')
      ? (this.findUserByEmail(normalizeEmail(identifier)) ?? this.findUser(identifier))
      : this.findUser(identifier);

    if (!user) return null;
    if (user.blocked_at) throw new AuthUserBlockedError();

    const salt = Buffer.from(user.password_salt, 'base64');
    const expected = Buffer.from(user.password_hash, 'base64');
    const actual = await derivePassword(password, salt);
    if (!timingSafeEqual(actual, expected)) {
      return null;
    }

    const sessionToken = `oqs_${randomBytes(32).toString('base64url')}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1_000);
    this.database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString());
    this.database
      .prepare(
        `INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_seen_at)
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
         WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.blocked_at IS NULL`,
      )
      .get(hashToken(sessionToken), now) as UserRow | undefined;
    if (!row) {
      return null;
    }
    this.database
      .prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?')
      .run(now, hashToken(sessionToken));
    return principalFromRow(row);
  }

  logout(sessionToken: string): void {
    this.database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(sessionToken));
  }

  listUsers(input: AdminUserQuery): AdminUserPage {
    return adminListUsers(this.database, input);
  }

  getUser(userId: string): AdminUserRecord | null {
    return adminGetUser(this.database, userId);
  }

  setUserRole(
    targetUserId: string,
    newRole: UserRole,
    actorPrincipal?: AuthPrincipal,
  ): AdminUserRecord {
    if (!this.candidateStore) throw new Error('CandidateStore не инициализирован.');
    return adminSetUserRole(
      this.database,
      this.candidateStore,
      targetUserId,
      newRole,
      actorPrincipal,
    );
  }

  setUserBlocked(
    targetUserId: string,
    blocked: boolean,
    actorPrincipal?: AuthPrincipal,
  ): AdminUserRecord {
    return adminSetUserBlocked(this.database, targetUserId, blocked, actorPrincipal);
  }

  updateUserByAdmin(
    targetUserId: string,
    input: AdminUserUpdateInput,
    actorPrincipal?: AuthPrincipal,
  ): AdminUserRecord {
    return adminUpdateUser(this.database, targetUserId, input, actorPrincipal);
  }

  async adminSetUserPassword(
    targetUserId: string,
    newPassword: string,
    actorPrincipal?: AuthPrincipal,
  ): Promise<void> {
    await adminSetPassword(this.database, targetUserId, newPassword, actorPrincipal);
  }

  async impersonateUser(
    targetUserId: string,
    actorPrincipal?: AuthPrincipal,
  ): Promise<{ principal: AuthPrincipal; sessionToken: string }> {
    const user = adminGetUser(this.database, targetUserId);
    if (!user) throw new Error('Пользователь не найден.');
    if (user.blockedAt) throw new AuthUserBlockedError();

    const userRow = this.findUserById(targetUserId);
    if (!userRow) throw new Error('Пользователь не найден.');

    const sessionToken = `oqs_${randomBytes(32).toString('base64url')}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1_000);
    this.database
      .prepare(
        `INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        hashToken(sessionToken),
        user.id,
        expiresAt.toISOString(),
        now.toISOString(),
        now.toISOString(),
      );

    if (actorPrincipal) {
      recordAdminAudit(this.database, {
        actorUserId: actorPrincipal.userId,
        actorUsername: actorPrincipal.username,
        action: 'impersonate_user',
        subjectUserId: user.id,
        subjectUsername: user.username,
        detail: 'Admin impersonated candidate workspace session',
      });
    }

    return {
      principal: principalFromRow(userRow),
      sessionToken,
    };
  }

  deleteUserByAdmin(targetUserId: string, actorPrincipal?: AuthPrincipal): void {
    if (!this.candidateStore) throw new Error('CandidateStore не инициализирован.');
    adminDeleteUser(this.database, this.candidateStore, targetUserId, actorPrincipal);
    // Договор прекращён — с этой даты идут опубликованные три года хранения
    // записи об акцепте (B195). Само согласие переживает аккаунт: без него
    // доказать принятое было бы нечем.
    stampContractEnd(this.database, targetUserId, new Date().toISOString());
  }

  listAudit(query?: { limit: number; offset: number }): AdminAuditPage {
    return adminListAudit(this.database, query);
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

  updateAccount(sessionToken: string, input: AccountProfileUpdate): AccountSnapshot | null {
    const principal = this.authenticate(sessionToken);
    if (!principal) return null;
    const user = this.findUserById(principal.userId);
    if (!user) return null;
    const email =
      input.email === undefined ? user.email : input.email ? normalizeEmail(input.email) : null;
    const owner = email ? this.findUserByEmail(email) : null;
    if (owner && owner.id !== user.id) throw new AuthEmailTakenError();
    const normalizeNullable = (value: string | null | undefined, fallback: string | null) =>
      value === undefined ? fallback : value?.trim() || null;
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

  /**
   * Stores what the candidate accepted at registration: the exact published
   * version and the moment. Written in the same database as the account, so a
   * user row can never exist without its consent row after B173.
   */
  recordLegalConsent(input: {
    userId: string;
    versionId: string;
    documents: readonly string[];
    acceptedAt?: string;
    contractEndedAt?: string;
  }): void {
    recordLegalConsent(this.database, input);
  }

  /** Записи акцепта одного пользователя (B195). */
  listConsents(userId: string): readonly LegalConsentRecord[] {
    return listConsents(this.database, userId);
  }

  /** Уборка по опубликованной таблице сроков хранения (B195 / PRB-014). */
  purgeExpiredRetention(now: string = new Date().toISOString(), limit = 500): RetentionSweepResult {
    return purgeExpiredRetention(this.database, now, limit);
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
    if (!timingSafeEqual(currentHash, Buffer.from(user.password_hash, 'base64'))) {
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
        .run(salt.toString('base64'), passwordHash.toString('base64'), now, user.id);
      this.database.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
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
    const expiresAt = new Date(now.getTime() + PASSWORD_RESET_HOURS * 60 * 60 * 1_000);
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
        .run(hashToken(token), user.id, expiresAt.toISOString(), now.toISOString());
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
        .run(salt.toString('base64'), passwordHash.toString('base64'), now, userId);
      this.database.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
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
          .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)')
          .run(new Date().toISOString());
        this.database.exec('COMMIT');
      } catch (error) {
        this.database.exec('ROLLBACK');
        throw error;
      }
    }
    try {
      this.database.exec(MIGRATION_17);
    } catch {
      // audit table migration fail-open
    }
    try {
      this.database.exec(MIGRATION_18);
    } catch {
      // schema migration fail-open
    }
    try {
      this.database.exec(MIGRATION_22);
    } catch {
      // legal consent table migration fail-open
    }
    try {
      this.database.exec(MIGRATION_29);
    } catch {
      // contract-end column already present
    }
    // Administrators are provisioned only from configured seed accounts
    // (OPENQAREER_ADMIN_USERNAME/PASSWORD), and `seedAccounts` refuses to
    // change an existing user's role. A previous hardcoded handle list granted
    // `admin` to whoever happened to own the username — and registration is
    // public, so choosing that username was a privilege escalation that fired
    // on the next deploy (INC-025).
  }

  private findUser(username: string): UserRow | null {
    return (
      (this.database.prepare(`${USER_SELECT} WHERE users.username = ?`).get(username) as
        UserRow | undefined) ?? null
    );
  }

  private findUserById(userId: string): UserRow | null {
    return (
      (this.database.prepare(`${USER_SELECT} WHERE users.id = ?`).get(userId) as
        UserRow | undefined) ?? null
    );
  }

  private findUserByEmail(email: string): UserRow | null {
    return (
      (this.database.prepare(`${USER_SELECT} WHERE users.email = ?`).get(email) as
        UserRow | undefined) ?? null
    );
  }
}

const USER_SELECT = `
  SELECT users.id, users.username, users.role, users.password_salt,
         users.password_hash, users.is_test, users.candidate_id,
         users.email, users.display_name, users.headline, users.location,
         users.work_mode, users.blocked_at, users.profile_updated_at,
         users.created_at AS user_created_at,
         candidates.data_class, candidates.locale,
         candidates.created_at AS candidate_created_at
  FROM users
  LEFT JOIN candidates ON candidates.id = users.candidate_id
`;

async function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
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
      row.candidate_id && row.data_class && row.locale && row.candidate_created_at
        ? {
            id: row.candidate_id,
            dataClass: row.data_class,
            locale: row.locale,
            createdAt: row.candidate_created_at,
          }
        : null,
  };
}
