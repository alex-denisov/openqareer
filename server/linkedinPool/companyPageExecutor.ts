import { readLinkedinPage } from './linkedinPageReader';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Browser, BrowserContext, Page } from 'playwright';
import {
  parseLinkedinCompanyPeoplePageHtml,
  parseLinkedinCompanySearchPageHtml,
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
  linkedinLocalDayStart,
  LINKEDIN_EXECUTOR_TARGET_SCAN_LIMIT,
  type LinkedinPoolExecutorConfig,
  type LinkedinPoolExecutorReport,
  type LinkedinPoolExecutorStatus,
} from './companyPageExecutorPolicy';
import {
  decide,
  pageDelayMs,
  planDay,
  type CadenceMode,
  type CadencePageKind,
  type DayPlan,
} from './linkedinCadencePolicy';

export {
  hasLinkedinExecutorDailyCapacity,
  isLinkedinExecutorWithinHours,
  linkedinExecutorPageDelayMs,
  linkedinLocalDayStart,
  readLinkedinPoolExecutorConfig,
} from './companyPageExecutorPolicy';
export type {
  LinkedinPoolExecutorConfig,
  LinkedinPoolExecutorMode,
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
  readonly planDay?: typeof planDay;
  readonly decide?: typeof decide;
}

interface ReadySession {
  readonly cookies: readonly LinkedinSessionCookie[];
}

interface PageRead {
  readonly status: 'ready' | 'needs_reauth' | 'transient_failure' | 'stopped';
  readonly html?: string;
  readonly reason?: 'challenge_required' | 'expired' | 'login_required';
  readonly failure?: string;
}

export function detectCadencePageKind(url: string): CadencePageKind {
  if (/\/in\/|\/pulse\/|\/posts\//iu.test(url)) return 'deep';
  if (/\/people\/?/iu.test(url)) return 'read';
  return 'skim';
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
  private readonly planDayFn?: typeof planDay;
  private readonly decideFn?: typeof decide;
  private pauseController?: AbortController;
  private activeBrowser?: Browser;
  private activeContext?: BrowserContext;
  private running = false;
  private stopped = false;
  private reauthRequired = false;
  private consecutiveTransientFailures = 0;
  private backoffUntilMs = 0;
  private cachedPlan?: { key: string; plan: DayPlan };

  constructor(dependencies: LinkedinPoolExecutorDependencies) {
    this.config = dependencies.config;
    this.repository = dependencies.repository;
    this.database = dependencies.database;
    this.browserFactory = dependencies.browserFactory;
    this.notifyOwner = dependencies.notifyOwner;
    this.now = dependencies.now ?? (() => new Date());
    this.random = dependencies.random ?? Math.random;
    this.wait = dependencies.wait ?? abortableWait;
    this.planDayFn = dependencies.planDay;
    this.decideFn = dependencies.decide;
    if (this.config.enabled) ensureCompanyRecruitersSchema(this.database);
  }

  async runStep(): Promise<LinkedinPoolExecutorReport> {
    if (!this.config.enabled) return report('disabled');
    if (this.stopped) return report('stopped');
    if (this.reauthRequired) return report('needs_reauth');
    if (this.running) return report('stopped');
    if (this.isBackingOff()) return { ...report('transient_failure'), reason: 'backoff' };
    this.running = true;
    try {
      const outcome = await this.runEnabledStep();
      if (outcome.status === 'processed') {
        this.resetBackoff();
      } else if (outcome.status === 'transient_failure') {
        this.recordTransientFailure();
      }
      return outcome;
    } catch (error: unknown) {
      if (this.stopped) return report('stopped');
      this.recordTransientFailure();
      return { ...report('transient_failure'), reason: describeFailure(error) };
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

  private isBackingOff(): boolean {
    return this.now().getTime() < this.backoffUntilMs;
  }

  private recordTransientFailure(): void {
    this.consecutiveTransientFailures += 1;
    const baseMinutes = Math.min(60, Math.pow(2, this.consecutiveTransientFailures - 1));
    const baseMs = baseMinutes * 60_000;
    const sample = Math.min(1, Math.max(0, this.random()));
    const jitter = 0.8 + 0.4 * sample;
    this.backoffUntilMs = this.now().getTime() + Math.round(baseMs * jitter);
  }

  private resetBackoff(): void {
    this.consecutiveTransientFailures = 0;
    this.backoffUntilMs = 0;
  }

  private getOrComputePlan(accountId: string, now: Date, timezone: string, mode?: CadenceMode): DayPlan {
    const effectiveMode = mode || 'warmup';
    const localDateStr = formatLocalDate(now, timezone);
    const key = `${accountId}:${localDateStr}:${effectiveMode}:${timezone}`;
    if (this.cachedPlan?.key === key) {
      return this.cachedPlan.plan;
    }
    const compute = this.planDayFn ?? planDay;
    const plan = compute(accountId, localDateStr, effectiveMode, timezone);
    this.cachedPlan = { key, plan };
    return plan;
  }

  private async runEnabledStep(): Promise<LinkedinPoolExecutorReport> {
    const config = this.config;
    if (!config.enabled) return report('disabled');
    const now = this.now();
    const account = this.repository.findAccount(config.accountId);
    const effectiveTimezone = account?.timezone || config.timezone;
    const plan = this.getOrComputePlan(config.accountId, now, effectiveTimezone, config.mode);
    const dailyUsage = getLinkedinExecutorDailyUsage(
      this.database,
      config.accountId,
      linkedinLocalDayStart(now, effectiveTimezone).toISOString(),
    );
    const decision = (this.decideFn ?? decide)(plan, now, dailyUsage.pageCount, effectiveTimezone);
    if (decision.status !== 'run') return report(decision.status);

    if (!account) return report('account_not_ready');
    if (account.state === 'user_action_required' && account.lastFailureCode === 'needs_reauth') {
      return this.blockForReauth('login_required');
    }
    if (account.state !== 'ready') return report('account_not_ready');

    const session = await this.readReadySession(account.id, account.serverSession?.expiresAt, now);
    if ('report' in session) return session.report;

    const companyName = this.nextCompanyName(dailyUsage);
    if (!companyName) return report('no_target');

    if (dailyUsage.pageCount > 0) {
      await this.waitBetweenPages(detectCadencePageKind(linkedinCompanySearchUrl(companyName)));
      if (this.stopped) return report('stopped');
      const midDecision = (this.decideFn ?? decide)(plan, this.now(), dailyUsage.pageCount, effectiveTimezone);
      if (midDecision.status !== 'run') return report(midDecision.status);
    }
    return this.collectCompany(account.id, companyName, session.cookies, plan, dailyUsage.pageCount, effectiveTimezone);
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
    plan: DayPlan,
    pagesBefore: number,
    timezone: string,
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

    const peopleUrl = `${companyUrl}/people/`;
    await this.waitBetweenPages(detectCadencePageKind(peopleUrl));
    if (this.stopped) return report('stopped', 1, 0);
    if (!this.config.enabled) return report('disabled', 1, 0);
    const midDecision = (this.decideFn ?? decide)(plan, this.now(), pagesBefore + 1, timezone);
    if (midDecision.status !== 'run') return report(midDecision.status, 1, 0);

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
      this.pauseController = new AbortController();
      try {
        return await readLinkedinPage(page, {
          statusCode: response?.status(),
          kind: detectCadencePageKind(url),
          signal: this.pauseController.signal,
          random: this.random,
          wait: this.wait,
        });
      } finally {
        this.pauseController = undefined;
      }
    } catch (error: unknown) {
      if (this.stopped) return { status: 'stopped' };
      // LinkedIn гоняет по кругу переадресаций, когда не принимает cookies сессии
      // (прод 30.09: каждый поиск). Повторять нельзя — это риск блокировки.
      if (isRedirectLoop(error)) return { status: 'needs_reauth', reason: 'expired' };
      return { status: 'transient_failure', failure: describeFailure(error) };
    }
  }

  private async handlePageFailure(page: PageRead, pages: number): Promise<LinkedinPoolExecutorReport> {
    if (page.status === 'needs_reauth') {
      const notice = await this.blockForReauth(page.reason ?? 'challenge_required');
      return { ...notice, pageCount: pages };
    }
    if (page.status === 'stopped') return report('stopped', pages, 0);
    return { ...report('transient_failure', pages, 0), reason: page.failure ?? 'page_not_ready' };
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

  private async waitBetweenPages(kind: CadencePageKind): Promise<void> {
    this.pauseController = new AbortController();
    try {
      await this.wait(pageDelayMs(kind, this.random), this.pauseController.signal);
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

function isRedirectLoop(error: unknown): boolean {
  return error instanceof Error && error.message.includes('ERR_TOO_MANY_REDIRECTS');
}

/** Имя и сообщение ошибки, обрезанные; cookies и заголовки сюда не попадают. */
function describeFailure(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 300);
  return 'unknown_error';
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

function formatLocalDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
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
