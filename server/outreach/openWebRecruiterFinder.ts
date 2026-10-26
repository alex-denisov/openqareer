import { extractDomainFromUrl } from '../domain/company';
import type { CompanyRecruiterProfile } from '../linkedinPool/companyRecruiterDiscovery';
import { ensureCompanyRecruitersSchema } from '../linkedinPool/companyRecruiterDiscovery';
import { enrichRecruitersFromExa } from '../linkedinPool/exaRecruiterEnrichment';
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
const HIRING_PLATFORM_HOSTS = [
  'contacthr.com', 'myworkdayjobs.com', 'workday.com', 'greenhouse.io', 'lever.co',
  'smartrecruiters.com', 'ashbyhq.com', 'icims.com', 'taleo.net', 'successfactors.com',
  'jobvite.com', 'bamboohr.com', 'recruitee.com', 'workable.com', 'personio.de',
  'teamtailor.com', 'breezy.hr', 'themuse.com', 'indeed.com', 'glassdoor.com',
  'hh.ru', 'headhunter.ru', 'linkedin.com', 'remotive.com', 'habr.com', 'superjob.ru',
  'github.com', 't.me', 'huntflow.ru', 'potok.io', 'getmatch.ru', 'trudvsem.ru',
];

const SECOND_LEVEL_SUFFIXES = new Set(['co.uk', 'com.au', 'co.jp', 'com.br', 'co.in', 'com.tr']);

function isHiringPlatform(host: string): boolean {
  return HIRING_PLATFORM_HOSTS.some((platform) => host === platform || host.endsWith(`.${platform}`));
}

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
export async function resolveCompanyDomain(
  vacancy: UnifiedVacancyInput,
  resolveMx: MxResolver,
): Promise<string | undefined> {
  const linkHost = extractDomainFromUrl(vacancy.url);
  if (linkHost && !isHiringPlatform(linkHost)) return registrableDomain(linkHost);
  const fromText = extractCompanyDomain({ ...vacancy, url: undefined });
  if (fromText && !isHiringPlatform(fromText)) return registrableDomain(fromText);
  const slug = vacancy.company ? companySlug(vacancy.company) : '';
  if (slug.length < 2 || slug.length > 40) return undefined;
  for (const candidate of [`${slug}.com`, `${slug}.ru`]) {
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
    fullName: row.full_name,
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
