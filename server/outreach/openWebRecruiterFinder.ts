import { isHiringPlatform } from '../../shared/hiringPlatforms';
import { personNameFromTitle } from '../../shared/personName';
import { extractDomainFromUrl } from '../domain/company';
import type { CompanyRecruiterProfile } from '../linkedinPool/companyRecruiterDiscovery';
import { ensureCompanyRecruitersSchema } from '../linkedinPool/companyRecruiterDiscovery';
import { EXA_COMPANY_CACHE_DAYS, enrichRecruitersFromExa } from '../linkedinPool/exaRecruiterEnrichment';
import { searchExaWeb } from '../osint/adapters/exaAdapter';
import type { SqliteLinkedinPoolRepository } from '../linkedinPool/sqliteLinkedinPoolRepository';
import type { FootprintRequestGate } from '../osint/adapters/requestScheduler';
import type { MxResolver, UnifiedVacancyInput } from './recruiterIntelligenceService';
import { extractCompanyDomain, transliterateToLatin } from './recruiterIntelligenceService';

/**
 * Путь без LinkedIn: рекрутёр компании из открытых публичных профилей (поиск
 * Exa по имени компании) и домен почты, подтверждённый MX. Ни аккаунт
 * кандидата, ни аккаунты пула LinkedIn здесь не используются.
 */
export interface OpenWebRecruiterFinderOptions {
  readonly repository: SqliteLinkedinPoolRepository;
  readonly apiKey: string | undefined;
  readonly fetch?: typeof fetch;
  readonly requestGate?: FootprintRequestGate;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
}

const EXA_TIMEOUT_MS = 15_000;
const STORED_RECRUITER_DAYS = 180;

/** Хосты ATS и площадок: адрес вакансии на них не говорит о домене почты компании. */

const SECOND_LEVEL_SUFFIXES = new Set(['co.uk', 'com.au', 'co.jp', 'com.br', 'co.in', 'com.tr']);

function registrableDomain(host: string): string {
  const labels = host.split('.');
  const lastTwo = labels.slice(-2).join('.');
  return SECOND_LEVEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

function companySlug(company: string): string {
  return transliterateToLatin(company)
    .replace(/\b(inc|llc|ltd|plc|gmbh|corp|corporation|company|group|ooo|ao|pao)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Домен почты компании: сайт из вакансии, если это не ATS и не площадка;
 * иначе «имя компании» в .com / .ru, принятый только при наличии MX.
 */
export type CompanyMarket = 'ru';

const RUSSIAN_BOARD_HOSTS = ['hh.ru', 'headhunter.ru', 'superjob.ru', 'trudvsem.ru', 'habr.com', 'getmatch.ru', 'rabota.ru', 'zarplata.ru'];

/** Вакансия с российской площадки или на русском — сайт компании ищется в зоне .ru. */
export function companyMarket(vacancy: UnifiedVacancyInput): CompanyMarket | undefined {
  const host = extractDomainFromUrl(vacancy.url) ?? '';
  if (RUSSIAN_BOARD_HOSTS.some((board) => host === board || host.endsWith(`.${board}`))) return 'ru';
  return /[А-Яа-яЁё]/u.test(`${vacancy.company ?? ''} ${vacancy.title ?? ''}`) ? 'ru' : undefined;
}

export async function resolveCompanyDomain(
  vacancy: UnifiedVacancyInput,
  resolveMx: MxResolver,
  findSite?: (company: string, market?: CompanyMarket) => Promise<string | undefined>,
): Promise<string | undefined> {
  const market = companyMarket(vacancy);
  const linkHost = extractDomainFromUrl(vacancy.url);
  if (linkHost && !isHiringPlatform(linkHost)) return registrableDomain(linkHost);
  const fromText = extractCompanyDomain({ ...vacancy, url: undefined });
  if (fromText && !isHiringPlatform(fromText)) return registrableDomain(fromText);
  const found = vacancy.company && findSite ? await findSite(vacancy.company, market) : undefined;
  if (found) return found;
  const slug = vacancy.company ? companySlug(vacancy.company) : '';
  if (slug.length < 2 || slug.length > 40) return undefined;
  for (const candidate of market === 'ru' ? [`${slug}.ru`, `${slug}.com`] : [`${slug}.com`, `${slug}.ru`]) {
    try {
      if ((await resolveMx(candidate)).length > 0) return candidate;
    } catch {
      // Нет ответа DNS — следующий вариант.
    }
  }
  return undefined;
}

function readStoredRecruiter(
  repository: SqliteLinkedinPoolRepository,
  companyName: string,
  now: Date,
): CompanyRecruiterProfile | null {
  const database = repository.getDatabase();
  ensureCompanyRecruitersSchema(database);
  const row = database
    .prepare(
      `SELECT full_name, role_title, linkedin_url, observed_at
       FROM linkedin_pool_company_recruiters
       WHERE company_name = ? COLLATE NOCASE AND observed_at >= ?
       ORDER BY observed_at DESC LIMIT 1`,
    )
    .get(companyName.trim(), new Date(now.getTime() - STORED_RECRUITER_DAYS * 86_400_000).toISOString()) as
    | { full_name: string; role_title: string; linkedin_url: string; observed_at: string }
    | undefined;
  if (!row) return null;
  return {
    fullName: personNameFromTitle(row.full_name),
    roleTitle: row.role_title,
    linkedinUrl: row.linkedin_url,
    sourcePlatform: 'company_osint',
    sourceUrl: row.linkedin_url,
    confidence: 0.7,
    observedAt: row.observed_at,
  };
}

export function createOpenWebRecruiterFinder(
  options: OpenWebRecruiterFinderOptions,
): (companyName: string) => Promise<CompanyRecruiterProfile | null> {
  const now = options.now ?? (() => new Date());
  return async (companyName) => {
    const name = companyName.trim();
    if (!name) return null;
    const stored = readStoredRecruiter(options.repository, name, now());
    if (stored || !options.apiKey) return stored;
    // Кэш компании на 30 дней внутри enrichRecruitersFromExa: повторный запрос не оплачивается.
    await enrichRecruitersFromExa({
      repository: options.repository,
      companyName: name,
      cards: [],
      apiKey: options.apiKey,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.requestGate ? { requestGate: options.requestGate } : {}),
      now,
      signal: AbortSignal.timeout(options.timeoutMs ?? EXA_TIMEOUT_MS),
    });
    return readStoredRecruiter(options.repository, name, now());
  };
}

export interface CompanySiteFinderOptions extends OpenWebRecruiterFinderOptions {
  readonly resolveMx: MxResolver;
}

const SITE_CACHE_SCHEMA = `
CREATE TABLE IF NOT EXISTS company_mail_domain_cache (
  company_name TEXT PRIMARY KEY COLLATE NOCASE,
  domain TEXT,
  queried_at TEXT NOT NULL
) STRICT;`;

async function acceptsMail(domain: string, resolveMx: MxResolver): Promise<boolean> {
  try {
    return (await resolveMx(domain)).length > 0;
  } catch {
    return false;
  }
}

async function firstMailDomain(urls: readonly string[], resolveMx: MxResolver, market?: CompanyMarket): Promise<string | null> {
  // Для российской компании первыми проверяются сайты в .ru и .рф: одноимённая зарубежная организация не подменяет её.
  const local = (url: string) => /\.(?:ru|xn--p1ai)(?:[/:]|$)/u.test(extractDomainFromUrl(url) ?? '');
  const ordered = market === 'ru' ? [...urls.filter(local), ...urls.filter((url) => !local(url))] : urls;
  for (const url of ordered) {
    const host = extractDomainFromUrl(url);
    if (!host || isHiringPlatform(host)) continue;
    const domain = registrableDomain(host);
    if (await acceptsMail(domain, resolveMx)) return domain;
  }
  return null;
}

/**
 * Сайт компании через веб-поиск Exa; принимается первый домен, не являющийся
 * площадкой, с записями MX. Результат и промах кэшируются на 30 дней.
 */
export function createCompanySiteFinder(
  options: CompanySiteFinderOptions,
): (companyName: string, market?: CompanyMarket) => Promise<string | undefined> {
  const now = options.now ?? (() => new Date());
  return async (companyName, market) => {
    const name = companyName.trim();
    // Ключ кэша с рынком: прежний промах поиска по-английски не мешает поиску по-русски.
    const cacheKey = market ? `${name}|${market}` : name;
    if (!name || !options.apiKey) return undefined;
    const database = options.repository.getDatabase();
    database.exec(SITE_CACHE_SCHEMA);
    const cached = database
      .prepare('SELECT domain, queried_at FROM company_mail_domain_cache WHERE company_name = ?')
      .get(cacheKey) as { domain: string | null; queried_at: string } | undefined;
    if (cached && Date.parse(cached.queried_at) > now().getTime() - EXA_COMPANY_CACHE_DAYS * 86_400_000) {
      return cached.domain ?? undefined;
    }
    let urls: readonly string[];
    try {
      urls = await searchExaWeb(market === 'ru' ? `${name} официальный сайт компании` : `${name} official website`, options.apiKey, AbortSignal.timeout(options.timeoutMs ?? EXA_TIMEOUT_MS), {
        ...(options.fetch ? { fetch: options.fetch } : {}),
        ...(options.requestGate ? { requestGate: options.requestGate } : {}),
        numResults: 5,
        contents: { text: { maxCharacters: 1 } },
      });
    } catch {
      return undefined;
    }
    const domain = await firstMailDomain(urls, options.resolveMx, market);
    database
      .prepare(
        `INSERT INTO company_mail_domain_cache (company_name, domain, queried_at) VALUES (?, ?, ?)
         ON CONFLICT(company_name) DO UPDATE SET domain = excluded.domain, queried_at = excluded.queried_at`,
      )
      .run(cacheKey, domain, now().toISOString());
    return domain ?? undefined;
  };
}
