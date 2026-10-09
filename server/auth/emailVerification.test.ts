import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { AuthService, type AuthServiceOptions } from './authService';
import {
  EMAIL_VERIFICATION_CUTOVER_AT,
  emailVerificationCodeHash,
  type EmailVerificationDelivery,
} from './emailVerification';
import { deriveKey } from './derivedHmacKey';
import {
  AuthEmailVerificationExpiredError,
  AuthEmailChangeRequiresVerificationError,
  AuthEmailVerificationInvalidCodeError,
  AuthEmailVerificationLockedError,
  AuthEmailVerificationRateLimitError,
  AuthEmailVerificationResendTooSoonError,
} from './authErrors';
import { EmailVerificationRateLimiter } from './emailVerification';

const resources: Array<{
  auth: AuthService;
  candidates: SqliteCandidateStore;
  databasePath: string;
  directory: string;
}> = [];
const TEST_HASH_KEY = Buffer.alloc(32, 91);

function createVerificationServices(
  options: Partial<Omit<AuthServiceOptions, 'databasePath'>> = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-email-verification-'));
  const databasePath = join(directory, 'auth.db');
  const candidates = new SqliteCandidateStore({
    databasePath,
    encryptionKey: Buffer.alloc(32, 11),
  });
  const auth = new AuthService({
    databasePath,
    emailVerificationRequired: true,
    emailVerificationHashKey: TEST_HASH_KEY,
    emailVerificationFixedCode: '123456',
    emailMxCheckBypassDomains: ['example.com'],
    onEmailVerification: async () => undefined,
    ...options,
  });
  resources.push({ auth, candidates, databasePath, directory });
  return { auth, candidates, databasePath };
}

async function register(
  auth: AuthService,
  candidates: SqliteCandidateStore,
  email = 'candidate@example.com',
  clientIp = '192.0.2.10',
) {
  return auth.register(
    email.split('@')[0] ?? 'candidate',
    'candidate-password-for-tests',
    candidates,
    { email, displayName: 'Кандидат', clientIp },
  );
}

afterEach(() => {
  vi.useRealTimers();
  for (const resource of resources.splice(0)) {
    resource.auth.close();
    resource.candidates.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
});

describe('B398 email verification', () => {
  it('uses the purpose-derived key for verification code hashes', () => {
    const secret = Buffer.alloc(32, 17);
    const message = 'openqareer-email-verification-v1\u0000candidate-b433\u0000123456';
    const expected = createHmac('sha256', deriveKey(secret, 'email-verification-code'))
      .update(message)
      .digest('hex');

    expect(emailVerificationCodeHash('candidate-b433', '123456', secret)).toBe(expected);
    expect(emailVerificationCodeHash('candidate-b433', '123456', secret)).not.toBe(
      createHmac('sha256', secret).update(message).digest('hex'),
    );
  });

  it('limits sends independently by email, IP and account', () => {
    const byIp = new EmailVerificationRateLimiter();
    for (let index = 0; index < 5; index += 1) {
      expect(byIp.checkAndRecord('candidate' + index + '@example.com', '192.0.2.10', index)).toBeNull();
    }
    expect(byIp.checkAndRecord('another@example.com', '192.0.2.10', 6)).toBe(3_600);

    const byEmail = new EmailVerificationRateLimiter();
    for (let index = 0; index < 5; index += 1) {
      expect(byEmail.checkAndRecord('candidate@example.com', '192.0.2.' + index, index)).toBeNull();
    }
    expect(byEmail.checkAndRecord('candidate@example.com', '192.0.2.20', 6)).toBe(3_600);

    const byAccount = new EmailVerificationRateLimiter();
    for (let index = 0; index < 5; index += 1) {
      expect(byAccount.checkAndRecord('candidate' + index + '@example.com', '192.0.2.' + index, index, 'candidate-id')).toBeNull();
    }
    expect(byAccount.checkAndRecord('last@example.com', '192.0.2.20', 6, 'candidate-id')).toBe(3_600);
  });

  it('requires a separate verification before any enabled profile path changes email', async () => {
    const { auth, candidates } = createVerificationServices();
    const registered = await register(auth, candidates);
    await auth.verifyEmail(registered.sessionToken, '123456');

    expect(() => auth.updateAccount(registered.sessionToken, { email: 'changed@example.com' })).toThrow(
      AuthEmailChangeRequiresVerificationError,
    );
    expect(() => auth.updateUserByAdmin(registered.principal.userId, { email: 'changed@example.com' })).toThrow(
      AuthEmailChangeRequiresVerificationError,
    );
    expect(auth.authenticate(registered.sessionToken)).toMatchObject({
      email: 'candidate@example.com',
      emailVerified: true,
    });
  });

  it('stores a keyed hash and opens the session only after the six-digit code is confirmed', async () => {
    const deliveries: EmailVerificationDelivery[] = [];
    const { auth, candidates, databasePath } = createVerificationServices({
      onEmailVerification: async (delivery) => {
        deliveries.push(delivery);
      },
    });
    const registered = await register(auth, candidates);

    expect(registered.principal.emailVerified).toBe(false);
    expect(registered.principal.emailVerificationEmailSent).toBe(true);
    expect(deliveries[0]).toMatchObject({ email: 'candidate@example.com', code: '123456' });
    const database = new DatabaseSync(databasePath);
    const verification = database
      .prepare('SELECT code_hash, expires_at, attempts, verified_at FROM email_verifications')
      .get() as {
      code_hash: string;
      expires_at: string;
      attempts: number;
      verified_at: string | null;
    };
    expect(verification.code_hash).not.toBe('123456');
    expect(verification.attempts).toBe(0);
    expect(verification.verified_at).toBeNull();

    const verified = await auth.verifyEmail(registered.sessionToken, deliveries[0]!.code);

    expect(verified?.principal.emailVerified).toBe(true);
    expect(auth.authenticate(registered.sessionToken)?.emailVerified).toBe(true);
    expect(database.prepare('SELECT verified_at FROM email_verifications').get()).toMatchObject({
      verified_at: expect.any(String),
    });
    database.close();
  });

  it('counts invalid attempts and locks the current code after five guesses', async () => {
    const { auth, candidates } = createVerificationServices();
    const registered = await register(auth, candidates);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(auth.verifyEmail(registered.sessionToken, '000000')).rejects.toBeInstanceOf(
        AuthEmailVerificationInvalidCodeError,
      );
    }
    await expect(auth.verifyEmail(registered.sessionToken, '000000')).rejects.toBeInstanceOf(
      AuthEmailVerificationLockedError,
    );
    await expect(auth.verifyEmail(registered.sessionToken, '123456')).rejects.toBeInstanceOf(
      AuthEmailVerificationLockedError,
    );
  });

  it('expires a code after fifteen minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T16:00:00.000Z'));
    const { auth, candidates } = createVerificationServices();
    const registered = await register(auth, candidates);

    vi.advanceTimersByTime(15 * 60 * 1_000 + 1);

    await expect(auth.verifyEmail(registered.sessionToken, '123456')).rejects.toBeInstanceOf(
      AuthEmailVerificationExpiredError,
    );
  });

  it('limits sends to once per minute and five per hour for an email and IP pair', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T16:00:00.000Z'));
    const deliveries: EmailVerificationDelivery[] = [];
    const { auth, candidates } = createVerificationServices({
      onEmailVerification: async (delivery) => {
        deliveries.push(delivery);
      },
    });
    const registered = await register(auth, candidates);

    await expect(
      auth.changeUnverifiedEmail(
        registered.sessionToken,
        'rotated@example.com',
        'candidate-password-for-tests',
        '192.0.2.10',
      ),
    ).rejects.toBeInstanceOf(AuthEmailVerificationResendTooSoonError);

    await expect(
      auth.resendEmailVerification(registered.sessionToken, '192.0.2.10'),
    ).rejects.toBeInstanceOf(AuthEmailVerificationResendTooSoonError);

    for (let send = 0; send < 4; send += 1) {
      vi.advanceTimersByTime(60 * 1_000);
      await auth.resendEmailVerification(registered.sessionToken, '192.0.2.10');
    }
    vi.advanceTimersByTime(60 * 1_000);
    await expect(
      auth.resendEmailVerification(registered.sessionToken, '192.0.2.10'),
    ).rejects.toBeInstanceOf(AuthEmailVerificationRateLimitError);
    expect(deliveries).toHaveLength(5);
  });

  it('reserves the resend interval before waiting for the email provider', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T16:00:00.000Z'));
    let pauseNextDelivery = false;
    let notifyStarted: () => void = () => undefined;
    let releaseDelivery: () => void = () => undefined;
    const deliveryStarted = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const deliveryGate = new Promise<void>((resolve) => { releaseDelivery = resolve; });
    const { auth, candidates } = createVerificationServices({
      onEmailVerification: async () => {
        if (!pauseNextDelivery) return;
        pauseNextDelivery = false;
        notifyStarted();
        await deliveryGate;
      },
    });
    const registered = await register(auth, candidates);
    vi.advanceTimersByTime(60 * 1_000);
    pauseNextDelivery = true;
    const firstSend = auth.resendEmailVerification(registered.sessionToken, '192.0.2.10');

    await deliveryStarted;
    await expect(
      auth.resendEmailVerification(registered.sessionToken, '192.0.2.10'),
    ).rejects.toBeInstanceOf(AuthEmailVerificationResendTooSoonError);
    releaseDelivery();
    await firstSend;
  });

  it('uses the fixed code only for configured test domains', async () => {
    const deliveries: EmailVerificationDelivery[] = [];
    const { auth, candidates } = createVerificationServices({
      onEmailVerification: async (delivery) => {
        deliveries.push(delivery);
      },
    });

    await register(auth, candidates, 'test@example.com');
    await register(auth, candidates, 'candidate@company.com');

    expect(deliveries[0]?.code).toBe('123456');
    expect(deliveries[1]?.code).toMatch(/^\d{6}$/u);
    expect(deliveries[1]?.code).not.toBe('123456');
  });

  it('treats pre-cutover, test and flag-off accounts as already verified', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(new Date(EMAIL_VERIFICATION_CUTOVER_AT).getTime() - 1));
    const deliveries: EmailVerificationDelivery[] = [];
    const { auth, candidates, databasePath } = createVerificationServices({
      onEmailVerification: async (delivery) => {
        deliveries.push(delivery);
      },
    });

    const oldAccount = await register(auth, candidates, 'old@example.com');
    expect(oldAccount.principal.emailVerified).toBe(true);
    expect(deliveries).toHaveLength(0);

    const testAccount = await auth.seedAccounts(
      [{ username: 'candidate.test', password: 'candidate-password-for-tests', role: 'candidate' }],
      candidates,
    );
    expect(testAccount).toBeUndefined();
    expect((await auth.login('candidate.test', 'candidate-password-for-tests'))?.principal.emailVerified).toBe(true);

    const disabled = createVerificationServices({ emailVerificationRequired: false });
    const unverifiedFeatureOff = await register(disabled.auth, disabled.candidates, 'off@example.com');
    expect(unverifiedFeatureOff.principal.emailVerified).not.toBe(false);
    const disabledDatabase = new DatabaseSync(disabled.databasePath, { readOnly: true });
    const row = disabledDatabase
      .prepare('SELECT COUNT(*) AS count FROM email_verifications')
      .get() as { count: number };
    expect(row.count).toBe(0);
    disabledDatabase.close();
    expect(deliveries).toHaveLength(0);

    vi.setSystemTime(new Date(EMAIL_VERIFICATION_CUTOVER_AT));
    const afterCutover = await register(auth, candidates, 'after-cutover@example.com');
    expect(afterCutover.principal.emailVerified).toBe(false);
    expect(deliveries).toHaveLength(1);
    const pending = new DatabaseSync(databasePath, { readOnly: true });
    expect(
      pending.prepare('SELECT COUNT(*) AS count FROM email_verifications WHERE verified_at IS NULL').get(),
    ).toMatchObject({ count: 1 });
    pending.close();
  });
});
