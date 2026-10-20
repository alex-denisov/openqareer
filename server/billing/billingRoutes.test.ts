import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import type { ServerConfig } from '../config';
import { AuthService } from '../auth/authService';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import type { CoachProvider } from '../providers/coachProvider';
import type { RobokassaGateway } from './robokassaGateway';
import { SqliteBillingRepository } from './sqliteBillingRepository';
import { runDueBillingRenewals } from './renewalRunner';

const resources: Array<{
  app: Awaited<ReturnType<typeof buildApp>>;
  auth: AuthService;
  candidates: SqliteCandidateStore;
  directory: string;
}> = [];

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.app.close();
    resource.auth.close();
    resource.candidates.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
});

const coachProvider: CoachProvider = {
  async createTurn() {
    throw new Error('billing routes must not call a language model');
  },
};

async function createBillingApp() {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-billing-'));
  const databasePath = join(directory, 'billing.db');
  const candidates = new SqliteCandidateStore({
    databasePath,
    encryptionKey: Buffer.alloc(32, 8),
  });
  const auth = new AuthService({ databasePath, candidateStore: candidates });
  await auth.seedAccounts(
    [
      {
        username: 'billing.candidate',
        password: 'candidate-password-for-tests',
        role: 'candidate',
      },
    ],
    candidates,
  );
  const login = await auth.login('billing.candidate', 'candidate-password-for-tests');
  if (!login) throw new Error('billing test candidate could not log in');

  const config: ServerConfig = {
    host: '127.0.0.1',
    port: 3210,
    previewToken: 'preview-token-that-is-at-least-thirty-two-characters',
    dataEncryptionKey: Buffer.alloc(32, 8),
    databasePath,
    model: 'gpt-5.6-sol',
    staticRoot: directory,
    release: 'test',
    logLevel: 'fatal',
    secureCookies: false,
    allowedOrigins: ['http://localhost:3000'],
    seedAccounts: [],
  };
  const gateway: RobokassaGateway = {
    testMode: true,
    createCheckout: vi.fn(async (input) => ({
      invoiceId: input.invoiceId,
      paymentUrl: `https://auth.robokassa.ru/Merchant/Invoice/${input.invoiceId}`,
    })),
    createRecurringCharge: vi.fn(async (input) => ({ invoiceId: input.invoiceId, accepted: true })),
    getRecurringChargeStatus: vi.fn(async () => ({
      state: 'pending' as const,
      amountKopecks: null,
      paymentMethod: null,
    })),
    verifyResultSignature: vi.fn(
      (input) => input.signatureValue === 'valid-signature' && input.testMode,
    ),
  };
  const app = await buildApp({
    config,
    coachProvider,
    candidateStore: candidates,
    authService: auth,
    robokassaGateway: gateway,
    serveStatic: false,
  });
  resources.push({ app, auth, candidates, directory });
  return { app, auth, candidates, gateway, authorization: `Bearer ${login.sessionToken}`, databasePath };
}

describe('Pro trial HTTP contract', () => {
  it('activates once under concurrent requests, grants Pro for exactly 24 hours, and expires without charging', async () => {
    const { app, auth, authorization, databasePath, gateway } = await createBillingApp();
    const headers = { authorization, origin: 'http://localhost:3000' };
    const before = await app.inject({ method: 'GET', url: '/api/v1/candidate/billing/trial', headers });
    expect(before.statusCode).toBe(200);
    expect(before.json().data.status).toBe('eligible');
    const activated = await Promise.all([1, 2].map(() => app.inject({
      method: 'POST', url: '/api/v1/candidate/billing/trial', headers, payload: {},
    })));
    expect(activated.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    const trial = activated.find((response) => response.statusCode === 201)!.json().data;
    expect(Date.parse(trial.expiresAt) - Date.parse(trial.startedAt)).toBe(24 * 60 * 60 * 1000);
    expect((await app.inject({ method: 'GET', url: '/api/v1/candidate/billing', headers })).json().data.currentPlan).toBe('pro');
    expect(gateway.createCheckout).not.toHaveBeenCalled();
    expect(gateway.createRecurringCharge).not.toHaveBeenCalled();
    const db = new DatabaseSync(databasePath);
    try {
      expect(db.prepare('SELECT COUNT(*) AS count FROM billing_pro_trials').get()?.count).toBe(1);
      expect(db.prepare('SELECT COUNT(*) AS count FROM billing_subscriptions').get()?.count).toBe(0);
      const user = db.prepare("SELECT id, candidate_id FROM users WHERE username = 'billing.candidate'").get() as { id: string; candidate_id: string };
      expect(auth.getUser(user.id)?.subscriptionTier).toBe('pro');
      expect(auth.getUser(user.id)?.subscriptionStatus).toBe('trialing');
      const repository = new SqliteBillingRepository({ databasePath });
      try { expect(repository.canCandidateUseLlm(user.candidate_id, new Date().toISOString())).toBe(true); }
      finally { repository.close(); }
      db.prepare("UPDATE billing_pro_trials SET started_at = '2020-01-01T00:00:00.000Z', expires_at = '2020-01-02T00:00:00.000Z'").run();
    } finally { db.close(); }
    expect((await app.inject({ method: 'GET', url: '/api/v1/candidate/billing/trial', headers })).json().data.status).toBe('expired');
    expect((await app.inject({ method: 'GET', url: '/api/v1/candidate/billing', headers })).json().data.currentPlan).toBe('free');
    expect((await app.inject({ method: 'POST', url: '/api/v1/candidate/billing/trial', headers, payload: {} })).statusCode).toBe(409);
  });

  it('keeps a purchased Basic subscription intact when an existing trial expires', async () => {
    const { app, auth, authorization, databasePath } = await createBillingApp();
    const headers = { authorization, origin: 'http://localhost:3000' };
    expect((await app.inject({ method: 'POST', url: '/api/v1/candidate/billing/trial', headers, payload: {} })).statusCode).toBe(201);
    const checkout = await app.inject({ method: 'POST', url: '/api/v1/candidate/billing/checkouts',
      headers: { ...headers, 'idempotency-key': 'trial-to-basic' }, payload: { planId: 'basic', autoRenew: false } });
    expect(checkout.statusCode).toBe(201);
    const params = new URLSearchParams({ OutSum: '3990.00', InvId: String(checkout.json().data.invoiceId), PaymentMethod: 'SBP', SignatureValue: 'valid-signature' });
    expect((await app.inject({ method: 'POST', url: '/api/v1/billing/robokassa/result',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: params.toString() })).statusCode).toBe(200);
    const before = (await app.inject({ method: 'GET', url: '/api/v1/candidate/billing', headers })).json().data;
    expect(before.currentPlan).toBe('basic');
    const db = new DatabaseSync(databasePath);
    try {
      const userId = db.prepare("SELECT id FROM users WHERE username = 'billing.candidate'").get()?.id as string;
      expect(auth.getUser(userId)?.subscriptionStatus).not.toBe('trialing');
      db.prepare("UPDATE billing_pro_trials SET started_at = '2020-01-01T00:00:00.000Z', expires_at = '2020-01-02T00:00:00.000Z'").run();
    } finally { db.close(); }
    const after = (await app.inject({ method: 'GET', url: '/api/v1/candidate/billing', headers })).json().data;
    expect(after).toEqual(before);
    expect((await app.inject({ method: 'POST', url: '/api/v1/candidate/billing/trial', headers, payload: {} })).statusCode).toBe(409);
  });

  it('rejects unauthenticated, cross-origin and forged activation fields', async () => {
    const { app, authorization } = await createBillingApp();
    expect((await app.inject({ method: 'GET', url: '/api/v1/candidate/billing/trial' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/v1/candidate/billing/trial', headers: { cookie: `openqareer_session=${authorization.slice(7)}`, origin: 'https://attacker.invalid' }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/candidate/billing/trial', headers: { authorization, origin: 'http://localhost:3000' }, payload: { userId: 'other', expiresAt: '2099-01-01' } })).statusCode).toBe(400);
  });

  it('refuses a paid candidate and preserves their paid entitlement', async () => {
    const { app, authorization, databasePath } = await createBillingApp();
    const db = new DatabaseSync(databasePath);
    try { db.prepare("UPDATE users SET subscription_tier = 'enterprise', subscription_status = 'active', subscription_expires_at = NULL WHERE username = 'billing.candidate'").run(); }
    finally { db.close(); }
    const headers = { authorization, origin: 'http://localhost:3000' };
    expect((await app.inject({ method: 'GET', url: '/api/v1/candidate/billing/trial', headers })).json().data.status).toBe('unavailable');
    expect((await app.inject({ method: 'POST', url: '/api/v1/candidate/billing/trial', headers, payload: {} })).statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: '/api/v1/candidate/billing', headers })).json().data.currentPlan).toBe('max');
  });
});

describe('candidate billing HTTP contract', () => {
  it('creates an idempotent paid-tier checkout using the server plan amount', async () => {
    const { app, gateway, authorization } = await createBillingApp();
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/billing/checkouts',
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': 'checkout-basic-001',
      },
      payload: { planId: 'basic', autoRenew: true },
    });

    expect(first.statusCode).toBe(201);
    expect(first.headers.location).toBe('/api/v1/candidate/billing/checkouts/1');
    expect(first.json()).toMatchObject({
      data: {
        planId: 'basic',
        amountKopecks: 399_000,
        status: 'pending',
        paymentUrl: 'https://auth.robokassa.ru/Merchant/Invoice/1',
      },
    });
    expect(gateway.createCheckout).toHaveBeenCalledTimes(1);
    expect(gateway.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        amountKopecks: 399_000,
        planId: 'basic',
      }),
    );
    const checkoutStatus = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/billing/checkouts/1',
      headers: { authorization },
    });
    expect(checkoutStatus.statusCode).toBe(200);
    expect(checkoutStatus.json().data).toEqual(first.json().data);

    const retry = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/billing/checkouts',
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': 'checkout-basic-001',
      },
      payload: { planId: 'basic', autoRenew: true },
    });

    expect(retry.statusCode).toBe(200);
    expect(retry.json().data).toEqual(first.json().data);
    expect(gateway.createCheckout).toHaveBeenCalledTimes(1);
  });

  it('allows a past-due candidate to create a recurring checkout for the current plan', async () => {
    const { app, gateway, authorization, databasePath } = await createBillingApp();
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/billing/checkouts',
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': 'checkout-past-due-initial',
      },
      payload: { planId: 'basic', autoRenew: true },
    });
    const callback = new URLSearchParams({
      OutSum: '3990.00',
      InvId: String(first.json().data.invoiceId),
      SignatureValue: 'valid-signature',
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/billing/robokassa/result',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: callback.toString(),
    });
    const database = new DatabaseSync(databasePath);
    const subscription = database
      .prepare('SELECT user_id FROM billing_subscriptions LIMIT 1')
      .get() as { user_id: string };
    database
      .prepare("UPDATE billing_subscriptions SET status = 'past_due' WHERE user_id = ?")
      .run(subscription.user_id);
    database.close();

    const update = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/billing/checkouts',
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': 'checkout-past-due-method-update',
      },
      payload: { planId: 'basic', autoRenew: true },
    });

    expect(update.statusCode).toBe(201);
    expect(update.json().data).toMatchObject({
      planId: 'basic',
      autoRenew: true,
      status: 'pending',
    });
    expect(gateway.createCheckout).toHaveBeenCalledTimes(2);
  });

  it('grants the plan only after a signed ResultURL and treats retries as idempotent', async () => {
    const { app, authorization } = await createBillingApp();
    const checkout = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/billing/checkouts',
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': 'checkout-basic-002',
      },
      payload: { planId: 'basic', autoRenew: true },
    });
    expect(checkout.statusCode).toBe(201);

    const params = new URLSearchParams({
      OutSum: '3990.00',
      InvId: '1',
      PaymentMethod: 'SBP',
      SignatureValue: 'bad-signature',
    });
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/robokassa/result',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: params.toString(),
    });
    expect(invalid.statusCode).toBe(403);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/candidate/billing',
          headers: { authorization },
        })
      ).json().data.currentPlan,
    ).toBe('free');

    params.set('SignatureValue', 'valid-signature');
    const applied = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/robokassa/result',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: params.toString(),
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.body).toBe('OK1');
    const summary = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/billing',
      headers: { authorization },
    });
    expect(summary.json().data).toMatchObject({
      currentPlan: 'basic',
      subscription: { status: 'active', autoRenew: true },
    });

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/robokassa/result',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: params.toString(),
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.body).toBe('OK1');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/candidate/billing',
          headers: { authorization },
        })
      ).json().data.subscription.currentPeriodEndsAt,
    ).toBe(summary.json().data.subscription.currentPeriodEndsAt);
  });

  it('lists only the candidate payment history and cancels renewal without shortening the paid period', async () => {
    const { app, authorization, databasePath } = await createBillingApp();
    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/billing/checkouts',
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': 'checkout-basic-003',
      },
      payload: { planId: 'basic', autoRenew: true },
    });
    const callback = new URLSearchParams({
      OutSum: '3990.000000',
      InvId: '1',
      SignatureValue: 'valid-signature',
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/billing/robokassa/result',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: callback.toString(),
    });

    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/billing',
      headers: { authorization },
    });
    const receipts = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/billing/receipts',
      headers: { authorization },
    });
    expect(receipts.statusCode).toBe(200);
    expect(receipts.json().data).toMatchObject([
      {
        invoiceId: 1,
        planId: 'basic',
        amountKopecks: 399_000,
        paymentMethod: null,
      },
    ]);

    const canceled = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/billing/subscription/cancel-renewal',
      headers: { authorization, origin: 'http://localhost:3000' },
    });
    expect(canceled.statusCode).toBe(200);
    expect(canceled.json().data).toMatchObject({ autoRenew: false, nextChargeAt: null });
    expect(canceled.json().data.currentPeriodEndsAt).toBe(
      before.json().data.subscription.currentPeriodEndsAt,
    );
    expect(canceled.json().data.cancellationEventId).toEqual(expect.any(String));
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/candidate/billing',
          headers: { authorization },
        })
      ).json().data.subscription.autoRenew,
    ).toBe(false);
    const repeated = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/billing/subscription/cancel-renewal',
      headers: { authorization, origin: 'http://localhost:3000' },
    });
    expect(repeated.json().data.cancellationEventId).toBe(canceled.json().data.cancellationEventId);
    const database = new DatabaseSync(databasePath);
    try {
      const eventCount = database
        .prepare(
          `SELECT COUNT(*) AS count FROM billing_events WHERE event_type = 'subscription.auto_renew_disabled'`,
        )
        .get() as { count: number };
      expect(eventCount.count).toBe(1);
    } finally {
      database.close();
    }
  });

  it('starts one due child charge, retains the parent invoice, and waits for ResultURL before extending access', async () => {
    const { app, gateway, authorization, databasePath } = await createBillingApp();
    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/billing/checkouts',
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': 'checkout-basic-004',
      },
      payload: { planId: 'basic', autoRenew: true },
    });
    const firstPayment = new URLSearchParams({
      OutSum: '3990.00',
      InvId: '1',
      PaymentMethod: 'SBP',
      SignatureValue: 'valid-signature',
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/billing/robokassa/result',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: firstPayment.toString(),
    });
    const before = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/candidate/billing',
        headers: { authorization },
      })
    ).json().data;
    const repository = new SqliteBillingRepository({ databasePath });
    try {
      const database = new DatabaseSync(databasePath);
      database
        .prepare('UPDATE users SET email = ?, timezone = ? WHERE username = ?')
        .run('billing.candidate@example.test', 'Europe/Moscow', 'billing.candidate');
      database.close();

      const chargeAt = before.subscription.nextChargeAt;
      const reminderAt = new Date(Date.parse(chargeAt) - 2 * 24 * 60 * 60 * 1_000).toISOString();
      const sendReminder = vi.fn(async () => undefined);
      const reminderRun = await runDueBillingRenewals({
        repository,
        gateway,
        now: reminderAt,
        sendReminder,
      });
      expect(reminderRun).toMatchObject({ scanned: 0, remindersSent: 1, reminderFailures: 0 });
      expect(sendReminder).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'billing.candidate@example.test',
          timezone: 'Europe/Moscow',
          planId: 'basic',
          amountKopecks: 399_000,
        }),
      );
      await runDueBillingRenewals({ repository, gateway, now: reminderAt, sendReminder });
      expect(sendReminder).toHaveBeenCalledTimes(1);

      const firstRun = await runDueBillingRenewals({ repository, gateway, now: chargeAt });
      expect(firstRun).toMatchObject({ scanned: 1, initiated: 1, failed: 0 });
      expect(gateway.createRecurringCharge).toHaveBeenCalledTimes(1);
      expect(gateway.createRecurringCharge).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceId: 2,
          previousInvoiceId: 1,
          amountKopecks: 399_000,
        }),
      );

      const duplicateRun = await runDueBillingRenewals({ repository, gateway, now: chargeAt });
      expect(duplicateRun).toMatchObject({ scanned: 0, initiated: 0, failed: 0 });
      expect(gateway.createRecurringCharge).toHaveBeenCalledTimes(1);
      const after = (
        await app.inject({
          method: 'GET',
          url: '/api/v1/candidate/billing',
          headers: { authorization },
        })
      ).json().data;
      expect(after.subscription.currentPeriodEndsAt).toBe(before.subscription.currentPeriodEndsAt);
      const childPayment = new URLSearchParams({
        OutSum: '3990.00',
        InvId: '2',
        PaymentMethod: 'SBP',
        SignatureValue: 'valid-signature',
      });
      const appliedChild = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/robokassa/result',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: childPayment.toString(),
      });
      expect(appliedChild.statusCode).toBe(200);
      expect(appliedChild.body).toBe('OK2');
      const afterPayment = (
        await app.inject({
          method: 'GET',
          url: '/api/v1/candidate/billing',
          headers: { authorization },
        })
      ).json().data;
      expect(afterPayment.subscription.currentPeriodEndsAt).not.toBe(
        before.subscription.currentPeriodEndsAt,
      );
    } finally {
      repository.close();
    }
  });

  it('keeps an uncertain renewal pending for a later callback and gives only a short access grace', async () => {
    const { app, gateway, authorization, databasePath } = await createBillingApp();
    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/billing/checkouts',
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': 'checkout-timeout-001',
      },
      payload: { planId: 'basic', autoRenew: true },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/billing/robokassa/result',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        OutSum: '3990.00',
        InvId: '1',
        PaymentMethod: 'BankCard',
        SignatureValue: 'valid-signature',
      }).toString(),
    });
    const summary = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/candidate/billing',
        headers: { authorization },
      })
    ).json().data;
    const repository = new SqliteBillingRepository({ databasePath });
    try {
      vi.mocked(gateway.createRecurringCharge).mockRejectedValueOnce(new Error('network timeout'));
      const timeoutRun = await runDueBillingRenewals({
        repository,
        gateway,
        now: summary.subscription.nextChargeAt,
      });
      expect(timeoutRun).toMatchObject({ scanned: 1, initiated: 0, failed: 0, outcomeUnknown: 1 });
      const candidateDatabase = new DatabaseSync(databasePath);
      let candidateId: string;
      try {
        candidateId = (
          candidateDatabase
            .prepare('SELECT candidate_id FROM users WHERE username = ?')
            .get('billing.candidate') as { candidate_id: string }
        ).candidate_id;
      } finally {
        candidateDatabase.close();
      }
      expect(repository.canCandidateUseLlm(candidateId, summary.subscription.nextChargeAt)).toBe(
        true,
      );
      const duplicateRun = await runDueBillingRenewals({
        repository,
        gateway,
        now: summary.subscription.nextChargeAt,
      });
      expect(duplicateRun).toMatchObject({ scanned: 0, outcomeUnknown: 0 });
      expect(gateway.createRecurringCharge).toHaveBeenCalledTimes(1);
      const lateCallback = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/robokassa/result',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({
          OutSum: '3990.00',
          InvId: '2',
          PaymentMethod: 'BankCard',
          SignatureValue: 'valid-signature',
        }).toString(),
      });
      expect(lateCallback.statusCode).toBe(200);
      expect(lateCallback.body).toBe('OK2');
    } finally {
      repository.close();
    }
  });

  it('uses the upgraded invoice as the next recurring parent and the new server price', async () => {
    const { app, gateway, authorization, databasePath } = await createBillingApp();
    const postResult = async (invoiceId: number, amount: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/billing/robokassa/result',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({
          OutSum: amount,
          InvId: String(invoiceId),
          PaymentMethod: 'BankCard',
          SignatureValue: 'valid-signature',
        }).toString(),
      });
    const firstCheckout = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/billing/checkouts',
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': 'checkout-upgrade-001',
      },
      payload: { planId: 'basic', autoRenew: true },
    });
    expect(firstCheckout.statusCode).toBe(201);
    await postResult(1, '3990.00');
    const upgradeCheckout = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/billing/checkouts',
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': 'checkout-upgrade-002',
      },
      payload: { planId: 'pro', autoRenew: true },
    });
    expect(upgradeCheckout.statusCode).toBe(201);
    await postResult(2, '9900.00');
    const upgraded = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/candidate/billing',
        headers: { authorization },
      })
    ).json().data;
    const repository = new SqliteBillingRepository({ databasePath });
    try {
      const run = await runDueBillingRenewals({
        repository,
        gateway,
        now: upgraded.subscription.nextChargeAt,
      });
      expect(run).toMatchObject({ scanned: 1, initiated: 1 });
      expect(gateway.createRecurringCharge).toHaveBeenCalledWith(
        expect.objectContaining({
          previousInvoiceId: 2,
          amountKopecks: 990_000,
        }),
      );
    } finally {
      repository.close();
    }
  });
});
