import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqliteLinkedinPoolRepository } from './sqliteLinkedinPoolRepository';
import type { LinkedinSessionCookie } from './sessionContract';
import { recordLinkedinExecutorPageAttempt } from './executorAuditRepository';
import {
  detectCadencePageKind,
  hasLinkedinExecutorDailyCapacity,
  isLinkedinExecutorWithinHours,
  linkedinExecutorPageDelayMs,
  linkedinLocalDayStart,
  LinkedinPoolCompanyPageExecutor,
  readLinkedinPoolExecutorConfig,
} from './companyPageExecutor';
import { planDay } from './linkedinCadencePolicy';

const actor = { actorUserId: 'admin-user', actorUsername: 'admin.test' };
const encryptionKey = Buffer.alloc(32, 23);
const now = new Date('2026-09-29T12:00:00.000Z');
const peoplePage = readFileSync(
  fileURLToPath(new URL('./fixtures/company-people-page.html', import.meta.url)),
  'utf8',
);
const resources: Array<{ repository: SqliteLinkedinPoolRepository; directory: string }> = [];

afterEach(() => {
  for (const resource of resources.splice(0)) {
    resource.repository.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
});

function createRepository() {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-linkedin-executor-'));
  const repository = new SqliteLinkedinPoolRepository({
    databasePath: join(directory, 'pool.db'),
    encryptionKey,
    runtimeRoot: join(directory, 'runtime'),
    now: () => now,
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
          : peoplePage;
      return { status: () => 200 };
    }),
    url: () => currentUrl,
    content: async () => html,
    evaluate: async () => ({ height: 3000, viewport: 800 }),
    mouse: { wheel: vi.fn(async () => undefined) },
    close: vi.fn(async () => undefined),
  };
  const context = {
    addCookies: vi.fn(async () => undefined),
    newPage: async () => page,
    close: vi.fn(async () => undefined),
  };
  const browser = {
    newContext: async () => context,
    close: vi.fn(async () => undefined),
  };
  return { browser, context, page, navigated };
}

function enabledConfig(accountId: string) {
  return { enabled: true as const, accountId, timezone: 'UTC', mode: 'warmup' as const };
}

describe('LinkedIn pool executor controls', () => {
  it('defaults off and requires an explicit account, timezone and owner alert path to enable', () => {
    expect(readLinkedinPoolExecutorConfig({})).toEqual({ enabled: false });
    expect(() => readLinkedinPoolExecutorConfig({ OPENQAREER_LINKEDIN_POOL_EXECUTOR_ENABLED: 'yes' })).toThrow(
      'linkedin_pool_executor_flag_invalid',
    );
    expect(() =>
      readLinkedinPoolExecutorConfig({ OPENQAREER_LINKEDIN_POOL_EXECUTOR_ENABLED: 'true' }),
    ).toThrow('linkedin_pool_executor_account_id_required');
    expect(() =>
      readLinkedinPoolExecutorConfig({
        OPENQAREER_LINKEDIN_POOL_EXECUTOR_ENABLED: 'true',
        OPENQAREER_LINKEDIN_POOL_EXECUTOR_ACCOUNT_ID: '11111111-1111-4111-8111-111111111111',
        OPENQAREER_LINKEDIN_POOL_EXECUTOR_TIMEZONE: 'Mars/Olympus',
        OPENQAREER_TELEGRAM_BOT_TOKEN: 'token',
        OPENQAREER_TELEGRAM_OWNER_CHAT_ID: '1',
      }),
    ).toThrow('linkedin_pool_executor_timezone_invalid');
    expect(() =>
      readLinkedinPoolExecutorConfig({
        OPENQAREER_LINKEDIN_POOL_EXECUTOR_ENABLED: 'true',
        OPENQAREER_LINKEDIN_POOL_EXECUTOR_ACCOUNT_ID: '11111111-1111-4111-8111-111111111111',
        OPENQAREER_LINKEDIN_POOL_EXECUTOR_TIMEZONE: 'Europe/Moscow',
      }),
    ).toThrow('linkedin_pool_executor_owner_telegram_required');
    expect(() =>
      readLinkedinPoolExecutorConfig({
        OPENQAREER_LINKEDIN_POOL_EXECUTOR_ENABLED: 'true',
        OPENQAREER_LINKEDIN_POOL_EXECUTOR_ACCOUNT_ID: '11111111-1111-4111-8111-111111111111',
        OPENQAREER_LINKEDIN_POOL_EXECUTOR_TIMEZONE: 'Europe/Moscow',
        OPENQAREER_TELEGRAM_BOT_TOKEN: 'token',
        OPENQAREER_TELEGRAM_OWNER_CHAT_ID: '1',
        OPENQAREER_LINKEDIN_POOL_EXECUTOR_MODE: 'invalid_mode',
      }),
    ).toThrow('linkedin_pool_executor_mode_invalid');
    const highVolumeEnvironment = {
      OPENQAREER_LINKEDIN_POOL_EXECUTOR_ENABLED: 'true',
      OPENQAREER_LINKEDIN_POOL_EXECUTOR_ACCOUNT_ID: '11111111-1111-4111-8111-111111111111',
      OPENQAREER_LINKEDIN_POOL_EXECUTOR_TIMEZONE: 'Europe/Moscow',
      OPENQAREER_TELEGRAM_BOT_TOKEN: 'token',
      OPENQAREER_TELEGRAM_OWNER_CHAT_ID: '1',
      OPENQAREER_LINKEDIN_POOL_EXECUTOR_MODE: 'scout_pool',
    };
    expect(() => readLinkedinPoolExecutorConfig(highVolumeEnvironment)).toThrow(
      'linkedin_pool_executor_high_volume_not_allowed',
    );
    expect(
      readLinkedinPoolExecutorConfig({
        ...highVolumeEnvironment,
        OPENQAREER_LINKEDIN_POOL_EXECUTOR_ALLOW_HIGH_VOLUME: 'true',
      }),
    ).toMatchObject({ enabled: true, mode: 'scout_pool' });
    expect(
      readLinkedinPoolExecutorConfig({
        OPENQAREER_LINKEDIN_POOL_EXECUTOR_ENABLED: 'true',
        OPENQAREER_LINKEDIN_POOL_EXECUTOR_ACCOUNT_ID: '11111111-1111-4111-8111-111111111111',
        OPENQAREER_LINKEDIN_POOL_EXECUTOR_TIMEZONE: 'Europe/Moscow',
        OPENQAREER_TELEGRAM_BOT_TOKEN: 'token',
        OPENQAREER_TELEGRAM_OWNER_CHAT_ID: '1',
      }),
    ).toEqual({
      enabled: true,
      accountId: '11111111-1111-4111-8111-111111111111',
      timezone: 'Europe/Moscow',
      mode: 'warmup',
    });
    expect(
      readLinkedinPoolExecutorConfig({
        OPENQAREER_LINKEDIN_POOL_EXECUTOR_ENABLED: 'true',
        OPENQAREER_LINKEDIN_POOL_EXECUTOR_ACCOUNT_ID: '11111111-1111-4111-8111-111111111111',
        OPENQAREER_LINKEDIN_POOL_EXECUTOR_TIMEZONE: 'Europe/Moscow',
        OPENQAREER_TELEGRAM_BOT_TOKEN: 'token',
        OPENQAREER_TELEGRAM_OWNER_CHAT_ID: '1',
        OPENQAREER_LINKEDIN_POOL_EXECUTOR_MODE: 'active_search',
        OPENQAREER_LINKEDIN_POOL_EXECUTOR_ALLOW_HIGH_VOLUME: 'true',
      }),
    ).toEqual({
      enabled: true,
      accountId: '11111111-1111-4111-8111-111111111111',
      timezone: 'Europe/Moscow',
      mode: 'active_search',
    });
    expect(
      readLinkedinPoolExecutorConfig({
        OPENQAREER_LINKEDIN_POOL_EXECUTOR_ENABLED: 'true',
        OPENQAREER_LINKEDIN_POOL_EXECUTOR_ACCOUNT_ID: '11111111-1111-4111-8111-111111111111',
        OPENQAREER_LINKEDIN_POOL_EXECUTOR_TIMEZONE: 'Europe/Moscow',
        OPENQAREER_TELEGRAM_BOT_TOKEN: 'token',
        OPENQAREER_TELEGRAM_OWNER_CHAT_ID: '1',
        OPENQAREER_LINKEDIN_POOL_EXECUTOR_MODE: 'scout_pool',
        OPENQAREER_LINKEDIN_POOL_EXECUTOR_ALLOW_HIGH_VOLUME: 'true',
      }),
    ).toEqual({
      enabled: true,
      accountId: '11111111-1111-4111-8111-111111111111',
      timezone: 'Europe/Moscow',
      mode: 'scout_pool',
    });
  });

  it('uses the account timezone window and midnight for page budgets', () => {
    expect(isLinkedinExecutorWithinHours(new Date('2026-09-29T05:59:00.000Z'), 'Europe/Moscow')).toBe(
      false,
    );
    expect(isLinkedinExecutorWithinHours(new Date('2026-09-29T06:00:00.000Z'), 'Europe/Moscow')).toBe(
      true,
    );
    expect(isLinkedinExecutorWithinHours(new Date('2026-09-29T18:00:00.000Z'), 'Europe/Moscow')).toBe(
      false,
    );
    expect(linkedinLocalDayStart(new Date('2026-09-29T10:00:00.000Z'), 'Europe/Moscow').toISOString()).toBe(
      '2026-09-28T21:00:00.000Z',
    );

    // B328: midnight boundary traversal and working hours in America/New_York (EDT, UTC-4)
    expect(isLinkedinExecutorWithinHours(new Date('2026-09-29T12:59:00.000Z'), 'America/New_York')).toBe(
      false,
    );
    expect(isLinkedinExecutorWithinHours(new Date('2026-09-29T13:00:00.000Z'), 'America/New_York')).toBe(
      true,
    );
    // Midnight boundary: 23:59 on Sep 28 vs 00:01 on Sep 29
    expect(
      linkedinLocalDayStart(new Date('2026-09-29T03:59:00.000Z'), 'America/New_York').toISOString(),
    ).toBe('2026-09-28T04:00:00.000Z');
    expect(
      linkedinLocalDayStart(new Date('2026-09-29T04:01:00.000Z'), 'America/New_York').toISOString(),
    ).toBe('2026-09-29T04:00:00.000Z');
  });

  it('keeps every page gap and daily page budget within the B309 limits', () => {
    expect(linkedinExecutorPageDelayMs(() => 0)).toBe(20_000);
    expect(linkedinExecutorPageDelayMs(() => 1)).toBe(60_000);
    expect(hasLinkedinExecutorDailyCapacity(38)).toBe(true);
    expect(hasLinkedinExecutorDailyCapacity(39)).toBe(false);
    expect(hasLinkedinExecutorDailyCapacity(40)).toBe(false);
  });
});

describe('LinkedinPoolCompanyPageExecutor', () => {
  it('does not start a browser while the feature flag is off', async () => {
    const repository = createRepository();
    const browserFactory = vi.fn();
    const executor = new LinkedinPoolCompanyPageExecutor({
      config: { enabled: false },
      repository,
      database: repository.getDatabase(),
      browserFactory,
      notifyOwner: async () => ({ status: 'disabled' }),
      now: () => now,
    });

    await expect(executor.runStep()).resolves.toMatchObject({ status: 'disabled' });
    expect(browserFactory).not.toHaveBeenCalled();
  });

  it('reads one company, waits a page-kind dwell (read 9–18 s before the people list), then stores only recruiter fields', async () => {
    const repository = createRepository();
    const account = await createReadyAccount(repository, 'pool-one@example.test');
    seedCompany(repository);
    const fake = fakeBrowser();
    const wait = vi.fn(async () => undefined);
    const executor = new LinkedinPoolCompanyPageExecutor({
      config: enabledConfig(account.id),
      repository,
      database: repository.getDatabase(),
      browserFactory: async () => fake.browser as never,
      notifyOwner: async () => ({ status: 'sent', httpStatus: 200, messageId: 1 }),
      now: () => now,
      random: () => 0.5,
      wait,
      decide: () => ({ status: 'run' }),
    });

    await expect(executor.runStep()).resolves.toMatchObject({
      status: 'processed',
      pageCount: 2,
      recruiterCount: 1,
    });
    expect(fake.navigated).toHaveLength(2);
    expect(fake.navigated[0]).toContain('/search/results/companies/');
    expect(fake.navigated[1]).toBe('https://www.linkedin.com/company/northwind-group/people/');
    expect(wait).toHaveBeenCalledWith(13_500, expect.any(AbortSignal));
    const rows = repository
      .getDatabase()
      .prepare('SELECT company_name, full_name, role_title, linkedin_url FROM linkedin_pool_company_recruiters')
      .all();
    expect(rows).toEqual([
      {
        company_name: 'Northwind Group',
        full_name: 'Riley Example',
        role_title: 'Senior Talent Acquisition Partner',
        linkedin_url: 'https://www.linkedin.com/in/riley-example',
      },
    ]);
    const audit = repository
      .getDatabase()
      .prepare('SELECT detail FROM linkedin_pool_audit WHERE account_id = ?')
      .all(account.id) as Array<{ detail: string | null }>;
    expect(JSON.stringify(audit)).not.toContain('synthetic-session-cookie-secret');
    expect(JSON.stringify(audit)).not.toContain('Northwind Group');
  });

  it('stops on a challenge, marks the selected account needs_reauth and notifies without rotating', async () => {
    const repository = createRepository();
    const account = await createReadyAccount(repository, 'pool-one@example.test');
    await createReadyAccount(repository, 'pool-two@example.test');
    seedCompany(repository);
    const fake = fakeBrowser({ challenge: true });
    const notifyOwner = vi.fn(async () => ({ status: 'sent' as const, httpStatus: 200, messageId: 2 }));
    const executor = new LinkedinPoolCompanyPageExecutor({
      config: enabledConfig(account.id),
      repository,
      database: repository.getDatabase(),
      browserFactory: async () => fake.browser as never,
      notifyOwner,
      now: () => now,
      wait: async () => undefined,
      decide: () => ({ status: 'run' }),
    });

    await expect(executor.runStep()).resolves.toMatchObject({
      status: 'needs_reauth',
      pageCount: 1,
      notification: 'sent',
    });
    expect(fake.navigated).toHaveLength(1);
    expect(fake.page.mouse.wheel).not.toHaveBeenCalled();
    expect(fake.page.close).toHaveBeenCalledOnce();
    expect(notifyOwner).toHaveBeenCalledTimes(1);
    expect(repository.list({ limit: 25, offset: 0 }).accounts.find(({ id }) => id === account.id)).toMatchObject({
      state: 'user_action_required',
      lastFailureCode: 'needs_reauth',
      serverSession: null,
    });
    expect(repository.list({ limit: 25, offset: 0 }).accounts.find(({ emailLogin }) => emailLogin === 'pool-two@example.test')).toMatchObject({
      state: 'ready',
    });
  });

  it('reserves two pages and does not read or switch accounts at the daily limit or outside the window', async () => {
    const repository = createRepository();
    const account = await createReadyAccount(repository, 'pool-one@example.test');
    seedCompany(repository);
    for (let page = 0; page < 39; page += 1) {
      recordLinkedinExecutorPageAttempt(
        repository.getDatabase(),
        account.id,
        'company_search',
        'b'.repeat(64),
        now,
      );
    }
    const browserFactory = vi.fn();
    const atLimit = new LinkedinPoolCompanyPageExecutor({
      config: enabledConfig(account.id),
      repository,
      database: repository.getDatabase(),
      browserFactory,
      notifyOwner: async () => ({ status: 'disabled' }),
      now: () => now,
      decide: (_plan, _now, pages) => ({ status: pages >= 39 ? 'daily_limit' : 'run' }),
    });
    await expect(atLimit.runStep()).resolves.toMatchObject({ status: 'daily_limit' });

    const outsideHours = new LinkedinPoolCompanyPageExecutor({
      config: enabledConfig(account.id),
      repository,
      database: repository.getDatabase(),
      browserFactory,
      notifyOwner: async () => ({ status: 'disabled' }),
      now: () => new Date('2026-09-29T22:00:00.000Z'),
      decide: () => ({ status: 'outside_window' }),
    });
    await expect(outsideHours.runStep()).resolves.toMatchObject({ status: 'outside_window' });
    expect(browserFactory).not.toHaveBeenCalled();
  });
});

describe('LinkedinPoolCompanyPageExecutor Cadence and Backoff (B316)', () => {
  it('stops without starting browser on window_skipped, rest_day, daily_limit, and outside_window', async () => {
    const repository = createRepository();
    const account = await createReadyAccount(repository, 'pool-cadence@example.test');
    seedCompany(repository);
    const browserFactory = vi.fn();

    const skipped = new LinkedinPoolCompanyPageExecutor({
      config: enabledConfig(account.id),
      repository,
      database: repository.getDatabase(),
      browserFactory,
      notifyOwner: async () => ({ status: 'disabled' }),
      decide: () => ({ status: 'window_skipped' }),
    });
    await expect(skipped.runStep()).resolves.toMatchObject({ status: 'window_skipped' });
    expect(browserFactory).not.toHaveBeenCalled();

    const restDay = new LinkedinPoolCompanyPageExecutor({
      config: enabledConfig(account.id),
      repository,
      database: repository.getDatabase(),
      browserFactory,
      notifyOwner: async () => ({ status: 'disabled' }),
      decide: () => ({ status: 'rest_day' }),
    });
    await expect(restDay.runStep()).resolves.toMatchObject({ status: 'rest_day' });
    expect(browserFactory).not.toHaveBeenCalled();

    const dailyLimit = new LinkedinPoolCompanyPageExecutor({
      config: enabledConfig(account.id),
      repository,
      database: repository.getDatabase(),
      browserFactory,
      notifyOwner: async () => ({ status: 'disabled' }),
      decide: () => ({ status: 'daily_limit' }),
    });
    await expect(dailyLimit.runStep()).resolves.toMatchObject({ status: 'daily_limit' });
    expect(browserFactory).not.toHaveBeenCalled();

    const outside = new LinkedinPoolCompanyPageExecutor({
      config: enabledConfig(account.id),
      repository,
      database: repository.getDatabase(),
      browserFactory,
      notifyOwner: async () => ({ status: 'disabled' }),
      decide: () => ({ status: 'outside_window' }),
    });
    await expect(outside.runStep()).resolves.toMatchObject({ status: 'outside_window' });
    expect(browserFactory).not.toHaveBeenCalled();
  });

  it('implements exponential backoff with jitter on transient failures and resets on success', async () => {
    const repository = createRepository();
    const account = await createReadyAccount(repository, 'pool-backoff@example.test');
    for (let c = 1; c <= 5; c++) {
      seedCompany(repository, `Company ${c}`);
    }
    let currentTime = new Date('2026-09-29T13:30:00.000Z');
    let failBrowser = true;
    const browserFactory = vi.fn(async () => {
      if (failBrowser) throw new Error('network down');
      const fake = fakeBrowser();
      return fake.browser as never;
    });

    const executor = new LinkedinPoolCompanyPageExecutor({
      config: enabledConfig(account.id),
      repository,
      database: repository.getDatabase(),
      browserFactory,
      notifyOwner: async () => ({ status: 'disabled' }),
      now: () => currentTime,
      random: () => 0.5,
      decide: () => ({ status: 'run' }),
      wait: async () => undefined,
    });

    const res1 = await executor.runStep();
    expect(res1.status).toBe('transient_failure');
    expect(browserFactory).toHaveBeenCalledTimes(1);

    currentTime = new Date(currentTime.getTime() + 30_000);
    const res2 = await executor.runStep();
    expect(res2.status).toBe('transient_failure');
    expect(browserFactory).toHaveBeenCalledTimes(1);

    currentTime = new Date(currentTime.getTime() + 31_000);
    const res3 = await executor.runStep();
    expect(res3.status).toBe('transient_failure');
    expect(browserFactory).toHaveBeenCalledTimes(2);

    currentTime = new Date(currentTime.getTime() + 60_000);
    const res4 = await executor.runStep();
    expect(res4.status).toBe('transient_failure');
    expect(browserFactory).toHaveBeenCalledTimes(2);

    currentTime = new Date(currentTime.getTime() + 65_000);
    failBrowser = false;
    const res5 = await executor.runStep();
    expect(res5.status).toBe('processed');
    expect(browserFactory).toHaveBeenCalledTimes(3);

    currentTime = new Date(currentTime.getTime() + 5_000);
    failBrowser = true;
    const res6 = await executor.runStep();
    expect(res6.status).toBe('transient_failure');
    expect(browserFactory).toHaveBeenCalledTimes(4);
  });

  it('detects cadence page kind and applies corresponding dwell delays', () => {
    expect(detectCadencePageKind('https://www.linkedin.com/search/results/companies/?keywords=Northwind')).toBe('skim');
    expect(detectCadencePageKind('https://www.linkedin.com/company/northwind/people/')).toBe('read');
    expect(detectCadencePageKind('https://www.linkedin.com/in/riley-example/')).toBe('deep');
    expect(detectCadencePageKind('https://www.linkedin.com/pulse/leadership-trends/')).toBe('deep');
    expect(detectCadencePageKind('https://www.linkedin.com/posts/activity-123')).toBe('deep');
  });

  it('caches the day plan per account and date in memory', async () => {
    const repository = createRepository();
    const account = await createReadyAccount(repository, 'pool-cache@example.test');
    seedCompany(repository);
    const planSpy = vi.fn(planDay);

    const executor = new LinkedinPoolCompanyPageExecutor({
      config: enabledConfig(account.id),
      repository,
      database: repository.getDatabase(),
      browserFactory: async () => fakeBrowser().browser as never,
      notifyOwner: async () => ({ status: 'disabled' }),
      now: () => now,
      planDay: planSpy,
      decide: () => ({ status: 'window_skipped' }),
    });

    await executor.runStep();
    await executor.runStep();
    await executor.runStep();

    expect(planSpy).toHaveBeenCalledTimes(1);
  });
});
