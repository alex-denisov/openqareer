import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LinkedinSessionCookie } from './sessionContract';
import { SqliteLinkedinPoolRepository } from './sqliteLinkedinPoolRepository';
import { LinkedinPoolCompanyPageExecutor } from './companyPageExecutor';

const actor = { actorUserId: 'admin-user', actorUsername: 'admin.test' };
const encryptionKey = Buffer.alloc(32, 23);
const now = new Date('2026-09-29T12:00:00.000Z');
const companyPage = '<main>urn:li:fsd_company:(11348) urn:li:fsd_company:(11348) urn:li:fsd_company:(5)</main>';
const resources: Array<{ repository: SqliteLinkedinPoolRepository; directory: string }> = [];

afterEach(() => {
  for (const resource of resources.splice(0)) {
    resource.repository.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
});

function createRepository(nowProvider: () => Date = () => now) {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-linkedin-executor-warmup-'));
  const repository = new SqliteLinkedinPoolRepository({
    databasePath: join(directory, 'pool.db'),
    encryptionKey,
    runtimeRoot: join(directory, 'runtime'),
    now: nowProvider,
  });
  resources.push({ repository, directory });
  return repository;
}

function createCookies(): LinkedinSessionCookie[] {
  return [
    {
      name: 'li_at',
      value: 'synthetic-session-cookie-secret',
      domain: '.linkedin.com',
      path: '/',
      expiresAt: Math.floor((now.getTime() + 24 * 60 * 60_000) / 1_000),
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ];
}

function enabledConfig(accountId: string) {
  return { enabled: true as const, accountId, timezone: 'UTC', mode: 'warmup' as const };
}

async function createReadyAccount(repository: SqliteLinkedinPoolRepository, email: string) {
  const account = repository.create({
    adminLabel: 'Выделенный тестовый аккаунт',
    emailLogin: email,
    providerAccountMarker: 'marker-1',
    idempotencyKey: crypto.randomUUID(),
    ...actor,
  }).account;
  const login = await repository.beginLogin(account.id, actor);
  await repository.completeLogin(account.id, login.lease.handle, {
    state: 'ready',
    accountMarker: 'marker-1',
  });
  repository.storeSessionCookies(account.id, createCookies(), actor);
  return account;
}

function seedCompany(repository: SqliteLinkedinPoolRepository, company = 'Northwind Group') {
  const db = repository.getDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS vacancy_clusters (
    id TEXT PRIMARY KEY, company TEXT NOT NULL, updated_at INTEGER NOT NULL
  ) STRICT`);
  db.prepare('INSERT INTO vacancy_clusters (id, company, updated_at) VALUES (?, ?, ?)').run(
    crypto.randomUUID(),
    company,
    now.getTime(),
  );
}

function fakeBrowser(options?: { challenge?: boolean }) {
  let currentUrl = '';
  let html = '';
  const navigated: string[] = [];
  const page = {
    goto: vi.fn(async (url: string) => {
      currentUrl = options?.challenge
        ? 'https://www.linkedin.com/checkpoint/challenge'
        : url;
      navigated.push(currentUrl);
      html = options?.challenge
        ? '<main>Verify your identity</main>'
        : url.includes('/search/results/companies/')
          ? '<a href="/company/northwind-group/">Northwind Group</a>'
          : companyPage;
      return { status: () => 200 };
    }),
    url: () => currentUrl,
    content: async () => html,
    evaluate: async () => ({ height: 3000, viewport: 800 }),
    mouse: { wheel: vi.fn(async () => undefined) },
    close: vi.fn(async () => undefined),
  };
  const context = {
    newPage: vi.fn(async () => page),
    addCookies: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => undefined),
  };
  return { browser, context, page, navigated };
}

describe('LinkedinPoolCompanyPageExecutor organic warmup (B314)', () => {
  it('notifies owner via Telegram and pauses account with Fail-Closed when organic warmup encounters a challenge', async () => {
    const repository = createRepository();
    const account = await createReadyAccount(repository, 'pool-warmup-challenge@example.test');
    seedCompany(repository);
    const fake = fakeBrowser();
    const notifyOwner = vi.fn(async () => ({ status: 'sent' as const, httpStatus: 200, messageId: 99 }));
    const warmupFeed = vi.fn(async () => ({
      status: 'checkpoint' as const,
      postsViewed: 0,
      postsLiked: 0,
      reason: 'checkpoint_detected',
    }));

    const executor = new LinkedinPoolCompanyPageExecutor({
      config: enabledConfig(account.id),
      repository,
      database: repository.getDatabase(),
      browserFactory: async () => fake.browser as never,
      notifyOwner,
      now: () => now,
      wait: async () => undefined,
      decide: () => ({ status: 'run' }),
      enableOrganicWarmup: true,
      organicNavigatorFactory: () => ({ warmupFeed }),
    });

    await expect(executor.runStep()).resolves.toMatchObject({
      status: 'needs_reauth',
      reason: 'challenge_required',
      notification: 'sent',
    });

    expect(warmupFeed).toHaveBeenCalledTimes(1);
    expect(fake.page.close).toHaveBeenCalled();
    expect(notifyOwner).toHaveBeenCalledTimes(1);
    expect(notifyOwner).toHaveBeenCalledWith(
      `⚠️ LinkedIn Pool: требуется действие человека\n` +
      `Аккаунт: ${account.id}\n` +
      `Причина: LinkedIn запросил проверку (капча / чекпоинт) (challenge_required)\n` +
      `Что сделать: Откройте сессию аккаунта в десктопном приложении и пройдите проверку вручную.`,
    );

    const paused = repository.list({ limit: 25, offset: 0 }).accounts.find(({ id }) => id === account.id);
    expect(paused).toMatchObject({
      state: 'user_action_required',
      lastFailureCode: 'challenge_required',
    });
  });

  it('proceeds to company collection when organic warmup completes successfully', async () => {
    const repository = createRepository();
    const account = await createReadyAccount(repository, 'pool-warmup-ok@example.test');
    seedCompany(repository);
    const fake = fakeBrowser();
    const notifyOwner = vi.fn(async () => ({ status: 'sent' as const, httpStatus: 200, messageId: 100 }));
    const warmupFeed = vi.fn(async () => ({
      status: 'ok' as const,
      postsViewed: 3,
      postsLiked: 1,
    }));

    const executor = new LinkedinPoolCompanyPageExecutor({
      config: enabledConfig(account.id),
      repository,
      database: repository.getDatabase(),
      browserFactory: async () => fake.browser as never,
      notifyOwner,
      now: () => now,
      wait: async () => undefined,
      decide: () => ({ status: 'run' }),
      enableOrganicWarmup: true,
      organicNavigatorFactory: () => ({ warmupFeed }),
    });

    await expect(executor.runStep()).resolves.toMatchObject({
      status: 'processed',
    });

    expect(warmupFeed).toHaveBeenCalledTimes(1);
    expect(notifyOwner).not.toHaveBeenCalled();
  });
});
