import type { DatabaseSync } from 'node:sqlite';
import { isAtsBoardSourceId } from './atsSourceId';
import { workdayBoardSource, workdaySourceId } from './workdayBoardSources';
import { ATS_PROVIDERS, atsBoardSourceId, type AtsProvider } from './atsBoardAdapters';
import { atsBoardSource } from './atsBoardSources';
import type { RegisteredVacancySource } from './defaultVacancySources';
import {
  describeSourceHealth,
  isDeadSource,
  type SourceObservations,
} from './sourceHealthVerdict';

/**
 * B622 / Phase 1 F2+F3 — источники по компаниям справочника:
 * ATS компании → свой карьерный сайт (если не мёртв и не пуст) →
 * вакансии компании в LinkedIn по org_id (гостевой поиск f_C).
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

export interface SourceStateSummary {
  readonly sourceId: string;
  readonly lastStatus?: string | null;
  readonly lastErrorMessage?: string | null;
  readonly itemsFoundTotal: number;
  readonly itemsActiveTotal?: number;
  readonly observations?: SourceObservations | null;
}

export interface PlanCompanyChannelsOptions {
  readonly sourceStates?: ReadonlyMap<string, SourceStateSummary>;
  readonly placementHealthBySourceId?: ReadonlyMap<string, string>;
  readonly sitePlacementHealthByCompany?: ReadonlyMap<string, string>;
  readonly unhealthySourceIds?: ReadonlySet<string>;
  readonly goneCompanySiteKeys?: ReadonlySet<string>;
  readonly unavailableAtsSourceIds?: ReadonlySet<string>;
  readonly nowMs?: number;
}

export const LINKEDIN_COMPANY_SOURCE_PREFIX = 'src-company-li-';
const LINKEDIN_COMPANY_REFRESH_MINUTES = 720;
export const COMPANY_SITE_SOURCE_PREFIX = 'src-company-site-';
const COMPANY_SITE_REFRESH_MINUTES = 720;
const FALLBACK_ERROR_STREAK = 3;
const FALLBACK_EMPTY_STREAK = 3;

const KNOWN_PROVIDERS = new Set<string>(ATS_PROVIDERS.map((p) => p.provider));

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ATS_HOST_SUFFIXES: readonly string[] = [
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'workable.com',
  'recruitee.com',
  'smartrecruiters.com',
  'breezy.hr',
  'pinpointhq.com',
  'personio.de',
  'personio.com',
  'bamboohr.com',
  'myworkdayjobs.com',
  'icims.com',
  'jobvite.com',
  'oraclecloud.com',
  'linkedin.com',
  'comeet.co',
  'comeet.com',
  'teamtailor.com',
  'join.com',
  'paylocity.com',
  'rippling.com',
  'applytojob.com',
  'phenompeople.com',
  'successfactors.com',
  'successfactors.eu',
  'my.salesforce-sites.com',
  'ultipro.com',
  'dayforcehcm.com',
  'adp.com',
  'taleo.net',
  'brassring.com',
  'talentreef.com',
  'paycor.com',
];

const ATS_HOSTS = new RegExp(
  `(?:^|\\.)(?:${ATS_HOST_SUFFIXES.map(escapeRegExp).join('|')})$`,
  'i',
);

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

interface CareersUrlBoardRule {
  readonly pattern: RegExp;
  readonly provider: string;
  readonly normalizeBoard?: (match: RegExpExecArray) => string | undefined;
}

const CAREERS_URL_BOARDS: readonly CareersUrlBoardRule[] = [
  { pattern: /^https?:\/\/(?:job-)?boards(?:\.eu)?\.greenhouse\.io\/([\w-]+)/i, provider: 'greenhouse' },
  { pattern: /^https?:\/\/jobs(?:\.eu)?\.lever\.co\/([\w.-]+)/i, provider: 'lever' },
  { pattern: /^https?:\/\/jobs\.ashbyhq\.com\/([\w.-]+)/i, provider: 'ashby' },
  { pattern: /^https?:\/\/apply\.workable\.com\/([\w-]+)/i, provider: 'workable' },
  { pattern: /^https?:\/\/([\w-]+)\.recruitee\.com/i, provider: 'recruitee' },
  { pattern: /^https?:\/\/(?:careers|jobs)\.smartrecruiters\.com\/([\w-]+)/i, provider: 'smartrecruiters' },
  { pattern: /^https?:\/\/([\w-]+)\.breezy\.hr/i, provider: 'breezy' },
  { pattern: /^https?:\/\/([\w-]+)\.pinpointhq\.com/i, provider: 'pinpoint' },
  { pattern: /^https?:\/\/([\w-]+)\.jobs\.personio\.(?:de|com)/i, provider: 'personio' },
  { pattern: /^https?:\/\/(?!www\.)([\w-]+)\.bamboohr\.com/i, provider: 'bamboohr' },
  { pattern: /^https?:\/\/(?!www\.)([\w-]+)\.teamtailor\.com/i, provider: 'teamtailor' },
  {
    pattern: /^https?:\/\/(?:www\.)?join\.com\/(?:api\/public\/)?companies\/(\d+)(?:[/?#]|$)/i,
    provider: 'join',
  },
  {
    pattern: /^https?:\/\/recruiting\.paylocity\.com\/recruiting\/jobs\/(?:all|list)\/([\w-]+)(?:[/?#]|$)/i,
    provider: 'paylocity',
  },
  {
    pattern: /^https?:\/\/ats\.rippling\.com\/([a-z0-9_-]+)(?:\/jobs|[/?#]|$)/i,
    provider: 'rippling',
  },
  {
    pattern: /^https?:\/\/([a-z0-9-]+)\.applytojob\.com(?:\/apply|[/?#]|$)/i,
    provider: 'jazzhr',
  },
  {
    pattern: /^https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?([A-Za-z0-9_-]+)(?:[/?#]|$)/i,
    provider: 'workday',
    normalizeBoard: (match) => `${match[1]}/${match[2]}/${match[3]}`,
  },
];

/** Доска ATS из записи справочника, а если поля пусты — из адреса страницы вакансий. */
export function directoryBoard(
  company: DirectoryCompany,
): { provider: string; board: string } | undefined {
  const provider = company.atsProvider?.trim().toLowerCase();
  const board = company.atsSlug?.trim();
  if (provider && board) return { provider, board };
  for (const rule of CAREERS_URL_BOARDS) {
    const match = rule.pattern.exec(company.careersUrl ?? '');
    if (!match) continue;
    const extracted = rule.normalizeBoard ? rule.normalizeBoard(match) : match[1];
    if (extracted) return { provider: rule.provider, board: extracted };
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
  if (provider === 'join' && !/^\d+$/.test(board)) return undefined;
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

function isRateLimitedState(state: SourceStateSummary): boolean {
  if (state.observations?.schedule?.lastStatusCode === 429) return true;
  return /unreachable:\s*429\b/i.test(state.lastErrorMessage ?? '');
}

function failureStreakOf(state: SourceStateSummary): number {
  const obs = state.observations;
  const emptyWindowFailures =
    (obs?.windowSuccessful ?? 0) === 0 ? (obs?.windowReadings ?? 0) : 0;
  return Math.max(
    obs?.schedule?.consecutiveFailures ?? 0,
    obs?.consecutiveNotFound ?? 0,
    obs?.consecutiveTerminalFailures ?? 0,
    emptyWindowFailures,
  );
}

/**
 * Решает, пора ли немедленно переключить компанию с мёртвого или постоянно
 * пустого `career_site` на запасной канал (`company_ats` / `linkedin_company`),
 * не дожидаясь 14-дневного удаления в `careersPrune`.
 *
 * Первые 1–2 сбоя, первые 1–2 пустых чтения и любой 429 rate-limit возвращают `false`.
 */
export function isSiteFallbackWarranted(
  sourceId: string,
  companyKey: string,
  options: PlanCompanyChannelsOptions = {},
): boolean {
  if (options.unhealthySourceIds?.has(sourceId) || options.goneCompanySiteKeys?.has(companyKey)) {
    return true;
  }
  const placementHealth =
    options.placementHealthBySourceId?.get(sourceId) ??
    options.sitePlacementHealthByCompany?.get(companyKey);
  if (placementHealth === 'gone' || placementHealth === 'disabled') return true;

  const state = options.sourceStates?.get(sourceId);
  if (!state) return false;
  if (state.lastStatus === 'disabled') return true;

  const obs = state.observations;
  const nowMs = options.nowMs ?? Date.now();
  if (obs && isDeadSource(describeSourceHealth(obs, { addressStatus: 'live' }, nowMs))) {
    return true;
  }
  if ((obs?.consecutiveEmptyReadings ?? 0) >= FALLBACK_EMPTY_STREAK) return true;
  if (state.lastStatus === 'error' && !isRateLimitedState(state)) {
    if (!obs && state.itemsFoundTotal === 0) return true;
    return failureStreakOf(state) >= FALLBACK_ERROR_STREAK;
  }
  return false;
}

/** Проверяет, что доска ATS закрыта/удалена/отключена и не должна браться основным каналом. */
export function isAtsUnavailable(
  sourceId: string,
  options: PlanCompanyChannelsOptions = {},
): boolean {
  if (options.unavailableAtsSourceIds?.has(sourceId)) return true;
  const placementHealth = options.placementHealthBySourceId?.get(sourceId);
  if (placementHealth === 'gone' || placementHealth === 'disabled') return true;

  const state = options.sourceStates?.get(sourceId);
  if (!state) return false;
  if (state.lastStatus === 'disabled') return true;
  if (/^(?:board_closed:|vacancy_source_board_gone)/i.test(state.lastErrorMessage ?? '')) {
    return true;
  }
  const obs = state.observations;
  if ((obs?.consecutiveNotFound ?? 0) >= FALLBACK_ERROR_STREAK) return true;
  const nowMs = options.nowMs ?? Date.now();
  return Boolean(obs && isDeadSource(describeSourceHealth(obs, { addressStatus: 'live' }, nowMs)));
}

function isSiteGone(
  siteId: string,
  companyKey: string,
  options: PlanCompanyChannelsOptions,
): boolean {
  if (options.goneCompanySiteKeys?.has(companyKey)) return true;
  const health =
    options.placementHealthBySourceId?.get(siteId) ??
    options.sitePlacementHealthByCompany?.get(companyKey);
  return health === 'gone';
}

function primaryFor(
  company: DirectoryCompany,
  byDomain: ReadonlyMap<string, RegisteredVacancySource>,
  byId: ReadonlyMap<string, RegisteredVacancySource>,
  options: PlanCompanyChannelsOptions = {},
): { kind: CompanyChannelKind; source: RegisteredVacancySource } | undefined {
  const ats = companyAtsSource(company, byId);
  if (ats && !isAtsUnavailable(ats.id, options)) {
    return { kind: 'company_ats', source: ats };
  }

  const registrySite = findCareerSite(company, byDomain);
  const ownSite = companySiteSource(company);
  const site = registrySite ?? (ownSite ? (byId.get(ownSite.id) ?? ownSite) : undefined);
  if (site) {
    if (!isSiteFallbackWarranted(site.id, company.companyKey, options)) {
      return { kind: 'career_site', source: site };
    }
    const linkedin = linkedinCompanySource(company);
    if (linkedin) return { kind: 'linkedin_company', source: linkedin };
    if (isSiteGone(site.id, company.companyKey, options)) return undefined;
    return { kind: 'career_site', source: site };
  }

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
  options: PlanCompanyChannelsOptions = {},
): CompanyChannelPlan {
  const byId = new Map(registry.map((source) => [source.id, source]));
  const byDomain = indexCareerSites(registry);
  const channels: CompanyChannel[] = [];
  const primaries = new Map<string, { companyKey: string; source: RegisteredVacancySource }>();
  for (const company of companies) {
    const primary = primaryFor(company, byDomain, byId, options);
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

function mapDirectoryRow(row: DirectoryRow): DirectoryCompany {
  return {
    companyKey: row.company_key,
    companyName: row.company_name,
    websiteUrl: row.website_url,
    careersUrl: row.careers_url,
    linkedinOrgId: row.linkedin_org_id,
    atsProvider: row.ats_provider,
    atsSlug: row.ats_slug,
  };
}

function tableExists(database: DatabaseSync, tableName: string): boolean {
  return Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName),
  );
}

function parseObservationsSafe(raw: string | null): SourceObservations | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as SourceObservations) : null;
  } catch {
    return null;
  }
}

interface StateSummarySqlRow {
  source_id: string;
  last_status: string | null;
  last_error_message: string | null;
  items_found_total: number;
  items_active_total: number;
  observations: string | null;
}

function toStateSummary(row: StateSummarySqlRow): SourceStateSummary {
  return {
    sourceId: row.source_id,
    lastStatus: row.last_status,
    lastErrorMessage: row.last_error_message,
    itemsFoundTotal: row.items_found_total,
    itemsActiveTotal: row.items_active_total,
    observations: parseObservationsSafe(row.observations),
  };
}

function collectSourceHealthFromState(
  database: DatabaseSync,
  nowMs: number,
  unhealthySourceIds: Set<string>,
  unavailableAtsSourceIds: Set<string>,
): void {
  if (!tableExists(database, 'vacancy_source_state')) return;
  const stmt = database.prepare(
    `SELECT source_id, last_status, last_error_message,
            items_found_total, items_active_total, observations
       FROM vacancy_source_state
      WHERE source_id LIKE 'src-company-site-%'
         OR source_id LIKE 'ats-%'
         OR source_id LIKE 'src-%'`,
  );
  const singleMap = new Map<string, SourceStateSummary>();
  for (const raw of stmt.iterate() as IterableIterator<StateSummarySqlRow>) {
    const summary = toStateSummary(raw);
    singleMap.set(summary.sourceId, summary);
    const opts: PlanCompanyChannelsOptions = { sourceStates: singleMap, nowMs };
    if (isAtsBoardSourceId(summary.sourceId)) {
      if (isAtsUnavailable(summary.sourceId, opts)) unavailableAtsSourceIds.add(summary.sourceId);
    } else if (summary.sourceId.startsWith(COMPANY_SITE_SOURCE_PREFIX)) {
      const companyKey = summary.sourceId.slice(COMPANY_SITE_SOURCE_PREFIX.length);
      if (isSiteFallbackWarranted(summary.sourceId, companyKey, opts)) unhealthySourceIds.add(summary.sourceId);
    } else if (isSiteFallbackWarranted(summary.sourceId, '', opts)) {
      unhealthySourceIds.add(summary.sourceId);
    }
    singleMap.clear();
  }
}

function collectPlacementHealthFlags(
  database: DatabaseSync,
  unhealthySourceIds: Set<string>,
  unavailableAtsSourceIds: Set<string>,
  goneCompanySiteKeys: Set<string>,
): void {
  if (!tableExists(database, 'company_placement')) return;
  const rows = database
    .prepare(
      `SELECT source_id, company_key, type, health
         FROM company_placement
        WHERE health IN ('gone', 'disabled')`,
    )
    .all() as unknown as {
    source_id: string | null;
    company_key: string;
    type: string;
    health: string;
  }[];
  for (const row of rows) {
    if (row.source_id) {
      if (isAtsBoardSourceId(row.source_id)) unavailableAtsSourceIds.add(row.source_id);
      else unhealthySourceIds.add(row.source_id);
    }
    if (row.type === 'employer_site' && row.health === 'gone') goneCompanySiteKeys.add(row.company_key);
  }
}

/**
 * Потоковое чтение сводки здоровья каналов на старте: обходит
 * `vacancy_source_state` через `.iterate()`, не поднимая 80 тыс. JSON-объектов
 * в кучу, и собирает только компактные `Set<string>` проблемных источников.
 */
export function readChannelHealthSummary(
  database: DatabaseSync,
  nowMs: number = Date.now(),
): PlanCompanyChannelsOptions {
  const unhealthySourceIds = new Set<string>();
  const unavailableAtsSourceIds = new Set<string>();
  const goneCompanySiteKeys = new Set<string>();
  collectSourceHealthFromState(database, nowMs, unhealthySourceIds, unavailableAtsSourceIds);
  collectPlacementHealthFlags(database, unhealthySourceIds, unavailableAtsSourceIds, goneCompanySiteKeys);
  return { unhealthySourceIds, unavailableAtsSourceIds, goneCompanySiteKeys, nowMs };
}

export interface ResolvedCompanyChannel {
  readonly primary?: CompanyChannel & { readonly source: RegisteredVacancySource };
  readonly companySiteSourceId: string;
  readonly retiredSourceIds: readonly string[];
}

function loadCandidateStates(
  database: DatabaseSync,
  candidateIds: readonly string[],
): Map<string, SourceStateSummary> {
  const sourceStates = new Map<string, SourceStateSummary>();
  if (!tableExists(database, 'vacancy_source_state') || candidateIds.length === 0) return sourceStates;
  const placeholders = candidateIds.map(() => '?').join(', ');
  const stateRows = database
    .prepare(
      `SELECT source_id, last_status, last_error_message,
              items_found_total, items_active_total, observations
         FROM vacancy_source_state
        WHERE source_id IN (${placeholders})`,
    )
    .all(...candidateIds) as unknown as StateSummarySqlRow[];
  for (const stateRow of stateRows) {
    sourceStates.set(stateRow.source_id, toStateSummary(stateRow));
  }
  return sourceStates;
}

function loadCompanyPlacementHealth(
  database: DatabaseSync,
  companyKey: string,
): {
  placementHealthBySourceId: Map<string, string>;
  sitePlacementHealthByCompany: Map<string, string>;
} {
  const placementHealthBySourceId = new Map<string, string>();
  const sitePlacementHealthByCompany = new Map<string, string>();
  if (!tableExists(database, 'company_placement')) {
    return { placementHealthBySourceId, sitePlacementHealthByCompany };
  }
  const placementRows = database
    .prepare(
      `SELECT source_id, type, health
         FROM company_placement
        WHERE company_key = ? AND health IN ('gone', 'disabled')`,
    )
    .all(companyKey) as unknown as { source_id: string | null; type: string; health: string }[];
  for (const p of placementRows) {
    if (p.source_id) placementHealthBySourceId.set(p.source_id, p.health);
    if (p.type === 'employer_site' && p.health === 'gone') sitePlacementHealthByCompany.set(companyKey, p.health);
  }
  return { placementHealthBySourceId, sitePlacementHealthByCompany };
}

function resolveCompanyRecord(
  database: DatabaseSync,
  companyKey: string,
): DirectoryCompany | undefined {
  if (!tableExists(database, 'company_directory')) return undefined;
  const row = database
    .prepare(
      `SELECT company_key, company_name, website_url, careers_url, linkedin_org_id,
              ats_provider, ats_slug
         FROM company_directory
        WHERE company_key = ? AND status = 'active'`,
    )
    .get(companyKey) as DirectoryRow | undefined;
  return row ? mapDirectoryRow(row) : undefined;
}

/**
 * O(1) перепланирование одной компании по первичному ключу без повторного
 * чтения всего `company_directory` и без рестарта процесса.
 */
export function resolveCompanyChannel(
  database: DatabaseSync,
  registry: readonly RegisteredVacancySource[],
  companyKey: string,
  nowMs: number = Date.now(),
): ResolvedCompanyChannel {
  const companySiteSourceId = `${COMPANY_SITE_SOURCE_PREFIX}${companyKey}`;
  const company = resolveCompanyRecord(database, companyKey);
  if (!company) return { companySiteSourceId, retiredSourceIds: [companySiteSourceId] };

  const byId = new Map(registry.map((source) => [source.id, source]));
  const byDomain = indexCareerSites(registry);
  const atsCandidate = companyAtsSource(company, byId);
  const registrySiteCandidate = findCareerSite(company, byDomain);
  const candidateIds = [
    companySiteSourceId,
    ...(registrySiteCandidate ? [registrySiteCandidate.id] : []),
    ...(atsCandidate ? [atsCandidate.id] : []),
  ];
  const { placementHealthBySourceId, sitePlacementHealthByCompany } = loadCompanyPlacementHealth(
    database,
    companyKey,
  );
  const primary = primaryFor(company, byDomain, byId, {
    sourceStates: loadCandidateStates(database, candidateIds),
    placementHealthBySourceId,
    sitePlacementHealthByCompany,
    nowMs,
  });

  const retiredSourceIds: string[] = [];
  if (primary?.source.id !== companySiteSourceId) retiredSourceIds.push(companySiteSourceId);
  if (atsCandidate && primary?.source.id !== atsCandidate.id) retiredSourceIds.push(atsCandidate.id);
  if (!primary) return { companySiteSourceId, retiredSourceIds };
  return {
    primary: {
      companyKey: company.companyKey,
      companyName: company.companyName,
      kind: primary.kind,
      sourceId: primary.source.id,
      source: { ...primary.source, channelTier: 1, companyKey: company.companyKey },
    },
    companySiteSourceId,
    retiredSourceIds,
  };
}

/**
 * Только чтение: активные компании справочника, у которых есть что опрашивать
 * (B644: 140 тыс. имён из каталога freehire без досок не читаются при старте).
 * Без таблицы — пустой список.
 */
export function readDirectoryCompanies(database: DatabaseSync): readonly DirectoryCompany[] {
  if (!tableExists(database, 'company_directory')) return [];
  const rows = database
    .prepare(
      `SELECT company_key, company_name, website_url, careers_url, linkedin_org_id,
              ats_provider, ats_slug
         FROM company_directory WHERE status = 'active'
          AND (ats_provider IS NOT NULL OR careers_url IS NOT NULL OR website_url IS NOT NULL OR linkedin_org_id IS NOT NULL)
        ORDER BY company_key`,
    )
    .all() as unknown as DirectoryRow[];
  return rows.map(mapDirectoryRow);
}

/**
 * Читает активные компании справочника порциями по курсору `company_key`, уступая цикл
 * событий между страницами (`setImmediate`), чтобы фоновое обновление каналов в `maintenance`
 * не блокировало обработку сигналов и шагов пула.
 */
export async function readDirectoryCompaniesAsync(
  database: DatabaseSync,
  pageSize = 2_000,
  shouldStop: () => boolean = () => false,
): Promise<readonly DirectoryCompany[]> {
  if (!tableExists(database, 'company_directory')) return [];
  const statement = database.prepare(
    `SELECT company_key, company_name, website_url, careers_url, linkedin_org_id,
            ats_provider, ats_slug
       FROM company_directory
      WHERE company_key > ? AND status = 'active'
        AND (ats_provider IS NOT NULL OR careers_url IS NOT NULL OR website_url IS NOT NULL OR linkedin_org_id IS NOT NULL)
      ORDER BY company_key
      LIMIT ?`,
  );
  const out: DirectoryCompany[] = [];
  let afterKey = '';
  const limit = Math.max(1, pageSize);
  while (!shouldStop()) {
    const page = statement.all(afterKey, limit) as unknown as DirectoryRow[];
    for (const row of page) out.push(mapDirectoryRow(row));
    if (page.length < limit) break;
    afterKey = page.at(-1)!.company_key;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return out;
}
