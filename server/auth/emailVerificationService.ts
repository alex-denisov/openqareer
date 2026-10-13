import { timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  EMAIL_VERIFICATION_CUTOVER_AT,
  EMAIL_VERIFICATION_MAX_ATTEMPTS,
  EMAIL_VERIFICATION_RESEND_MS,
  EMAIL_VERIFICATION_TTL_MS,
  emailVerificationCodeHash,
  emailVerificationDeliveryFailure,
  EmailVerificationRateLimiter,
  isVerificationTestAddress,
  newEmailVerificationCode,
  type EmailVerificationDelivery,
  type EmailVerificationDeliveryFailure,
} from './emailVerification';
import {
  AuthEmailVerificationDeliveryError,
  AuthEmailVerificationExpiredError,
  AuthEmailVerificationInvalidCodeError,
  AuthEmailVerificationLockedError,
  AuthEmailVerificationNotRequiredError,
  AuthEmailVerificationRateLimitError,
  AuthEmailVerificationResendTooSoonError,
  AuthAccountEmailChangeNotPendingError,
} from './authErrors';

export interface EmailVerificationAccount {
  readonly candidateId: string | null;
  readonly createdAt: string;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly isTest: boolean;
  readonly role: 'candidate' | 'admin';
  readonly trustedEmail?: boolean;
}

export interface EmailVerificationStatus {
  readonly emailVerified?: boolean;
  readonly emailVerificationEmailSent?: boolean;
  readonly emailVerificationResendAfterSeconds?: number;
}

export interface EmailVerificationServiceOptions {
  readonly database: DatabaseSync;
  readonly required: boolean;
  readonly hashKey?: Buffer;
  readonly fixedCode?: string;
  readonly bypassDomains: readonly string[];
  readonly sendEmail?: (delivery: EmailVerificationDelivery) => Promise<void>;
}

interface EmailVerificationRow {
  readonly candidate_id: string;
  readonly code_hash: string | null;
  readonly expires_at: string | null;
  readonly attempts: number;
  readonly last_sent_at: string | null;
  readonly verified_at: string | null;
}

interface AccountEmailChangeRow {
  readonly candidate_id: string;
  readonly user_id: string;
  readonly current_email: string | null;
  readonly new_email: string;
  readonly code_hash: string;
  readonly expires_at: string;
  readonly attempts: number;
  readonly last_sent_at: string;
}

export interface PendingAccountEmailChange {
  readonly email: string;
  readonly expiresAt: string;
  readonly resendAfterSeconds: number;
}

export class EmailVerificationService {
  private readonly database: DatabaseSync;
  private readonly required: boolean;
  private readonly hashKey?: Buffer;
  private readonly fixedCode?: string;
  private readonly bypassDomains: readonly string[];
  private readonly sendEmail?: EmailVerificationServiceOptions['sendEmail'];
  private readonly rateLimiter = new EmailVerificationRateLimiter();

  constructor(options: EmailVerificationServiceOptions) {
    this.database = options.database;
    this.required = options.required;
    this.hashKey = options.hashKey;
    this.fixedCode = options.fixedCode;
    this.bypassDomains = options.bypassDomains;
    this.sendEmail = options.sendEmail;
    if (this.required && !this.hashKey) {
      throw new Error('email verification hash key is required');
    }
  }

  requiresVerification(account: EmailVerificationAccount): boolean {
    if (!this.required || !account.candidateId || !account.email) return false;
    if (account.role !== 'candidate' || account.isTest || account.trustedEmail) return false;
    return Date.parse(account.createdAt) >= Date.parse(EMAIL_VERIFICATION_CUTOVER_AT);
  }

  status(account: EmailVerificationAccount, now = Date.now()): EmailVerificationStatus {
    if (!this.required) return {};
    if (!this.requiresVerification(account)) return { emailVerified: true };
    const row = this.read(account.candidateId);
    if (row?.verified_at) return { emailVerified: true };
    const retryAfter = resendWaitSeconds(row?.last_sent_at ?? null, now);
    return {
      emailVerified: false,
      emailVerificationEmailSent: Boolean(row?.last_sent_at),
      ...(retryAfter > 0 ? { emailVerificationResendAfterSeconds: retryAfter } : {}),
    };
  }

  prepareNewAccount(account: EmailVerificationAccount, now = Date.now()): EmailVerificationDelivery | undefined {
    if (!account.candidateId || !account.email) return undefined;
    if (!this.required) return undefined;
    if (!this.requiresVerification(account)) {
      this.markVerified(account.candidateId, new Date(now).toISOString());
      return undefined;
    }
    const code = this.newCode(account.email);
    this.writePending(account.candidateId, code, now);
    return this.delivery(account, code, now);
  }

  reserveInitialSend(account: EmailVerificationAccount, clientIp: string, now = Date.now()): void {
    if (!this.requiresVerification(account) || !account.email) return;
    this.reserve(account.email, clientIp, now, registrationAccountId(account));
  }

  async sendPrepared(
    delivery: EmailVerificationDelivery,
    now = Date.now(),
    onDeliveryFailure?: (failure: EmailVerificationDeliveryFailure) => void,
  ): Promise<boolean> {
    this.markSent(delivery.candidateId, new Date(now).toISOString());
    try {
      await this.send(delivery);
      return true;
    } catch (error) {
      this.clearPending(delivery.candidateId);
      if (this.hashKey && onDeliveryFailure) {
        try {
          onDeliveryFailure(emailVerificationDeliveryFailure(delivery.email, error, this.hashKey));
        } catch {
          // Logging failure must not turn an accepted registration into an API error.
        }
      }
      return false;
    }
  }

  verify(candidateId: string, code: string, now = Date.now()): void {
    const row = this.read(candidateId);
    if (row?.verified_at) return;
    if (!row?.expires_at || Date.parse(row.expires_at) <= now || !row.code_hash) {
      throw new AuthEmailVerificationExpiredError();
    }
    if (row.attempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
      throw new AuthEmailVerificationLockedError();
    }
    if (!this.matches(candidateId, code, row.code_hash)) {
      const attempts = row.attempts + 1;
      this.database
        .prepare('UPDATE email_verifications SET attempts = ? WHERE candidate_id = ? AND verified_at IS NULL')
        .run(attempts, candidateId);
      if (attempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
        throw new AuthEmailVerificationLockedError();
      }
      throw new AuthEmailVerificationInvalidCodeError();
    }
    this.database
      .prepare('UPDATE email_verifications SET verified_at = ? WHERE candidate_id = ? AND verified_at IS NULL')
      .run(new Date(now).toISOString(), candidateId);
  }

  async resend(account: EmailVerificationAccount, clientIp: string, now = Date.now()): Promise<boolean> {
    if (!this.requiresVerification(account) || !account.candidateId || !account.email) return true;
    const previous = this.read(account.candidateId);
    if (previous?.verified_at) return true;
    const retryAfter = resendWaitSeconds(previous?.last_sent_at ?? null, now);
    if (retryAfter > 0) throw new AuthEmailVerificationResendTooSoonError(retryAfter);
    this.reserve(account.email, clientIp, now, account.candidateId);
    const code = this.newCode(account.email);
    this.writePending(account.candidateId, code, now);
    this.markSent(account.candidateId, new Date(now).toISOString());
    try {
      await this.send(this.delivery(account, code, now));
      return true;
    } catch (error) {
      this.restore(account.candidateId, previous);
      throw error;
    }
  }

  prepareAddressChange(
    account: EmailVerificationAccount,
    email: string,
    clientIp: string,
    now = Date.now(),
  ): EmailVerificationDelivery {
    if (!this.requiresVerification(account) || !account.candidateId) {
      throw new AuthEmailVerificationNotRequiredError();
    }
    const previous = this.read(account.candidateId);
    if (previous?.verified_at) throw new AuthEmailVerificationNotRequiredError();
    const retryAfter = resendWaitSeconds(previous?.last_sent_at ?? null, now);
    if (retryAfter > 0) throw new AuthEmailVerificationResendTooSoonError(retryAfter);
    this.reserve(email, clientIp, now, account.candidateId);
    const changedAccount = { ...account, email };
    const code = this.newCode(email);
    this.writePending(account.candidateId, code, now);
    this.markSent(account.candidateId, new Date(now).toISOString());
    return this.delivery(changedAccount, code, now);
  }

  async requestAccountEmailChange(
    account: EmailVerificationAccount,
    userId: string,
    currentEmail: string | null,
    newEmail: string,
    clientIp: string,
    now = Date.now(),
  ): Promise<PendingAccountEmailChange> {
    if (!this.required || !this.hashKey || !account.candidateId) {
      throw new AuthEmailVerificationNotRequiredError();
    }
    const previous = this.readAccountEmailChange(account.candidateId);
    const retryAfter = resendWaitSeconds(previous?.last_sent_at ?? null, now);
    if (retryAfter > 0) throw new AuthEmailVerificationResendTooSoonError(retryAfter);
    this.reserve(newEmail, clientIp, now, account.candidateId);

    const code = this.newCode(newEmail);
    const request: AccountEmailChangeRow = {
      candidate_id: account.candidateId,
      user_id: userId,
      current_email: currentEmail,
      new_email: newEmail,
      code_hash: emailVerificationCodeHash(account.candidateId, code, this.requiredHashKey()),
      expires_at: new Date(now + EMAIL_VERIFICATION_TTL_MS).toISOString(),
      attempts: 0,
      last_sent_at: new Date(now).toISOString(),
    };
    this.writeAccountEmailChange(request);
    try {
      await this.send(this.delivery({ ...account, email: newEmail }, code, now));
    } catch {
      this.restoreAccountEmailChange(account.candidateId, previous);
      throw new AuthEmailVerificationDeliveryError();
    }
    return {
      email: newEmail,
      expiresAt: request.expires_at,
      resendAfterSeconds: resendWaitSeconds(request.last_sent_at, now),
    };
  }

  pendingAccountEmailChange(
    candidateId: string,
    now = Date.now(),
  ): PendingAccountEmailChange | null {
    const request = this.readAccountEmailChange(candidateId);
    if (!request || Date.parse(request.expires_at) <= now) return null;
    return {
      email: request.new_email,
      expiresAt: request.expires_at,
      resendAfterSeconds: resendWaitSeconds(request.last_sent_at, now),
    };
  }

  verifyAccountEmailChange(
    candidateId: string,
    code: string,
    applyEmail: (request: {
      userId: string;
      currentEmail: string | null;
      newEmail: string;
    }) => void,
    now = Date.now(),
  ): string {
    this.database.exec('BEGIN IMMEDIATE');
    let committed = false;
    try {
      const request = this.readAccountEmailChange(candidateId);
      if (!request) throw new AuthAccountEmailChangeNotPendingError();
      if (Date.parse(request.expires_at) <= now) throw new AuthEmailVerificationExpiredError();
      if (request.attempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
        throw new AuthEmailVerificationLockedError();
      }
      if (!this.matches(candidateId, code, request.code_hash)) {
        const attempts = request.attempts + 1;
        this.database
          .prepare('UPDATE account_email_change_requests SET attempts = ? WHERE candidate_id = ?')
          .run(attempts, candidateId);
        this.database.exec('COMMIT');
        committed = true;
        if (attempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
          throw new AuthEmailVerificationLockedError();
        }
        throw new AuthEmailVerificationInvalidCodeError();
      }
      applyEmail({
        userId: request.user_id,
        currentEmail: request.current_email,
        newEmail: request.new_email,
      });
      this.database
        .prepare('DELETE FROM account_email_change_requests WHERE candidate_id = ?')
        .run(candidateId);
      this.database.exec('COMMIT');
      committed = true;
      return request.new_email;
    } catch (error) {
      if (!committed) this.database.exec('ROLLBACK');
      throw error;
    }
  }

  invalidateAddressChange(candidateId: string): void {
    this.clearPending(candidateId);
  }

  private newCode(email: string): string {
    return newEmailVerificationCode(
      this.fixedCode && isVerificationTestAddress(email, this.bypassDomains)
        ? this.fixedCode
        : undefined,
    );
  }

  private async send(delivery: EmailVerificationDelivery): Promise<void> {
    if (!this.sendEmail) {
      throw new AuthEmailVerificationDeliveryError();
    }
    await this.sendEmail(delivery);
  }

  private delivery(
    account: EmailVerificationAccount,
    code: string,
    now: number,
  ): EmailVerificationDelivery {
    if (!account.candidateId || !account.email) {
      throw new Error('email verification requires a candidate and address');
    }
    return {
      candidateId: account.candidateId,
      email: account.email,
      displayName: account.displayName,
      code,
      expiresAt: new Date(now + EMAIL_VERIFICATION_TTL_MS).toISOString(),
    };
  }

  private reserve(email: string, clientIp: string, now: number, accountId?: string): void {
    const retryAfter = this.rateLimiter.checkAndRecord(email, clientIp, now, accountId);
    if (retryAfter !== null) throw new AuthEmailVerificationRateLimitError(retryAfter);
  }

  private writePending(candidateId: string, code: string, now: number): void {
    const codeHash = emailVerificationCodeHash(candidateId, code, this.requiredHashKey());
    this.database
      .prepare(
        `INSERT INTO email_verifications
          (candidate_id, code_hash, expires_at, attempts, last_sent_at, verified_at)
         VALUES (?, ?, ?, 0, NULL, NULL)
         ON CONFLICT(candidate_id) DO UPDATE SET
           code_hash = excluded.code_hash, expires_at = excluded.expires_at,
           attempts = 0, last_sent_at = NULL, verified_at = NULL`,
      )
      .run(candidateId, codeHash, new Date(now + EMAIL_VERIFICATION_TTL_MS).toISOString());
  }

  private markVerified(candidateId: string, verifiedAt: string): void {
    this.database
      .prepare(
        `INSERT INTO email_verifications
          (candidate_id, code_hash, expires_at, attempts, last_sent_at, verified_at)
         VALUES (?, NULL, NULL, 0, NULL, ?)
         ON CONFLICT(candidate_id) DO UPDATE SET
           code_hash = NULL, expires_at = NULL, attempts = 0,
           last_sent_at = NULL, verified_at = excluded.verified_at`,
      )
      .run(candidateId, verifiedAt);
  }

  private markSent(candidateId: string, lastSentAt: string): void {
    this.database
      .prepare('UPDATE email_verifications SET last_sent_at = ? WHERE candidate_id = ?')
      .run(lastSentAt, candidateId);
  }

  private clearPending(candidateId: string): void {
    this.database
      .prepare(
        `UPDATE email_verifications SET code_hash = NULL, expires_at = NULL,
         attempts = 0, last_sent_at = NULL, verified_at = NULL WHERE candidate_id = ?`,
      )
      .run(candidateId);
  }

  private restore(candidateId: string, row: EmailVerificationRow | undefined): void {
    if (!row) {
      this.database.prepare('DELETE FROM email_verifications WHERE candidate_id = ?').run(candidateId);
      return;
    }
    this.database
      .prepare(
        `UPDATE email_verifications SET code_hash = ?, expires_at = ?, attempts = ?,
         last_sent_at = ?, verified_at = ? WHERE candidate_id = ?`,
      )
      .run(row.code_hash, row.expires_at, row.attempts, row.last_sent_at, row.verified_at, candidateId);
  }

  private read(candidateId: string | null): EmailVerificationRow | undefined {
    if (!candidateId) return undefined;
    return this.database
      .prepare('SELECT candidate_id, code_hash, expires_at, attempts, last_sent_at, verified_at FROM email_verifications WHERE candidate_id = ?')
      .get(candidateId) as EmailVerificationRow | undefined;
  }

  private readAccountEmailChange(candidateId: string): AccountEmailChangeRow | undefined {
    return this.database
      .prepare(
        `SELECT candidate_id, user_id, current_email, new_email, code_hash, expires_at,
                attempts, last_sent_at
         FROM account_email_change_requests WHERE candidate_id = ?`,
      )
      .get(candidateId) as AccountEmailChangeRow | undefined;
  }

  private writeAccountEmailChange(request: AccountEmailChangeRow): void {
    this.database
      .prepare(
        `INSERT INTO account_email_change_requests
          (candidate_id, user_id, current_email, new_email, code_hash, expires_at, attempts, last_sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id) DO UPDATE SET
          user_id = excluded.user_id, current_email = excluded.current_email,
          new_email = excluded.new_email, code_hash = excluded.code_hash,
          expires_at = excluded.expires_at, attempts = excluded.attempts,
          last_sent_at = excluded.last_sent_at`,
      )
      .run(
        request.candidate_id,
        request.user_id,
        request.current_email,
        request.new_email,
        request.code_hash,
        request.expires_at,
        request.attempts,
        request.last_sent_at,
      );
  }

  private restoreAccountEmailChange(
    candidateId: string,
    previous: AccountEmailChangeRow | undefined,
  ): void {
    if (previous) {
      this.writeAccountEmailChange(previous);
      return;
    }
    this.database
      .prepare('DELETE FROM account_email_change_requests WHERE candidate_id = ?')
      .run(candidateId);
  }

  private matches(candidateId: string, code: string, storedHash: string): boolean {
    const expected = Buffer.from(emailVerificationCodeHash(candidateId, code, this.requiredHashKey()), 'hex');
    const stored = Buffer.from(storedHash, 'hex');
    return expected.length === stored.length && timingSafeEqual(expected, stored);
  }

  private requiredHashKey(): Buffer {
    if (!this.hashKey) throw new Error('email verification hash key is required');
    return this.hashKey;
  }
}

function resendWaitSeconds(lastSentAt: string | null, now: number): number {
  if (!lastSentAt) return 0;
  return Math.max(0, Math.ceil((Date.parse(lastSentAt) + EMAIL_VERIFICATION_RESEND_MS - now) / 1_000));
}

function registrationAccountId(account: EmailVerificationAccount): string | undefined {
  return account.candidateId && account.candidateId !== 'pending-registration'
    ? account.candidateId
    : undefined;
}
