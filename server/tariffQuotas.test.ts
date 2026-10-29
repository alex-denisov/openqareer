import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import type { ServerConfig } from './config';
import { AuthService } from './auth/authService';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import type { CoachProvider } from './providers/coachProvider';
import { successProvider } from './appTestHarness';
import { calendarMonthPeriod, upgradePlanFor } from './billing/tariffQuotas';

const resources: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  for (const resource of resources.splice(0)) await resource.close();
});

async function createQuotaApp(
  username = 'quota.candidate',
  provider: CoachProvider = successProvider,
) {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-quota-'));
  const databasePath = join(directory, 'quota.db');
  const candidates = new SqliteCandidateStore({ databasePath, encryptionKey: Buffer.alloc(32, 8) });
  const auth = new AuthService({ databasePath, candidateStore: candidates });
  await auth.seedAccounts(
    [{ username, password: 'candidate-password-for-tests', role: 'candidate' }],
    candidates,
  );
  const login = await auth.login(username, 'candidate-password-for-tests');
  if (!login) throw new Error('quota test candidate could not log in');
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
    billingEnforcement: true,
  };
  // Сеянные аккаунты — тестовые (без квот); кандидат приёмки квот — обычный.
  withDatabase(databasePath, (database) => database.exec('UPDATE users SET is_test = 0'));
  const app = await buildApp({
    config,
    coachProvider: provider,
    candidateStore: candidates,
    authService: auth,
    serveStatic: false,
  });
  resources.push({
    close: async () => {
      await app.close();
      auth.close();
      candidates.close();
      rmSync(directory, { recursive: true, force: true });
    },
  });
  const headers = {
    authorization: `Bearer ${login.sessionToken}`,
    origin: 'http://localhost:3000',
  };
  const turn = (key: string = randomUUID(), messageId: string = randomUUID()) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { ...headers, 'idempotency-key': key },
      payload: { messageId, content: 'Что мне делать дальше?' },
    });
  return { app, headers, databasePath, username, turn };
}

function withDatabase<T>(databasePath: string, operation: (database: DatabaseSync) => T): T {
  const database = new DatabaseSync(databasePath);
  try {
    return operation(database);
  } finally {
    database.close();
  }
}

function seedUsedTurns(
  databasePath: string,
  count: number,
  startedAt = calendarMonthPeriod(new Date().toISOString()).startedAt,
) {
  withDatabase(databasePath, (database) => {
    const { candidate_id: candidateId } = database
      .prepare('SELECT candidate_id FROM users')
      .get() as { candidate_id: string };
    const insert = database.prepare(
      `INSERT INTO billing_quota_events (candidate_id, quota_key, period_started_at, unit_key, created_at)
       VALUES (?, 'coach_turns', ?, ?, ?)`,
    );
    for (let index = 0; index < count; index += 1)
      insert.run(candidateId, startedAt, `seed-${index}`, startedAt);
  });
}

function activateBasic(databasePath: string) {
  withDatabase(databasePath, (database) => {
    const { id: userId } = database.prepare('SELECT id FROM users').get() as { id: string };
    const now = new Date().toISOString();
    const ends = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString();
    const invoice = database
      .prepare(
        `INSERT INTO billing_invoices (user_id, plan_id, amount_kopecks, idempotency_key, status,
         auto_renew_opt_in, test_mode, created_at, paid_at, updated_at)
       VALUES (?, 'basic', 399000, ?, 'paid', 0, 1, ?, ?, ?)`,
      )
      .run(userId, randomUUID(), now, now, now);
    database
      .prepare(
        `INSERT INTO billing_subscriptions (user_id, plan_id, status, current_period_started_at,
         current_period_ends_at, next_charge_at, auto_renew, parent_invoice_id, last_invoice_id, created_at, updated_at)
       VALUES (?, 'basic', 'active', ?, ?, NULL, 0, ?, ?, ?, ?)`,
      )
      .run(userId, now, ends, invoice.lastInsertRowid, invoice.lastInsertRowid, now, now);
  });
}

describe('квоты тарифов (B579)', () => {
  it('Free: 30-й ход консультанта проходит, 31-й получает 402 quota_exhausted с тарифом, где квоты больше', async () => {
    const { turn, databasePath } = await createQuotaApp();
    seedUsedTurns(databasePath, 29);

    const thirtieth = await turn();
    expect(thirtieth.statusCode).toBe(200);

    const thirtyFirst = await turn();
    expect(thirtyFirst.statusCode).toBe(402);
    const error = thirtyFirst.json().error;
    expect(error.code).toBe('quota_exhausted');
    expect(error.message).toContain('Ходы консультанта');
    expect(error.message).toContain('Basic');
    expect(error.details).toMatchObject({
      quota: 'coach_turns',
      limit: 30,
      plan: 'free',
      upgradePlan: 'basic',
    });
  });

  it('повтор хода с тем же ключом не списывает квоту второй раз', async () => {
    const { turn, databasePath } = await createQuotaApp();
    seedUsedTurns(databasePath, 29);
    const key = randomUUID();
    const messageId = randomUUID();
    expect((await turn(key, messageId)).statusCode).toBe(200);
    expect((await turn(key, messageId)).statusCode).toBe(200);
  });

  it('проверяет квоту до вызова модели', async () => {
    let calls = 0;
    const counting: CoachProvider = {
      async createTurn(input, key) {
        calls += 1;
        return successProvider.createTurn(input, key);
      },
    };
    const { turn, databasePath } = await createQuotaApp('quota.candidate', counting);
    seedUsedTurns(databasePath, 30);
    expect((await turn()).statusCode).toBe(402);
    expect(calls).toBe(0);
  });

  it('переход на Basic открывает квоту сразу', async () => {
    const { turn, databasePath } = await createQuotaApp();
    seedUsedTurns(databasePath, 30);
    expect((await turn()).statusCode).toBe(402);

    activateBasic(databasePath);
    expect((await turn()).statusCode).toBe(200);
  });

  it('Free-ход идёт с пометкой бесплатной модели, платный — без неё', async () => {
    const tiers: Array<string | undefined> = [];
    const recording: CoachProvider = {
      async createTurn(input, key) {
        tiers.push(input.modelTier);
        return successProvider.createTurn(input, key);
      },
    };
    const { turn, databasePath } = await createQuotaApp('quota.candidate', recording);
    expect((await turn()).statusCode).toBe(200);
    activateBasic(databasePath);
    expect((await turn()).statusCode).toBe(200);
    expect(tiers[0]).toBe('free');
    expect(tiers.at(-1)).toBeUndefined();
  });

  it('тестовый аккаунт работает без квот, adenisov.test — с квотами', async () => {
    const tester = await createQuotaApp('quota.tester');
    withDatabase(tester.databasePath, (database) => database.exec('UPDATE users SET is_test = 1'));
    seedUsedTurns(tester.databasePath, 30);
    expect((await tester.turn()).statusCode).toBe(200);

    const owner = await createQuotaApp('adenisov.test');
    withDatabase(owner.databasePath, (database) => database.exec('UPDATE users SET is_test = 1'));
    seedUsedTurns(owner.databasePath, 30);
    expect((await owner.turn()).statusCode).toBe(402);
  });

  it('Free не открывает тренировку интервью: 402 quota_exhausted с тарифом Basic', async () => {
    const { app, headers } = await createQuotaApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/interview-sessions',
      headers,
      payload: { roleTitle: 'Product manager', mode: 'text' },
    });
    expect(response.statusCode).toBe(402);
    expect(response.json().error).toMatchObject({
      code: 'quota_exhausted',
      details: { quota: 'interview_trainings', upgradePlan: 'basic' },
    });
  });

  it('отдаёт остаток квот за период на экран «Тарифы»', async () => {
    const { app, headers, turn } = await createQuotaApp();
    expect((await turn()).statusCode).toBe(200);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/billing/quotas',
      headers,
    });
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.plan).toBe('free');
    expect(data.quotas).toContainEqual(
      expect.objectContaining({ key: 'coach_turns', limit: 30, used: 1, remaining: 29 }),
    );
    expect(data.quotas).toContainEqual(expect.objectContaining({ key: 'applications', limit: 20 }));
    expect(data.fitPercentLimit).toBe(300);
  });

  it('называет ближайший тариф, где квоты больше', () => {
    expect(upgradePlanFor('free', 'interview_trainings')).toBe('basic');
    expect(upgradePlanFor('basic', 'linkedin_drafts')).toBe('pro');
    expect(upgradePlanFor('max', 'coach_turns')).toBeNull();
  });
});
