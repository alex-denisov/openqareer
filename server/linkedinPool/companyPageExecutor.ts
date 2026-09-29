import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Browser, BrowserContext, Page } from 'playwright';
import {
  parseLinkedinCompanyPeoplePageHtml,
  parseLinkedinCompanySearchPageHtml,
  linkedinPageNeedsReauth,
} from './companyPageParser';
import {
  ensureCompanyRecruitersSchema,
  savePoolCompanyRecruiter,
} from './companyRecruiterDiscovery';
import type {
  SqliteLinkedinPoolRepository,
} from './sqliteLinkedinPoolRepository';
import type { LinkedinSessionCookie } from './sessionContract';
import type { OwnerTelegramOutcome } from '../notifications/ownerTelegram';
import {
  getLinkedinExecutorDailyUsage,
  markLinkedinPoolAccountNeedsReauth,
  recordLinkedinExecutorCompanyAttempt,
  recordLinkedinExecutorPageAttempt,
  type LinkedinPoolExecutorDailyUsage,
} from './executorAuditRepository';
import {
  hasLinkedinExecutorDailyCapacity,
  isLinkedinExecutorWithinHours,
  linkedinExecutorPageDelayMs,
  linkedinLocalDayStart,
  LINKEDIN_EXECUTOR_TARGET_SCAN_LIMIT,
  type LinkedinPoolExecutorConfig,
  type LinkedinPoolExecutorReport,
  type LinkedinPoolExecutorStatus,
} from './companyPageExecutorPolicy';

export {
  hasLinkedinExecutorDailyCapacity,
  isLinkedinExecutorWithinHours,
  linkedinExecutorPageDelayMs,
  linkedinLocalDayStart,
  readLinkedinPoolExecutorConfig,
} from './companyPageExecutorPolicy';
export type {
  LinkedinPoolExecutorConfig,
  LinkedinPoolExecutorReport,
  LinkedinPoolExecutorStatus,
} from './companyPageExecutorPolicy';

export interface LinkedinPoolExecutorDependencies {
  readonly config: LinkedinPoolExecutorConfig;
  readonly repository: SqliteLinkedinPoolRepository;
  readonly database: DatabaseSync;
  readonly browserFactory: () => Promise<Browser>;
  readonly notifyOwner: (text: string) => Promise<OwnerTelegramOutcome>;
  readonly now?: () => Date;
  readonly random?: () => number;
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

interface ReadySession {
  readonly cookies: readonly LinkedinSessionCookie[];
}

interface PageRead {
  readonly status: 'ready' | 'needs_reauth' | 'transient_failure' | 'stopped';
  readonly html?: string;
  readonly reason?: 'challenge_required' | 'expired' | 'login_required';
}

/** B253 limits this owner-approved exception to the dedicated pool and company/recruiter reads. */
export class LinkedinPoolCompanyPageExecutor {
  private readonly config: LinkedinPoolExecutorConfig;
  private readonly repository: SqliteLinkedinPoolRepository;
  private readonly database: DatabaseSync;
  private readonly browserFactory: () => Promise<Browser>;
  private readonly notifyOwner: (text: string) => Promise<OwnerTelegramOutcome>;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  private pauseController?: AbortController;
  private activeBrowser?: Browser;
  private activeContext?: BrowserContext;
  private running = false;
  private stopped = false;
  private reauthRequired = false;

  constructor(dependencies: LinkedinPoolExecutorDependencies) {
    this.config = dependencies.config;
    this.repository = dependencies.repository;
    this.database = dependencies.database;
    this.browserFactory = dependencies.browserFactory;
    this.notifyOwner = dependencies.notifyOwner;
    this.now = dependencies.now ?? (() => new Date());
    this.random = dependencies.random ?? Math.random;
    this.wait = dependencies.wait ?? abortableWait;
    if (this.config.enabled) ensureCompanyRecruitersSchema(this.database);
  }

  async runStep(): Promise<LinkedinPoolExecutorReport> {
    if (!this.config.enabled) return report('disabled');
    if (this.stopped) return report('stopped');
    if (this.reauthRequired) return report('needs_reauth');
    if (this.running) return report('stopped');
    this.running = true;
    try {
      return await this.runEnabledStep();
    } catch {
      return report(this.stopped ? 'stopped' : 'transient_failure');
    } finally {
      this.running = false;
      await this.closeBrowser();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.pauseController?.abort();
    await this.closeBrowser();
  }

  private async runEnabledStep(): Promise<LinkedinPoolExecutorReport> {
    const config = this.config;
    if (!config.enabled) return report('disabled');
    const now = this.now();
    if (!isLinkedinExecutorWithinHours(now, config.timezone)) return report('outside_window');
    const account = this.repository
      .list({ limit: 200, offset: 0 })
      .accounts.find((entry) => entry.id === config.accountId);
    if (!account) return report('account_not_ready');
    if (account.state === 'user_action_required' && account.lastFailureCode === 'needs_reauth') {
      return this.blockForReauth('login_required');
    }
    if (account.state !== 'ready') return report('account_not_ready');
    const session = await this.readReadySession(account.id, account.serverSession?.expiresAt, now);
    if ('report' in session) return session.report;

    const dailyUsage = getLinkedinExecutorDailyUsage(
      this.database,
      account.id,
      linkedinLocalDayStart(now, config.timezone).toISOString(),
    );
    if (!hasLinkedinExecutorDailyCapacity(dailyUsage.pageCount)) return report('daily_limit');
    const companyName = this.nextCompanyName(dailyUsage);
    if (!companyName) return report('no_target');
    if (dailyUsage.pageCount > 0) {
      await this.waitBetweenPages();
      if (this.stopped) return report('stopped');
      if (!isLinkedinExecutorWithinHours(this.now(), config.timezone)) {
        return report('outside_window');
      }
    }
    return this.collectCompany(account.id, companyName, session.cookies);
  }

  private async readReadySession(
    accountId: string,
    expiresAt: string | undefined,
    now: Date,
  ): Promise<ReadySession | { readonly report: LinkedinPoolExecutorReport }> {
    if (!expiresAt || Date.parse(expiresAt) <= now.getTime()) {
      return { report: await this.blockForReauth('expired') };
    }
    const cookies = this.repository.readSessionCookies(accountId);
    if (!cookies?.some((cookie) => cookie.name === 'li_at')) {
      return { report: await this.blockForReauth('expired') };
    }
    return { cookies };
  }

  private nextCompanyName(usage: LinkedinPoolExecutorDailyUsage): string | undefined {
    const attempted = new Set(usage.attemptedCompanyHashes);
    const rows = this.database
      .prepare(
        `SELECT c.company FROM vacancy_clusters c
         WHERE trim(c.company) <> ''
           AND NOT EXISTS (
             SELECT 1 FROM linkedin_pool_company_recruiters r
             WHERE r.company_name = c.company COLLATE NOCASE
           )
         ORDER BY c.updated_at DESC, c.id ASC LIMIT ?`,
      )
      .all(LINKEDIN_EXECUTOR_TARGET_SCAN_LIMIT) as Array<{ company: string }>;
    for (const row of rows) {
      const company = row.company.trim().replace(/\s+/gu, ' ');
      if (!company || company.length > 200 || hasControlCharacters(company)) continue;
      if (!attempted.has(companyHash(company))) return company;
    }
    return undefined;
  }

  private async collectCompany(
    accountId: string,
    companyName: string,
    cookies: readonly LinkedinSessionCookie[],
  ): Promise<LinkedinPoolExecutorReport> {
    const hash = companyHash(companyName);
    recordLinkedinExecutorCompanyAttempt(this.database, accountId, hash, this.now());
    this.activeBrowser = await this.browserFactory();
    this.activeContext = await this.activeBrowser.newContext();
    await this.activeContext.addCookies(playwrightCookies(cookies));
    const page = await this.activeContext.newPage();
    const searchUrl = linkedinCompanySearchUrl(companyName);
    const search = await this.readPage(page, searchUrl, 'company_search', hash);
    if (search.status !== 'ready') return this.handlePageFailure(search, 1);
    const companyUrl = parseLinkedinCompanySearchPageHtml(search.html ?? '', companyName);
    if (!companyUrl) return report('processed', 1, 0);

    await this.waitBetweenPages();
    if (this.stopped) return report('stopped', 1, 0);
    if (
      !this.config.enabled ||
      !isLinkedinExecutorWithinHours(this.now(), this.config.timezone)
    ) {
      return report('outside_window', 1, 0);
    }
    const peopleUrl = `${companyUrl}/people/`;
    const people = await this.readPage(page, peopleUrl, 'company_people', hash);
    if (people.status !== 'ready') return this.handlePageFailure(people, 2);
    const candidates = parseLinkedinCompanyPeoplePageHtml(people.html ?? '');
    for (const candidate of candidates) {
      savePoolCompanyRecruiter(this.repository, {
        companyName,
        ...candidate,
        observedAt: this.now().toISOString(),
      });
    }
    return report('processed', 2, candidates.length);
  }

  private async readPage(
    page: Page,
    url: string,
    pageKind: 'company_search' | 'company_people',
    companyHashValue: string,
  ): Promise<PageRead> {
    if (this.stopped) return { status: 'stopped' };
    const accountId = this.config.enabled ? this.config.accountId : '';
    recordLinkedinExecutorPageAttempt(
      this.database,
      accountId,
      pageKind,
      companyHashValue,
      this.now(),
    );
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      if (this.stopped) return { status: 'stopped' };
      const html = await page.content();
      const statusCode = response?.status();
      const finalUrl = page.url();
      if (linkedinPageNeedsReauth({ statusCode, url: finalUrl, html })) {
        const reason = /\/(?:login|uas\/login)(?:\/|\?|$)/iu.test(finalUrl)
          ? 'login_required'
          : statusCode === 401
            ? 'expired'
            : 'challenge_required';
        return { status: 'needs_reauth', reason };
      }
      return { status: 'ready', html };
    } catch {
      return { status: this.stopped ? 'stopped' : 'transient_failure' };
    }
  }

  private async handlePageFailure(page: PageRead, pages: number): Promise<LinkedinPoolExecutorReport> {
    if (page.status === 'needs_reauth') {
      const notice = await this.blockForReauth(page.reason ?? 'challenge_required');
      return { ...notice, pageCount: pages };
    }
    return report(page.status === 'stopped' ? 'stopped' : 'transient_failure', pages, 0);
  }

  private async blockForReauth(
    reason: 'challenge_required' | 'expired' | 'login_required',
  ): Promise<LinkedinPoolExecutorReport> {
    this.reauthRequired = true;
    const config = this.config;
    if (!config.enabled) return report('needs_reauth');
    const changed = markLinkedinPoolAccountNeedsReauth(
      this.database,
      config.accountId,
      reason,
      this.now(),
    );
    if (!changed) return report('needs_reauth');
    const outcome = await this.notifyOwner(
      'Сбор данных LinkedIn остановлен. Аккаунту выделенного пула требуется повторный вход; исполнитель не переключался на другой аккаунт.',
    );
    return { ...report('needs_reauth'), notification: outcome.status };
  }

  private async waitBetweenPages(): Promise<void> {
    this.pauseController = new AbortController();
    try {
      await this.wait(linkedinExecutorPageDelayMs(this.random), this.pauseController.signal);
    } finally {
      this.pauseController = undefined;
    }
  }

  private async closeBrowser(): Promise<void> {
    const context = this.activeContext;
    const browser = this.activeBrowser;
    this.activeContext = undefined;
    this.activeBrowser = undefined;
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

function report(
  status: LinkedinPoolExecutorStatus,
  pageCount = 0,
  recruiterCount = 0,
): LinkedinPoolExecutorReport {
  return { status, pageCount, recruiterCount };
}

function companyHash(companyName: string): string {
  return createHash('sha256').update(companyName.trim().toLowerCase()).digest('hex');
}

function linkedinCompanySearchUrl(companyName: string): string {
  const url = new URL('https://www.linkedin.com/search/results/companies/');
  url.searchParams.set('keywords', companyName);
  return url.toString();
}

function playwrightCookies(cookies: readonly LinkedinSessionCookie[]) {
  return cookies.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expiresAt ?? -1,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
  }));
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

function abortableWait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
}
