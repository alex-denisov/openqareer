import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqliteLinkedinPoolRepository } from './sqliteLinkedinPoolRepository';
import type { LinkedinSessionCookie } from './sessionContract';
import { LinkedinPoolCompanyPageExecutor } from './companyPageExecutor';
import { ensureJobSearchSchema, setPoolJobReadingEnabled } from './jobSearchStore';

const actor = { actorUserId: 'admin-user', actorUsername: 'admin.test' };
const encryptionKey = Buffer.alloc(32, 23);
const now = new Date('2026-09-29T12:00:00.000Z');
const peopleSearchPage = readFileSync(
  fileURLToPath(new URL('./fixtures/people-search-company-recruiter.html', import.meta.url)),
  'utf8',
).replace(
  /<\/body>/iu,
  `<p><a href="https://www.linkedin.com/in/riley-example/"><span aria-hidden="true">Riley Example</span></a></p>
   <div><p><span>Senior Talent Acquisition Partner</span></p></div><div><p><span>Utrecht, Netherlands</span></p></div></body>`,
);
const jobsPage = readFileSync(
  fileURLToPath(new URL('./fixtures/jobs-search-page.html', import.meta.url)),
  'utf8',
);
const companyPage = '<main>urn:li:fsd_company:(11348) urn:li:fsd_company:(11348) urn:li:fsd_company:(5)</main>';
const exaNick = {
  url: 'https://es.linkedin.com/in/nick-wadding/en',
  title: 'Nick Wadding',
  text: '# Nick Wadding\nRecruiting for Data roles at Northwind Group\nManchester, England, United Kingdom (GB)\n500 connections',
};
const resources: Array<{ repository: SqliteLinkedinPoolRepository; directory: string }> = [];

afterEach(() => {
  for (const resource of resources.splice(0)) {
    resource.repository.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
});

function createRepository(nowProvider: () => Date = () => now) {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-linkedin-executor-'));
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
        : url.includes('/jobs/search/')
          ? jobsPage
        : url.includes('/search/results/companies/')
          ? '<a href="/company/northwind-group/">Northwind Group</a>'
          : url.includes('/search/results/people/')
            ? peopleSearchPage
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


function seedDemand(repository: SqliteLinkedinPoolRepository, terms: string[]) {
  const db = repository.getDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS vacancy_demand_terms (
    term TEXT PRIMARY KEY, first_seen_ms INTEGER NOT NULL, last_seen_ms INTEGER NOT NULL) STRICT`);
  for (const term of terms) {
    db.prepare('INSERT INTO vacancy_demand_terms VALUES (?, ?, ?)').run(term, now.getTime(), now.getTime());
  }
}

function makeExecutor(repository: SqliteLinkedinPoolRepository, accountId: string, fake: ReturnType<typeof fakeBrowser>) {
  const notifyOwner = vi.fn(async () => ({ status: 'sent' as const, httpStatus: 200, messageId: 1 }));
  const executor = new LinkedinPoolCompanyPageExecutor({
    config: enabledConfig(accountId),
    repository,
    database: repository.getDatabase(),
    browserFactory: async () => fake.browser as never,
    notifyOwner,
    now: () => now,
    random: () => 0.5,
    wait: async () => undefined,
    decide: () => ({ status: 'run' }),
  });
  return { executor, notifyOwner };
}

describe('pool vacancy reader (jobs search)', () => {
  it('reads a UAE job search first, stores cards, and counts it as one page', async () => {
    const repository = createRepository();
    const account = await createReadyAccount(repository, 'pool-one@example.test');
    seedCompany(repository);
    seedDemand(repository, ['qa engineer']);
    const fake = fakeBrowser();
    const { executor } = makeExecutor(repository, account.id, fake);

    await expect(executor.runStep()).resolves.toMatchObject({ status: 'processed', pageCount: 1 });
    expect(fake.navigated).toHaveLength(1);
    const url = new URL(fake.navigated[0]!);
    expect(url.pathname).toBe('/jobs/search/');
    expect(url.searchParams.get('keywords')).toBe('qa engineer');
    expect(url.searchParams.get('f_TPR')).toBe('r604800');
    expect(['Dubai', 'Abu Dhabi', 'Sharjah', 'United Arab Emirates']).toContain(url.searchParams.get('location'));
    const db = repository.getDatabase();
    expect(db.prepare('SELECT job_id FROM linkedin_pool_job_cards ORDER BY job_id').all()).toEqual([
      { job_id: '4012345678' },
      { job_id: '4012345679' },
    ]);
    const audit = JSON.stringify(db.prepare('SELECT detail FROM linkedin_pool_audit').all());
    expect(audit).toContain('page=jobs_search');
    expect(audit).not.toContain('qa engineer');
    expect(audit).not.toContain('synthetic-session-cookie-secret');
  });

  it('alternates with the company warm-up instead of displacing it', async () => {
    const repository = createRepository();
    const account = await createReadyAccount(repository, 'pool-one@example.test');
    seedCompany(repository);
    seedDemand(repository, ['qa engineer']);
    const fake = fakeBrowser();
    const { executor } = makeExecutor(repository, account.id, fake);

    await executor.runStep(); // jobs page
    await executor.runStep(); // company (3 pages)
    expect(fake.navigated.map((u) => (u.includes('/jobs/search/') ? 'jobs' : 'other'))).toEqual([
      'jobs', 'other', 'other', 'other',
    ]);
  });

  it('goes straight to companies when the admin switched job reading off', async () => {
    const repository = createRepository();
    const account = await createReadyAccount(repository, 'pool-one@example.test');
    seedCompany(repository);
    seedDemand(repository, ['qa engineer']);
    ensureJobSearchSchema(repository.getDatabase());
    setPoolJobReadingEnabled(repository.getDatabase(), false, now);
    const fake = fakeBrowser();
    const { executor } = makeExecutor(repository, account.id, fake);

    await executor.runStep();
    expect(fake.navigated.some((u) => u.includes('/jobs/search/'))).toBe(false);
  });

  it('pauses the account on a challenge and never reads cards from that page', async () => {
    const repository = createRepository();
    const account = await createReadyAccount(repository, 'pool-one@example.test');
    seedDemand(repository, ['qa engineer']);
    const fake = fakeBrowser({ challenge: true });
    const { executor, notifyOwner } = makeExecutor(repository, account.id, fake);

    await expect(executor.runStep()).resolves.toMatchObject({ status: 'needs_reauth', notification: 'sent' });
    expect(notifyOwner).toHaveBeenCalledTimes(1);
    expect(fake.page.mouse.wheel).not.toHaveBeenCalled();
    expect(repository.getDatabase().prepare('SELECT count(*) AS n FROM linkedin_pool_job_cards').get()).toEqual({ n: 0 });
    expect(repository.list({ limit: 25, offset: 0 }).accounts.find(({ id }) => id === account.id)).toMatchObject({
      state: 'user_action_required',
      lastFailureCode: 'challenge_required',
    });
  });
});
