import { isAtsBoardSourceId } from './atsSourceId';
import type { DatabaseSync } from 'node:sqlite';
import { workdayBoardSource, workdaySourceId } from './workdayBoardSources';
import { ATS_PROVIDERS, atsBoardSourceId, type AtsProvider } from './atsBoardAdapters';
import { atsBoardSource } from './atsBoardSources';
import type { RegisteredVacancySource } from './defaultVacancySources';

/**
 * B622 — источники по компаниям справочника. Порядок решения владельца:
 * свой карьерный сайт → ATS этой компании → вакансии компании в LinkedIn по
 * org_id (гостевой поиск f_C). Основной канал — он же канал отклика и
 * побеждает при дубле; прочие доски — второй ярус, агрегаторы — третий.
 */
export type CompanyChannelKind = 'career_site' | 'company_ats' | 'linkedin_company';

export interface DirectoryCompany {
  readonly companyKey: string;
  readonly companyName: string;
  readonly websiteUrl: string | null;
  readonly careersUrl: string | null;
  readonly linkedinOrgId: string | null;
  readonly atsProvider: string | null;
  readonly atsSlug: string | null;
}

export interface CompanyChannel {
  readonly companyKey: string;
  readonly companyName: string;
  readonly kind: CompanyChannelKind;
  readonly sourceId: string;
}

export interface CompanyChannelPlan {
  /** Весь реестр с ярусами: основные каналы — 1, доски и сайты — 2, агрегаторы — 3. */
  readonly sources: readonly RegisteredVacancySource[];
  readonly channels: readonly CompanyChannel[];
}

export const LINKEDIN_COMPANY_SOURCE_PREFIX = 'src-company-li-';
const LINKEDIN_COMPANY_REFRESH_MINUTES = 720;
const KNOWN_PROVIDERS = new Set<string>(ATS_PROVIDERS.map((p) => p.provider));
const ATS_HOSTS =
  /(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|recruitee\.com|smartrecruiters\.com|breezy\.hr|pinpointhq\.com|personio\.(de|com)|bamboohr\.com|myworkdayjobs\.com|icims\.com|jobvite\.com|oraclecloud\.com|linkedin\.com|comeet\.(co|com))$/i;

/** Регистрируемый хост без www; пустая строка, если адрес не читается. */
export function siteHost(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Последние две метки хоста: careers.epam.com и epam.com — одна компания. */
export function rootDomain(host: string): string {
  return host.split('.').slice(-2).join('.');
}

function isOwnSite(url: string | null): boolean {
  const host = siteHost(url);
  return host !== '' && !ATS_HOSTS.test(host);
}

function isEmployerBoard(source: RegisteredVacancySource): boolean {
  return source.type === 'career_site' || isAtsBoardSourceId(source.id);
}

function findCareerSite(
  company: DirectoryCompany,
  byDomain: ReadonlyMap<string, RegisteredVacancySource>,
): RegisteredVacancySource | undefined {
  for (const url of [company.careersUrl, company.websiteUrl]) {
    if (!isOwnSite(url)) continue;
    const found = byDomain.get(rootDomain(siteHost(url)));
    if (found) return found;
  }
  return undefined;
}

const CAREERS_URL_BOARDS: readonly [RegExp, AtsProvider][] = [
  [/^https?:\/\/(?:job-)?boards(?:\.eu)?\.greenhouse\.io\/([\w-]+)/i, 'greenhouse'],
  [/^https?:\/\/jobs(?:\.eu)?\.lever\.co\/([\w.-]+)/i, 'lever'],
  [/^https?:\/\/jobs\.ashbyhq\.com\/([\w.-]+)/i, 'ashby'],
  [/^https?:\/\/apply\.workable\.com\/([\w-]+)/i, 'workable'],
  [/^https?:\/\/([\w-]+)\.recruitee\.com/i, 'recruitee'],
  [/^https?:\/\/(?:careers|jobs)\.smartrecruiters\.com\/([\w-]+)/i, 'smartrecruiters'],
  [/^https?:\/\/([\w-]+)\.breezy\.hr/i, 'breezy'],
  [/^https?:\/\/([\w-]+)\.pinpointhq\.com/i, 'pinpoint'],
  [/^https?:\/\/([\w-]+)\.jobs\.personio\.(?:de|com)/i, 'personio'],
  [/^https?:\/\/(?!www\.)([\w-]+)\.bamboohr\.com/i, 'bamboohr'],
  [/^https?:\/\/(?!www\.)([\w-]+)\.teamtailor\.com/i, 'teamtailor'],
];

/** Доска ATS из записи справочника, а если поля пусты — из адреса страницы вакансий. */
export function directoryBoard(
  company: DirectoryCompany,
): { provider: string; board: string } | undefined {
  const provider = company.atsProvider?.trim().toLowerCase();
  const board = company.atsSlug?.trim();
  if (provider && board) return { provider, board };
  for (const [pattern, fromUrl] of CAREERS_URL_BOARDS) {
    const match = pattern.exec(company.careersUrl ?? '');
    if (match?.[1]) return { provider: fromUrl, board: match[1] };
  }
  return undefined;
}

function companyAtsSource(
  company: DirectoryCompany,
  byId: ReadonlyMap<string, RegisteredVacancySource>,
): RegisteredVacancySource | undefined {
  const { provider, board } = directoryBoard(company) ?? {};
  if (provider === 'workday' && board) return companyWorkdaySource(company, board, byId);
  if (!provider || !board || !KNOWN_PROVIDERS.has(provider)) return undefined;
  const id = atsBoardSourceId(provider as AtsProvider, board);
  const known = byId.get(id);
  if (known) return known.enabled ? known : undefined;
  const built = atsBoardSource({
    company: company.companyName,
    provider: provider as AtsProvider,
    board,
    jobs: 0,
    observedAt: '',
    lists: ['company_directory'],
  });
  return built.enabled ? built : undefined;
}

/** B628: доска Workday из справочника — слаг вида tenant/wdN/site, опрос адаптером Workday. */
const WORKDAY_SLUG = /^([a-z0-9-]+)\/(wd\d+)\/([A-Za-z0-9_-]+)$/i;

function companyWorkdaySource(
  company: DirectoryCompany,
  board: string,
  byId: ReadonlyMap<string, RegisteredVacancySource>,
): RegisteredVacancySource | undefined {
  const match = WORKDAY_SLUG.exec(board.trim());
  if (!match) return undefined;
  const [, rawTenant, wd, site] = match;
  const tenant = rawTenant.toLowerCase();
  const known = byId.get(workdaySourceId(tenant));
  if (known) return known.enabled ? known : undefined;
  return workdayBoardSource({
    company: company.companyName,
    tenant,
    host: `${tenant}.${wd.toLowerCase()}.myworkdayjobs.com`,
    site,
    jobs: 0,
    observedAt: '',
  });
}

function linkedinCompanySource(company: DirectoryCompany): RegisteredVacancySource | undefined {
  const orgId = company.linkedinOrgId?.trim();
  if (!orgId || !/^\d+$/.test(orgId)) return undefined;
  return {
    id: `${LINKEDIN_COMPANY_SOURCE_PREFIX}${company.companyKey}`,
    name: `${company.companyName} (LinkedIn)`,
    type: 'json_api',
    accessClass: 'open_web',
    market: 'Вакансии компании в LinkedIn (гостевой поиск по org_id)',
    addressStatus: 'live',
    enabled: true,
    targetUrl: `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?f_C=${orgId}&geoId=92000000`,
    refreshIntervalMinutes: LINKEDIN_COMPANY_REFRESH_MINUTES,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
    linkedinOrgId: orgId,
    robotsOverride: {
      grantedBy: 'owner',
      grantedOn: '2026-11-08',
      basis:
        'Решение владельца B622: вакансии компании читаются гостевым поиском LinkedIn по org_id (f_C), без пула аккаунтов; 429 — пауза всего LinkedIn, а не пропуск.',
    },
  };
}

export const COMPANY_SITE_SOURCE_PREFIX = 'src-company-site-';
const COMPANY_SITE_REFRESH_MINUTES = 720;

/**
 * B628 — свой адрес вакансий из справочника становится источником общего
 * адаптера сайтов (JSON-LD, __NEXT_DATA__, встроенная ATS, разметка). Только
 * явный careers_url: главная страница сайта — не страница вакансий.
 */
function companySiteSource(company: DirectoryCompany): RegisteredVacancySource | undefined {
  const url = company.careersUrl?.trim() ?? '';
  if (!isOwnSite(url) || !/^https?:\/\//i.test(url)) return undefined;
  return {
    id: `${COMPANY_SITE_SOURCE_PREFIX}${company.companyKey}`,
    name: `${company.companyName} Careers`,
    type: 'career_site',
    accessClass: 'open_web',
    market: 'Вакансии на сайте компании (справочник компаний)',
    addressStatus: 'live',
    enabled: true,
    targetUrl: url,
    refreshIntervalMinutes: COMPANY_SITE_REFRESH_MINUTES,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  };
}

function primaryFor(
  company: DirectoryCompany,
  byDomain: ReadonlyMap<string, RegisteredVacancySource>,
  byId: ReadonlyMap<string, RegisteredVacancySource>,
): { kind: CompanyChannelKind; source: RegisteredVacancySource } | undefined {
  const site = findCareerSite(company, byDomain);
  if (site) return { kind: 'career_site', source: site };
  const ownSite = companySiteSource(company);
  if (ownSite) return { kind: 'career_site', source: byId.get(ownSite.id) ?? ownSite };
  const ats = companyAtsSource(company, byId);
  if (ats) return { kind: 'company_ats', source: ats };
  const linkedin = linkedinCompanySource(company);
  return linkedin ? { kind: 'linkedin_company', source: linkedin } : undefined;
}

function indexCareerSites(
  registry: readonly RegisteredVacancySource[],
): Map<string, RegisteredVacancySource> {
  const byDomain = new Map<string, RegisteredVacancySource>();
  for (const source of registry) {
    if (source.type !== 'career_site' || !source.enabled) continue;
    const host = siteHost(source.targetUrl);
    if (host && !ATS_HOSTS.test(host)) byDomain.set(rootDomain(host), source);
  }
  return byDomain;
}

/** Чистый план: реестр плюс справочник → реестр с ярусами и основной канал каждой компании. */
export function planCompanyChannels(
  registry: readonly RegisteredVacancySource[],
  companies: readonly DirectoryCompany[],
): CompanyChannelPlan {
  const byId = new Map(registry.map((source) => [source.id, source]));
  const byDomain = indexCareerSites(registry);
  const channels: CompanyChannel[] = [];
  const primaries = new Map<string, { companyKey: string; source: RegisteredVacancySource }>();
  for (const company of companies) {
    const primary = primaryFor(company, byDomain, byId);
    if (!primary || primaries.has(primary.source.id)) continue;
    primaries.set(primary.source.id, { companyKey: company.companyKey, source: primary.source });
    channels.push({
      companyKey: company.companyKey,
      companyName: company.companyName,
      kind: primary.kind,
      sourceId: primary.source.id,
    });
  }
  const tiered = registry.map((source): RegisteredVacancySource => {
    const primary = primaries.get(source.id);
    if (primary) return { ...source, channelTier: 1, companyKey: primary.companyKey };
    return { ...source, channelTier: isEmployerBoard(source) ? 2 : 3 };
  });
  const added = [...primaries.values()]
    .filter(({ source }) => !byId.has(source.id))
    .map(({ source, companyKey }): RegisteredVacancySource => ({
      ...source,
      channelTier: 1,
      companyKey,
    }));
  return { sources: [...tiered, ...added], channels };
}

interface DirectoryRow {
  company_key: string;
  company_name: string;
  website_url: string | null;
  careers_url: string | null;
  linkedin_org_id: string | null;
  ats_provider: string | null;
  ats_slug: string | null;
}

/**
 * Только чтение: активные компании справочника, у которых есть что опрашивать
 * (B644: 140 тыс. имён из каталога freehire без досок не читаются при старте).
 * Без таблицы — пустой список.
 */
export function readDirectoryCompanies(database: DatabaseSync): readonly DirectoryCompany[] {
  const table = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'company_directory'")
    .get();
  if (!table) return [];
  const rows = database
    .prepare(
      `SELECT company_key, company_name, website_url, careers_url, linkedin_org_id,
              ats_provider, ats_slug
         FROM company_directory WHERE status = 'active'
          AND (ats_provider IS NOT NULL OR careers_url IS NOT NULL OR website_url IS NOT NULL OR linkedin_org_id IS NOT NULL)
        ORDER BY company_key`,
    )
    .all() as unknown as DirectoryRow[];
  return rows.map((row) => ({
    companyKey: row.company_key,
    companyName: row.company_name,
    websiteUrl: row.website_url,
    careersUrl: row.careers_url,
    linkedinOrgId: row.linkedin_org_id,
    atsProvider: row.ats_provider,
    atsSlug: row.ats_slug,
  }));
}
