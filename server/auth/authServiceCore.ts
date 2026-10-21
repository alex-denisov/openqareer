import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { withEffectiveProTrial } from '../billing/proTrial';
import type { CandidateStore } from '../data/candidateStore';
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
import { revokeAccountSessionForUser } from './revokeAccountSession';
import type {
  UserRole,
  AuthPrincipal,
  RegistrationProfile,
  AccountSnapshot,
  AccountProfileUpdate,
  SeedAccount,
  AdminUserRecord,
  AdminUserPage,
  AdminUserQuery,
  AdminAuditQuery,
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
  AuthEmailDomainUnreachableError,
} from './authErrors';
import { canonicalizeEmail } from './emailNormalization';
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
import { isValidTimezone } from '../../shared/timezoneUtils';
import { ensureSessionDeviceHashSchema, storeAuthSession } from './sessionRepository';
import { ensureAdminAccessSchema } from '../data/adminAccessSchema';
import { createAdminAccessMethods } from './adminAccessMethods';
import { collapseLegacySessions, USER_SELECT, type SessionRow } from './authServiceCoreQueries';
import {
  canonicalEmailOrThrow,
  derivePassword,
  hashToken,
  normalizeEmail,
  normalizeUsername,
  principalFromRow,
  type PasswordResetRow,
  type UserRow,
} from './authCoreUtils';
import { createEmailDomainChecker, DEFAULT_MX_CHECK_BYPASS_DOMAINS } from './emailDomainCheck';
import {
  PASSWORD_RESET_HOURS,
  SESSION_IDLE_MS,
  type AuthServiceOptions,
} from './authCoreTypes';
export { SESSION_IDLE_DAYS } from './authCoreTypes';
export type { AuthServiceOptions } from './authCoreTypes';

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
  AdminAuditQuery,
  AdminAuditPage,
  AdminUserUpdateInput,
  SessionAuth,
} from './authTypes';
export type { UserRow } from './authCoreUtils';
export { canonicalEmailOrThrow, derivePassword, normalizeUsername } from './authCoreUtils';

export {
  AuthUsernameTakenError,
  AuthEmailTakenError,
  AuthInvalidPasswordError,
  AuthInvalidResetTokenError,
  AuthDisposableEmailError,
  AuthEmailDomainUnreachableError,
} from './authErrors';
import { SQLITE_HTTP_BUSY_TIMEOUT_MS, applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';

export class AuthServiceCore implements SessionAuth {
  declare readonly getAdminPermissionSnapshot: NonNullable<
    SessionAuth['getAdminPermissionSnapshot']
  >;
  declare readonly setAdminPermission: NonNullable<SessionAuth['setAdminPermission']>;
  declare readonly listCareerPartnerCandidates: NonNullable<
    SessionAuth['listCareerPartnerCandidates']
  >;
  declare readonly getAssignedCareerPartnerCandidate: NonNullable<
    SessionAuth['getAssignedCareerPartnerCandidate']
  >;
  declare readonly assignCandidateToPartner: NonNullable<SessionAuth['assignCandidateToPartner']>;
  declare readonly removeCandidateFromPartner: NonNullable<
    SessionAuth['removeCandidateFromPartner']
  >;
  protected readonly database: DatabaseSync;
  private readonly onPasswordReset?: AuthServiceOptions['onPasswordReset'];
  protected readonly checkEmailDomain: ReturnType<typeof createEmailDomainChecker>;
  protected candidateStore?: CandidateStore;

  constructor(options: AuthServiceOptions) {
    this.onPasswordReset = options.onPasswordReset;
    this.candidateStore = options.candidateStore;
    this.checkEmailDomain = createEmailDomainChecker({
      resolver: options.emailDomainResolver,
      bypassDomains: options.emailMxCheckBypassDomains ?? DEFAULT_MX_CHECK_BYPASS_DOMAINS,
      onDnsFailure: options.onEmailDomainDnsFailure,
    });
    this.database = new DatabaseSync(options.databasePath, {
      timeout: 5_000,
      enableForeignKeyConstraints: true,
      defensive: true,
    });
    Object.assign(this, createAdminAccessMethods(this.database));
    this.database.exec('PRAGMA journal_mode = WAL;');
    applySqliteBusyTimeout(this.database, SQLITE_HTTP_BUSY_TIMEOUT_MS);
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
    clientDeviceId?: string,
  ): Promise<{ principal: AuthPrincipal; sessionToken: string }> {
    const username = normalizeUsername(usernameInput);
    const email = profile.email ? canonicalEmailOrThrow(profile.email) : null;
    const displayName = profile.displayName?.trim() || null;
    if (isReservedUsername(username) || this.findUser(username)) throw new AuthUsernameTakenError();
    if (email && this.findUserByEmail(email)) throw new AuthEmailTakenError();
    if (email && (await this.checkEmailDomain(email)) === 'unreachable') {
      throw new AuthEmailDomainUnreachableError();
    }
    const salt = randomBytes(16);
    const passwordHash = await derivePassword(password, salt);
    const candidate = candidateStore.createCandidate({ dataClass: 'personal', locale: 'ru-RU' });
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
        profile.timezone,
      );
    } catch (error) {
      candidateStore.deleteCandidate(candidate.id);
      if (this.findUser(username)) throw new AuthUsernameTakenError();
      if (email && this.findUserByEmail(email)) throw new AuthEmailTakenError();
      throw error;
    }
    const authenticated = clientDeviceId
      ? await this.login(username, password, clientDeviceId)
      : await this.login(username, password);
    if (!authenticated) throw new Error('registered account cannot authenticate');
    return authenticated;
  }

  protected insertRegisteredUser(
    username: string,
    email: string | null,
    displayName: string | null,
    salt: Buffer,
    passwordHash: Buffer,
    candidateId: string,
    now: string,
    timezone?: string | null,
  ): void {
    const validTimezone =
      timezone?.trim() && isValidTimezone(timezone.trim()) ? timezone.trim() : null;
    this.database
      .prepare(
        `INSERT INTO users
        (id, username, email, display_name, role, password_salt,
         password_hash, candidate_id, is_test, created_at, updated_at,
         profile_updated_at, timezone)
       VALUES (?, ?, ?, ?, 'candidate', ?, ?, ?, 0, ?, ?, ?, ?)`,
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
        validTimezone,
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
    clientDeviceId?: string,
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
    const expiresAt = new Date(now.getTime() + SESSION_IDLE_MS);
    storeAuthSession(this.database, {
      userId: user.id,
      tokenHash: hashToken(sessionToken),
      expiresAt,
      now,
      clientDeviceId,
    });
    return {
      principal: this.principalForRow(user),
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
    const slidTo = new Date(Date.now() + SESSION_IDLE_MS).toISOString();
    this.database
      .prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?')
      .run(now, slidTo, hashToken(sessionToken));
    return this.principalForRow(row);
  }

  logout(sessionToken: string): void {
    this.database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(sessionToken));
  }

  listUsers(input: AdminUserQuery): AdminUserPage {
    return adminListUsers(this.database, input);
  }

  getUser(userId: string): AdminUserRecord | null {
    const user = adminGetUser(this.database, userId);
    return user ? withEffectiveProTrial(this.database, user, new Date().toISOString()) : null;
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
    const expiresAt = new Date(now.getTime() + SESSION_IDLE_MS);
    storeAuthSession(this.database, {
      userId: user.id,
      tokenHash: hashToken(sessionToken),
      expiresAt,
      now,
    });

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
      principal: this.principalForRow(userRow),
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

  listAudit(query?: AdminAuditQuery): AdminAuditPage {
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
        `SELECT token_hash, expires_at, created_at, last_seen_at, device_id_hash
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
        timezone: user.timezone,
        updatedAt: user.profile_updated_at,
      },
      sessions: collapseLegacySessions(sessions, currentTokenHash).map((session) => ({
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
      input.email === undefined
        ? user.email
        : input.email
          ? canonicalEmailOrThrow(input.email)
          : null;
    const owner = email ? this.findUserByEmail(email) : null;
    if (owner && owner.id !== user.id) throw new AuthEmailTakenError();
    const normalizeNullable = (value: string | null | undefined, fallback: string | null) =>
      value === undefined ? fallback : value?.trim() || null;
    const nextTimezone =
      input.timezone === undefined
        ? user.timezone
        : input.timezone && isValidTimezone(input.timezone)
          ? input.timezone.trim()
          : null;
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE users
         SET email = ?, display_name = ?, headline = ?, location = ?,
             work_mode = ?, timezone = ?, profile_updated_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        email,
        normalizeNullable(input.displayName, user.display_name),
        normalizeNullable(input.headline, user.headline),
        normalizeNullable(input.location, user.location),
        input.workMode === undefined ? user.work_mode : input.workMode,
        nextTimezone,
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

  revokeAccountSession(
    sessionToken: string,
    sessionId: string,
  ): 'revoked' | 'current' | 'not_found' | null {
    const principal = this.authenticate(sessionToken);
    if (!principal) return null;
    return revokeAccountSessionForUser(
      this.database,
      principal.userId,
      hashToken(sessionToken),
      sessionId,
    );
  }

  close(): void {
    this.database.close();
  }

  protected principalForRow(row: UserRow): AuthPrincipal {
    return principalFromRow(row);
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
    try {
      this.database.exec('ALTER TABLE users ADD COLUMN timezone TEXT;');
    } catch {
      // timezone column already exists
    }
    ensureSessionDeviceHashSchema(this.database);
    ensureAdminAccessSchema(this.database);
    // Administrators are provisioned only from configured seed accounts
    // (OPENQAREER_ADMIN_USERNAME/PASSWORD), and `seedAccounts` refuses to
    // change an existing user's role. A previous hardcoded handle list granted
    // `admin` to whoever happened to own the username — and registration is
    // public, so choosing that username was a privilege escalation that fired
    // on the next deploy (INC-025).
  }

  protected findUser(username: string): UserRow | null {
    return (
      (this.database.prepare(`${USER_SELECT} WHERE users.username = ?`).get(username) as
        UserRow | undefined) ?? null
    );
  }

  protected findUserById(userId: string): UserRow | null {
    return (
      (this.database.prepare(`${USER_SELECT} WHERE users.id = ?`).get(userId) as
        UserRow | undefined) ?? null
    );
  }

  protected findUserByEmail(email: string): UserRow | null {
    const canonical = canonicalizeEmail(email);
    const raw = email.trim().toLowerCase();
    const direct = this.database
      .prepare(`${USER_SELECT} WHERE lower(users.email) = ? OR lower(users.email) = ?`)
      .get(canonical, raw) as UserRow | undefined;
    if (direct) return direct;

    const legacy = this.database
      .prepare('SELECT id, email FROM users WHERE email IS NOT NULL')
      .all() as Array<{ id: string; email: string }>;
    const match = legacy.find((user) => canonicalizeEmail(user.email) === canonical);
    return match ? this.findUserById(match.id) : null;
  }
}
