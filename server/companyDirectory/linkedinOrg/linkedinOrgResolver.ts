/**
 * B621: поиск LinkedIn organization ID для одной строки реестра через
 * гостевой доступ, с проверкой принадлежности по официальному домену.
 *
 * Порядок: сайт (и карьерный портал) компании → ссылки на
 * `linkedin.com/company/<slug>` → гостевой поиск вакансий → карточка
 * `/jobs/view/<id>` с `companyId` и тем же slug. Совпадение одного названия
 * никогда не даёт ID. Пул служебных аккаунтов не используется.
 */
import {
  companySlugsInHtml,
  detectBlock,
  parseJobViewCompany,
  parseSearchCards,
  slugFromLinkedinUrl,
  type BlockKind,
} from './linkedinGuestPages';
import type { QueueRow, ResolutionOutcome } from './linkedinOrgStore';

export interface PageResponse {
  readonly status: number;
  readonly body: string;
  readonly finalUrl: string;
}

export type PageKind = 'linkedin' | 'site';
export type FetchPage = (url: string, kind: PageKind) => Promise<PageResponse>;

export class LinkedinThrottled extends Error {
  constructor(
    readonly kind: BlockKind,
    readonly url: string,
  ) {
    super(`linkedin-${kind}`);
    this.name = 'LinkedinThrottled';
  }
}

const MAX_SLUGS = 3;
const DAY_MS = 86_400_000;
export const SITE_RETRY_DAYS = 3;
export const NO_JOBS_RETRY_DAYS = 7;

const SEARCH_URL = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';

/**
 * Общие хосты ATS, досок и соцсетей: их страницы ссылаются на LinkedIn самой
 * площадки (jobs.lever.co → Lever), поэтому домен компании не подтверждают.
 */
const SHARED_HOSTS =
  /(^|\.)(linkedin\.com|lever\.co|greenhouse\.io|greenhouse\.com|lever\.com|workable\.com|smartrecruiters\.com|ashbyhq\.com|ashby\.com|recruitee\.com|bamboohr\.com|comeet\.com|comeet\.co|teamtailor\.com|personio\.(de|com)|breezy\.hr|myworkdayjobs\.com|workday\.com|icims\.com|jobvite\.com|pinpointhq\.com|dou\.ua|hh\.ru|hh\.kz|djinni\.co|wellfound\.com|builtin\.com|glassdoor\.com|indeed\.com|careers-page\.com|notion\.site|google\.com|facebook\.com|t\.me|vk\.com)$/i;

const MULTI_PART_SUFFIX = /^(co|com|org|net|ac|gov)\.[a-z]{2}$/i;

/** Регистрируемый домен: `careers.ciklum.com` → `ciklum.com`, `x.co.uk` → `x.co.uk`. */
export function registrableDomain(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  const labels = host.split('.');
  if (labels.length < 2) return null;
  const tail = labels.slice(-2).join('.');
  return MULTI_PART_SUFFIX.test(tail) && labels.length >= 3 ? labels.slice(-3).join('.') : tail;
}

function isOfficialHost(url: string): boolean {
  try {
    return /^https?:$/i.test(new URL(url).protocol) && !SHARED_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Адреса, которые подтверждают домен: сайт компании, если он не общий хост,
 * и карьерный раздел — только на том же регистрируемом домене.
 */
export function siteUrls(row: QueueRow): readonly string[] {
  const site = row.websiteUrl && isOfficialHost(row.websiteUrl) ? row.websiteUrl : null;
  if (!site) return [];
  const domain = registrableDomain(site);
  const careers =
    row.careersUrl && isOfficialHost(row.careersUrl) && registrableDomain(row.careersUrl) === domain
      ? row.careersUrl
      : null;
  return careers && careers !== site ? [site, careers] : [site];
}

interface SiteEvidence {
  readonly slugs: readonly string[];
  readonly evidenceUrl?: string;
  readonly reachable: boolean;
}

async function readSiteSlugs(row: QueueRow, fetchPage: FetchPage): Promise<SiteEvidence> {
  let reachable = false;
  for (const url of siteUrls(row)) {
    try {
      const page = await fetchPage(url, 'site');
      if (page.status >= 400) continue;
      reachable = true;
      const slugs = companySlugsInHtml(page.body);
      if (slugs.length > 0) return { slugs, evidenceUrl: page.finalUrl || url, reachable };
    } catch {
      // Сайт недоступен: пробуем следующий официальный адрес.
    }
  }
  return { slugs: [], reachable };
}

async function linkedinGet(url: string, fetchPage: FetchPage): Promise<PageResponse> {
  const page = await fetchPage(url, 'linkedin');
  const block = detectBlock(page.status, page.body);
  if (block) throw new LinkedinThrottled(block, url);
  return page;
}

function searchUrl(keywords: string): string {
  const params = new URLSearchParams({ keywords, location: 'Worldwide', start: '0' });
  return `${SEARCH_URL}?${params.toString()}`;
}

/** ID работодателя по подтверждённому slug: вакансия, где LinkedIn связал их сам. */
async function orgIdForSlug(
  slug: string,
  row: QueueRow,
  fetchPage: FetchPage,
): Promise<string | null> {
  const name = row.companyName.replace(/\s*[([].*$/, '').trim() || row.companyName;
  const queries = [...new Set([name, slug.replace(/[-_]+/g, ' ')])];
  for (const keywords of queries) {
    const search = await linkedinGet(searchUrl(keywords), fetchPage);
    if (search.status >= 400) continue;
    const card = parseSearchCards(search.body).find((c) => c.companySlug === slug);
    if (!card) continue;
    const view = await linkedinGet(`https://www.linkedin.com/jobs/view/${card.jobId}`, fetchPage);
    const company = view.status < 400 ? parseJobViewCompany(view.body) : null;
    if (company && company.companySlug === slug) return company.companyId;
  }
  return null;
}

function later(now: Date, days: number): string {
  return new Date(now.getTime() + days * DAY_MS).toISOString();
}

function orderSlugs(slugs: readonly string[], registrySlug: string | null): readonly string[] {
  const ordered =
    registrySlug && slugs.includes(registrySlug)
      ? [registrySlug, ...slugs.filter((s) => s !== registrySlug)]
      : slugs;
  return ordered.slice(0, MAX_SLUGS);
}

/**
 * Итог по одной строке. LinkedInThrottled пробрасывается наверх: вызывающий
 * ставит общую паузу, строка остаётся в очереди и будет повторена.
 */
export async function resolveCompany(
  row: QueueRow,
  fetchPage: FetchPage,
  now: Date,
): Promise<ResolutionOutcome> {
  const registrySlug = slugFromLinkedinUrl(row.linkedinUrl);
  const site = await readSiteSlugs(row, fetchPage);
  if (site.slugs.length === 0) return noSiteLinkOutcome(row, site, registrySlug, now);
  const found = new Map<string, string>();
  for (const slug of orderSlugs(site.slugs, registrySlug)) {
    const orgId = /^\d+$/.test(slug) ? slug : await orgIdForSlug(slug, row, fetchPage);
    if (orgId) found.set(slug, orgId);
  }
  return foundOutcome(found, site, registrySlug, now);
}

function noSiteLinkOutcome(
  row: QueueRow,
  site: SiteEvidence,
  registrySlug: string | null,
  now: Date,
): ResolutionOutcome {
  {
    if (!site.reachable && siteUrls(row).length > 0) {
      return {
        status: 'retry_after',
        reason: 'site_unreachable',
        retryAt: later(now, SITE_RETRY_DAYS),
      };
    }
    if (registrySlug) {
      return { status: 'ambiguous', reason: 'registry_url_not_on_site', slug: registrySlug };
    }
    return {
      status: 'no_page',
      reason: siteUrls(row).length > 0 ? 'no_linkedin_link_on_site' : 'no_official_site',
    };
  }
}

function foundOutcome(
  found: ReadonlyMap<string, string>,
  site: SiteEvidence,
  registrySlug: string | null,
  now: Date,
): ResolutionOutcome {
  const ids = new Set(found.values());
  const evidence = site.evidenceUrl ? { evidenceUrl: site.evidenceUrl } : {};
  if (ids.size === 0) {
    return {
      status: 'ambiguous',
      reason: 'no_open_jobs',
      slug: site.slugs[0]!,
      retryAt: later(now, NO_JOBS_RETRY_DAYS),
      ...evidence,
    };
  }
  if (ids.size > 1) {
    return {
      status: 'ambiguous',
      reason: 'several_pages_on_site',
      slug: [...found.keys()].join(','),
      ...evidence,
    };
  }
  const [slug, orgId] = [...found.entries()][0]!;
  // Ссылка с официального сайта сильнее сохранённой в реестре: неверный
  // slug реестра заменяется подтверждённым (старое значение — в причине).
  const corrected = !!registrySlug && registrySlug !== slug && !/^\d+$/.test(slug);
  return {
    status: 'resolved',
    reason: corrected ? `registry_url_corrected:${registrySlug}` : 'site_link_and_job_view',
    slug,
    orgId,
    replaceUrl: corrected,
    ...evidence,
  };
}
