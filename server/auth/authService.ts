import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { CandidateStore } from '../data/candidateStore';
import { MIGRATION_39 } from '../data/sqliteSchema';
import {
  AuthUsernameTakenError,
  AuthEmailTakenError,
  AuthInvalidPasswordError,
  AuthEmailDomainUnreachableError,
  AuthEmailChangeRequiresVerificationError,
  AuthEmailVerificationNotRequiredError,
} from './authErrors';
import { EmailVerificationService } from './emailVerificationService';
import type {
  EmailVerificationAccount,
  EmailVerificationStatus,
} from './emailVerificationService';
import type {
  EmailVerificationDelivery,
  EmailVerificationDeliveryFailure,
} from './emailVerification';
import {
  AuthServiceCore,
  type AuthServiceOptions as AuthServiceCoreOptions,
  type RegistrationProfile,
  type UserRow,
  canonicalEmailOrThrow,
  derivePassword,
  normalizeUsername,
} from './authServiceCore';
import type {
  AccountProfileUpdate,
  AccountSnapshot,
  AdminUserRecord,
  AdminUserUpdateInput,
  AuthPrincipal,
} from './authTypes';
import { DEFAULT_MX_CHECK_BYPASS_DOMAINS } from './emailDomainCheck';
import { isReservedUsername } from '../../shared/reservedUsernames';

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

export {
  AuthServiceCore,
  SESSION_IDLE_DAYS,
} from './authServiceCore';
export {
  AuthUsernameTakenError,
  AuthEmailTakenError,
  AuthInvalidPasswordError,
  AuthInvalidResetTokenError,
  AuthDisposableEmailError,
  AuthEmailDomainUnreachableError,
  AuthEmailChangeRequiresVerificationError,
  AuthEmailVerificationNotRequiredError,
} from './authErrors';

export interface AuthServiceOptions extends AuthServiceCoreOptions {
  emailVerificationRequired?: boolean;
  emailVerificationHashKey?: Buffer;
  emailVerificationFixedCode?: string;
  onEmailVerification?: (input: EmailVerificationDelivery) => Promise<void>;
}

export class AuthService extends AuthServiceCore {
  private readonly emailVerification: EmailVerificationService;
  private readonly emailVerificationRequired: boolean;

  constructor(options: AuthServiceOptions) {
    super(options);
    this.emailVerificationRequired = options.emailVerificationRequired ?? false;
    this.emailVerification = new EmailVerificationService({
      database: this.database,
      required: options.emailVerificationRequired ?? false,
      hashKey: options.emailVerificationHashKey,
      fixedCode: options.emailVerificationFixedCode,
      bypassDomains: options.emailMxCheckBypassDomains ?? DEFAULT_MX_CHECK_BYPASS_DOMAINS,
      sendEmail: options.onEmailVerification,
    });
    this.database.exec(MIGRATION_39);
  }

  override updateAccount(
    sessionToken: string,
    input: AccountProfileUpdate,
  ): AccountSnapshot | null {
    const current = this.authenticate(sessionToken);
    if (!current) return null;
    const user = this.findUserById(current.userId);
    if (!user) return null;
    this.assertEmailChangeRequiresVerification(user.email, input.email);
    const updated = super.updateAccount(sessionToken, input);
    if (updated && user.candidate_id && this.emailChanged(user.email, updated.email)) {
      this.emailVerification.invalidateAddressChange(user.candidate_id);
    }
    return updated;
  }

  override updateUserByAdmin(
    targetUserId: string,
    input: AdminUserUpdateInput,
    actorPrincipal?: AuthPrincipal,
  ): AdminUserRecord {
    const user = this.findUserById(targetUserId);
    if (user && typeof input.email === 'string') {
      this.assertEmailChangeRequiresVerification(user.email, input.email);
    }
    const updated = super.updateUserByAdmin(targetUserId, input, actorPrincipal);
    if (user?.candidate_id && this.emailChanged(user.email, updated.email)) {
      this.emailVerification.invalidateAddressChange(user.candidate_id);
    }
    return updated;
  }

  private assertEmailChangeRequiresVerification(
    previousEmail: string | null,
    nextEmail: string | null | undefined,
  ): void {
    if (!this.emailVerificationRequired || nextEmail === undefined) return;
    const previous = previousEmail ? canonicalEmailOrThrow(previousEmail) : null;
    const next = nextEmail ? canonicalEmailOrThrow(nextEmail) : null;
    if (previous !== next) throw new AuthEmailChangeRequiresVerificationError();
  }

  private emailChanged(previousEmail: string | null, nextEmail: string | null): boolean {
    const previous = previousEmail ? canonicalEmailOrThrow(previousEmail) : null;
    const next = nextEmail ? canonicalEmailOrThrow(nextEmail) : null;
    return previous !== next;
  }

  override async register(
    usernameInput: string,
    password: string,
    candidateStore: CandidateStore,
    profile: RegistrationProfile = {},
    clientDeviceId?: string,
    onEmailVerificationFailure?: (failure: EmailVerificationDeliveryFailure) => void,
  ): Promise<{ principal: AuthPrincipal; sessionToken: string }> {
    const identity = await this.validateRegistration(usernameInput, profile);
    const now = new Date().toISOString();
    if (identity.email) {
      this.emailVerification.reserveInitialSend(
        this.registrationAccount('pending-registration', identity, now, profile.emailVerified),
        profile.clientIp ?? '127.0.0.1',
        Date.parse(now),
      );
    }
    const delivery = await this.persistRegisteredCandidate(
      identity, password, candidateStore, profile, now,
    );
    if (delivery) {
      await this.emailVerification.sendPrepared(delivery, Date.parse(now), onEmailVerificationFailure);
    }
    const authenticated = clientDeviceId
      ? await this.login(identity.username, password, clientDeviceId)
      : await this.login(identity.username, password);
    if (!authenticated) throw new Error('registered account cannot authenticate');
    return authenticated;
  }

  private async validateRegistration(
    usernameInput: string,
    profile: RegistrationProfile,
  ): Promise<{ username: string; email: string | null; displayName: string | null }> {
    const username = normalizeUsername(usernameInput);
    if (isReservedUsername(username) || this.findUser(username)) throw new AuthUsernameTakenError();
    const email = profile.email ? canonicalEmailOrThrow(profile.email) : null;
    if (email && this.findUserByEmail(email)) throw new AuthEmailTakenError();
    if (email && (await this.checkEmailDomain(email)) === 'unreachable') {
      throw new AuthEmailDomainUnreachableError();
    }
    return { username, email, displayName: profile.displayName?.trim() || null };
  }

  private async persistRegisteredCandidate(
    identity: { username: string; email: string | null; displayName: string | null },
    password: string,
    candidateStore: CandidateStore,
    profile: RegistrationProfile,
    now: string,
  ): Promise<EmailVerificationDelivery | undefined> {
    const salt = randomBytes(16);
    const passwordHash = await derivePassword(password, salt);
    const candidate = candidateStore.createCandidate({ dataClass: 'personal', locale: 'ru-RU' });
    try {
      this.database.exec('BEGIN IMMEDIATE');
      if (this.findUser(identity.username)) throw new AuthUsernameTakenError();
      if (identity.email && this.findUserByEmail(identity.email)) throw new AuthEmailTakenError();
      this.insertRegisteredUser(
        identity.username, identity.email, identity.displayName, salt, passwordHash,
        candidate.id, now, profile.timezone,
      );
      const delivery = identity.email
        ? this.emailVerification.prepareNewAccount(
            this.registrationAccount(candidate.id, identity, now, profile.emailVerified),
            Date.parse(now),
          )
        : undefined;
      this.database.exec('COMMIT');
      return delivery;
    } catch (error) {
      try { this.database.exec('ROLLBACK'); } catch { /* SQLite may already have rolled back. */ }
      candidateStore.deleteCandidate(candidate.id);
      if (this.findUser(identity.username)) throw new AuthUsernameTakenError();
      if (identity.email && this.findUserByEmail(identity.email)) throw new AuthEmailTakenError();
      throw error;
    }
  }

  private registrationAccount(
    candidateId: string,
    identity: { email: string | null; displayName: string | null },
    createdAt: string,
    trustedEmail?: boolean,
  ): EmailVerificationAccount {
    return {
      candidateId,
      email: identity.email,
      displayName: identity.displayName,
      role: 'candidate',
      isTest: false,
      createdAt,
      trustedEmail,
    };
  }

  async verifyEmail(
    sessionToken: string,
    code: string,
  ): Promise<{ principal: AuthPrincipal; sessionToken: string } | null> {
    const principal = this.authenticate(sessionToken);
    if (!principal?.candidate) return null;
    if (principal.emailVerified === false) {
      this.emailVerification.verify(principal.candidate.id, code);
    }
    const verified = this.authenticate(sessionToken);
    return verified ? { principal: verified, sessionToken } : null;
  }

  async resendEmailVerification(
    sessionToken: string,
    clientIp: string,
  ): Promise<{ principal: AuthPrincipal; emailVerificationEmailSent: boolean } | null> {
    const principal = this.authenticate(sessionToken);
    if (!principal?.candidate) return null;
    const row = this.findUserById(principal.userId);
    if (!row) return null;
    const emailVerificationEmailSent = await this.emailVerification.resend(
      this.verificationAccount(row),
      clientIp,
    );
    const refreshed = this.authenticate(sessionToken);
    return refreshed ? { principal: refreshed, emailVerificationEmailSent } : null;
  }

  async changeUnverifiedEmail(
    sessionToken: string,
    emailInput: string,
    currentPassword: string,
    clientIp: string,
  ): Promise<{ principal: AuthPrincipal; emailVerificationEmailSent: boolean } | null> {
    const principal = this.authenticate(sessionToken);
    if (!principal?.candidate) return null;
    if (principal.emailVerified !== false) throw new AuthEmailVerificationNotRequiredError();
    const row = this.findUserById(principal.userId);
    if (!row) return null;
    await this.validateCurrentPassword(row, currentPassword);
    const email = canonicalEmailOrThrow(emailInput);
    await this.assertEmailCanBeUsed(email, row.id);
    return this.persistEmailChange(row, email, clientIp);
  }

  private async validateCurrentPassword(row: UserRow, password: string): Promise<void> {
    const salt = Buffer.from(row.password_salt, 'base64');
    const expected = Buffer.from(row.password_hash, 'base64');
    const actual = await derivePassword(password, salt);
    if (!timingSafeEqual(actual, expected)) throw new AuthInvalidPasswordError();
  }

  private async assertEmailCanBeUsed(email: string, currentUserId: string): Promise<void> {
    const owner = this.findUserByEmail(email);
    if (owner && owner.id !== currentUserId) throw new AuthEmailTakenError();
    if ((await this.checkEmailDomain(email)) === 'unreachable') {
      throw new AuthEmailDomainUnreachableError();
    }
  }

  private async persistEmailChange(
    row: UserRow,
    email: string,
    clientIp: string,
  ): Promise<{ principal: AuthPrincipal; emailVerificationEmailSent: boolean } | null> {
    const account = { ...this.verificationAccount(row), email };
    const now = new Date().toISOString();
    const delivery = this.updateEmailAndPrepareVerification(row, email, account, clientIp, now);
    const emailVerificationEmailSent = delivery
      ? await this.emailVerification.sendPrepared(delivery, Date.parse(now))
      : true;
    const refreshed = this.findUserById(row.id);
    return refreshed
      ? { principal: this.principalForRow(refreshed), emailVerificationEmailSent }
      : null;
  }

  private updateEmailAndPrepareVerification(
    row: UserRow,
    email: string,
    account: EmailVerificationAccount,
    clientIp: string,
    now: string,
  ): EmailVerificationDelivery | undefined {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const owner = this.findUserByEmail(email);
      if (owner && owner.id !== row.id) throw new AuthEmailTakenError();
      const delivery = this.emailVerification.prepareAddressChange(
        account,
        email,
        clientIp,
        Date.parse(now),
      );
      this.database
        .prepare('UPDATE users SET email = ?, updated_at = ? WHERE id = ?')
        .run(email, now, row.id);
      this.database.exec('COMMIT');
      return delivery;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private verificationAccount(row: UserRow): EmailVerificationAccount {
    return {
      candidateId: row.candidate_id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      isTest: row.is_test === 1,
      createdAt: row.user_created_at,
    };
  }

  protected override principalForRow(row: UserRow): AuthPrincipal {
    const account = this.verificationAccount(row);
    const status: EmailVerificationStatus = this.emailVerification.status(account);
    return { ...super.principalForRow(row), ...status };
  }
}
