import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { htmlToFeedText } from '../connectors/feedText';
import { ObscuraRunner } from '../crawler/obscuraRunner';
import {
  asArray,
  buildJsonVacancy as build,
  fromEpochMilliseconds,
  fromIso,
  fromLooseDate,
  isUsableVacancy as isUsable,
  listOf,
  numeric,
  record,
  stringList,
  text,
  type JsonAdapterContext,
  type JsonRecord,
  UNKNOWN_PUBLISHED_AT,
  UNREADABLE,
} from './jsonVacancyRecord';

export const NAUKRI_SOURCE_ID = 'src-naukri';
export const BDJOBS_SOURCE_ID = 'src-bdjobs';
export const ZIPRECRUITER_SOURCE_ID = 'src-ziprecruiter';
export const GLASSDOOR_SOURCE_ID = 'src-glassdoor';
export const BAYT_SOURCE_ID = 'src-bayt';

interface ParsedSalary {
  readonly from?: number;
  readonly to?: number;
  readonly currency: string;
}

function parseNaukriSalary(label: string): ParsedSalary | undefined {
  const match = /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(lacs?|lakhs?|cr(?:ores?)?)/i.exec(label);
  if (!match) return undefined;
  const rawMin = parseFloat(match[1]!);
  const rawMax = parseFloat(match[2]!);
  const unit = match[3]!.toLowerCase();
  const multiplier = unit.startsWith('cr') ? 10_000_000 : 100_000;
  return {
    from: Math.round(rawMin * multiplier),
    to: Math.round(rawMax * multiplier),
    currency: 'INR',
  };
}

function extractNaukriPlaceholders(placeholders: unknown[]): {
  location?: string;
  salary?: ParsedSalary;
} {
  let location: string | undefined;
  let salary: ParsedSalary | undefined;
  for (const item of placeholders) {
    const p = record(item);
    const pType = text(p.type);
    const pLabel = text(p.label);
    if (pType === 'location' && !location) {
      location = pLabel || undefined;
    } else if (pType === 'salary' && !salary) {
      salary = parseNaukriSalary(pLabel);
    }
  }
  return { location, salary };
}

function parseNaukriJob(item: unknown, context: JsonAdapterContext, sourceId: string): UnifiedVacancy {
  const job = record(item);
  const externalId = text(job.jobId);
  const title = text(job.title);
  const company = text(job.companyName);
  const jdURL = text(job.jdURL);
  const url = jdURL
    ? jdURL.startsWith('http')
      ? jdURL
      : `https://www.naukri.com${jdURL}`
    : externalId
      ? `https://www.naukri.com/job/${externalId}`
      : '';
  const placeholders = asArray(job.placeholders) ?? [];
  const { location, salary } = extractNaukriPlaceholders(placeholders);
  const tagsStr = text(job.tagsAndSkills);
  const skills = tagsStr
    ? tagsStr.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    : stringList(job.tags);
  const isRemote = /remote/i.test(location ?? '') || /remote/i.test(title);
  const publishedAt = fromEpochMilliseconds(numeric(job.createdDate));

  return build({
    sourceId,
    context,
    externalId,
    title,
    company,
    location,
    isRemote,
    description: text(job.jobDescription) || title,
    skills,
    salary,
    url,
    publishedAt,
  });
}

/** Pure parser for Naukri API responses (JobSpy mechanics). */
export function normalizeNaukriJobs(
  payload: unknown,
  context: JsonAdapterContext,
  sourceId: string,
): UnifiedVacancy[] {
  return listOf(payload, (value) => asArray(record(value).jobDetails))
    .map((item) => parseNaukriJob(item, context, sourceId))
    .filter(isUsable);
}

function parseBdjobsSalary(job: JsonRecord): ParsedSalary | undefined {
  const from = numeric(job.JobSalaryMinSalary) ?? numeric(job.salary_min);
  const to = numeric(job.JobSalaryMaxSalary) ?? numeric(job.salary_max);
  if (from === undefined && to === undefined) return undefined;
  return { from, to, currency: 'BDT' };
}

function parseBdjobsDate(job: JsonRecord): string {
  const raw = text(job.PostedOn) || text(job.posted_on) || text(job.created_at);
  if (!raw) return UNKNOWN_PUBLISHED_AT;
  const iso = fromIso(raw);
  return iso !== UNKNOWN_PUBLISHED_AT ? iso : fromLooseDate(raw);
}

function parseBdjobsJob(item: unknown, context: JsonAdapterContext, sourceId: string): UnifiedVacancy {
  const job = record(item);
  const externalId = text(job.JobId) || text(job.job_id) || text(job.jobid) || text(job.id);
  const title = text(job.JobTitle) || text(job.job_title) || text(job.jobtitle) || text(job.title);
  const company =
    text(job.CompnayName) ||
    text(job.CompanyName) ||
    text(job.company_name) ||
    text(job.companyname) ||
    text(job.company);
  const location = text(job.JobLocation) || text(job.job_location) || text(job.location) || undefined;
  const url =
    text(job.url) ||
    text(job.job_url) ||
    (externalId ? `https://jobs.bdjobs.com/jobdetails.asp?id=${externalId}` : '');
  const workplace = text(job.JobWorkPlace) || text(job.job_workplace);
  const isRemote =
    /remote|home/i.test(workplace) ||
    /remote/i.test(title) ||
    /remote/i.test(location ?? '');
  const skillsRaw = text(job.SkillsRequired) || text(job.skills_required);
  const skills = skillsRaw
    ? skillsRaw.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    : stringList(job.skills);

  return build({
    sourceId,
    context,
    externalId,
    title,
    company,
    location,
    isRemote,
    description: text(job.JobDescription) || text(job.job_description) || title,
    skills,
    employmentType: text(job.JobNature) || text(job.job_nature) || undefined,
    salary: parseBdjobsSalary(job),
    url,
    publishedAt: parseBdjobsDate(job),
  });
}

/** Pure parser for BDJobs gateway responses (JobSpy mechanics). */
export function normalizeBdjobsJobs(
  payload: unknown,
  context: JsonAdapterContext,
  sourceId: string,
): UnifiedVacancy[] {
  return listOf(payload, (value) => asArray(record(value).data) ?? asArray(value))
    .map((item) => parseBdjobsJob(item, context, sourceId))
    .filter(isUsable);
}

function parseZipRecruiterSalary(job: JsonRecord): ParsedSalary | undefined {
  const from = numeric(job.compensation_min) ?? numeric(job.salary_min);
  const to = numeric(job.compensation_max) ?? numeric(job.salary_max);
  if (from === undefined && to === undefined) return undefined;
  return {
    from,
    to,
    currency: text(job.compensation_currency) || text(job.salary_currency) || 'USD',
  };
}

function parseZipRecruiterJob(
  item: unknown,
  context: JsonAdapterContext,
  sourceId: string,
): UnifiedVacancy {
  const job = record(item);
  const externalId = text(job.listing_key) || text(job.id);
  const title = text(job.name) || text(job.title);
  const company =
    text(record(job.hiring_company).name) ||
    text(job.company_name) ||
    text(job.company);
  const city = text(job.job_city);
  const state = text(job.job_state);
  const country = text(job.job_country);
  const location = [city, state, country].filter(Boolean).join(', ') || undefined;
  const url =
    text(job.url) ||
    (externalId ? `https://www.ziprecruiter.com/jobs//j?lvk=${externalId}` : '');
  const description = text(job.job_description) || title;
  const isRemote =
    /remote/i.test(location ?? '') ||
    /remote/i.test(title) ||
    /remote/i.test(description);

  return build({
    sourceId,
    context,
    externalId,
    title,
    company,
    location,
    isRemote,
    description,
    skills: [],
    employmentType: text(job.employment_type) || undefined,
    salary: parseZipRecruiterSalary(job),
    url,
    publishedAt: fromIso(job.posted_time),
  });
}

/** Pure parser for ZipRecruiter mobile iOS API responses (JobSpy mechanics). */
export function normalizeZipRecruiterJobs(
  payload: unknown,
  context: JsonAdapterContext,
  sourceId: string,
): UnifiedVacancy[] {
  return listOf(payload, (value) => asArray(record(value).jobs))
    .map((item) => parseZipRecruiterJob(item, context, sourceId))
    .filter(isUsable);
}

function extractGlassdoorListings(payload: unknown): unknown[] | null {
  const root = record(payload);
  const data = record(root.data);
  return (
    asArray(data.jobListings) ??
    asArray(record(data.jobSearchResults).jobListings) ??
    asArray(record(data.jobSearch).jobListings) ??
    asArray(root.jobListings)
  );
}

function parseGlassdoorSalary(header: JsonRecord): ParsedSalary | undefined {
  const sal = record(header.salary);
  const from = numeric(sal.min);
  const to = numeric(sal.max);
  if (from === undefined && to === undefined) return undefined;
  return {
    from,
    to,
    currency: text(sal.currency) || 'USD',
  };
}

interface GlassdoorMeta {
  readonly externalId: string;
  readonly title: string;
  readonly company: string;
  readonly location?: string;
  readonly url: string;
  readonly description: string;
  readonly isRemote: boolean;
  readonly publishedAt: string;
  readonly header: JsonRecord;
}

function extractGlassdoorCompany(
  header: JsonRecord,
  overview: JsonRecord,
  job: JsonRecord,
): string {
  return (
    text(header.employerNameFromSearch) ||
    text(overview.name) ||
    text(overview.shortName) ||
    text(header.employer) ||
    text(job.companyName)
  );
}

function formatGlassdoorUrl(rawUrl: string, externalId: string): string {
  if (rawUrl) {
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) return rawUrl;
    return `https://www.glassdoor.com${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
  }
  return externalId ? `https://www.glassdoor.com/job-listing/job-details.htm?jl=${externalId}` : '';
}

function extractGlassdoorMeta(item: unknown): GlassdoorMeta {
  const envelope = record(item);
  const jobview = record(envelope.jobview || envelope.jobView || envelope);
  const header = record(jobview.header);
  const job = record(jobview.job);
  const overview = record(jobview.overview);

  const externalId =
    text(job.listingId) ||
    text(header.jobListingId) ||
    text(jobview.listingId) ||
    text(envelope.listingId) ||
    text(job.id);
  const title =
    text(header.jobTitleText) || text(header.title) || text(job.title) || text(jobview.title);
  const company = extractGlassdoorCompany(header, overview, job);
  const location =
    text(header.locationName) || text(header.location) || text(job.location) || undefined;
  const rawUrl = text(job.jobViewUrl) || text(header.seoUrl);
  const url = formatGlassdoorUrl(rawUrl, externalId);
  const description = text(job.description) || text(jobview.description) || title;
  const isRemote =
    /remote/i.test(location ?? '') ||
    /remote/i.test(title) ||
    /remote/i.test(description) ||
    header.isRemote === true;
  const rawDate = text(job.datePosted) || text(job.postedDate) || text(header.datePosted);

  return {
    externalId,
    title,
    company,
    location,
    url,
    description,
    isRemote,
    publishedAt: rawDate ? fromIso(rawDate) : UNKNOWN_PUBLISHED_AT,
    header,
  };
}

function parseGlassdoorJob(
  item: unknown,
  context: JsonAdapterContext,
  sourceId: string,
): UnifiedVacancy {
  const meta = extractGlassdoorMeta(item);
  return build({
    sourceId,
    context,
    externalId: meta.externalId,
    title: meta.title,
    company: meta.company,
    location: meta.location,
    isRemote: meta.isRemote,
    description: meta.description,
    skills: [],
    salary: parseGlassdoorSalary(meta.header),
    url: meta.url,
    publishedAt: meta.publishedAt,
  });
}

/** Pure parser for Glassdoor GraphQL JobSearchResultsQuery responses. */
export function normalizeGlassdoorJobs(
  payload: unknown,
  context: JsonAdapterContext,
  sourceId: string = GLASSDOOR_SOURCE_ID,
): UnifiedVacancy[] {
  return listOf(payload, extractGlassdoorListings)
    .map((item) => parseGlassdoorJob(item, context, sourceId))
    .filter(isUsable);
}

function parseBaytSalary(raw: string): ParsedSalary | undefined {
  const cleaned = htmlToFeedText(raw).replace(/,/g, '');
  const match = /([A-Za-z$]{1,4})\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/i.exec(cleaned);
  if (!match) return undefined;
  const rawCurrency = match[1]!.trim();
  return {
    from: Math.round(parseFloat(match[2]!)),
    to: Math.round(parseFloat(match[3]!)),
    currency: rawCurrency === '$' ? 'USD' : rawCurrency.toUpperCase(),
  };
}

function parseBaytDate(raw: string, observedAt: string): string {
  const textVal = raw.trim().toLowerCase();
  const observed = Date.parse(observedAt);
  if (!textVal || Number.isNaN(observed)) return UNKNOWN_PUBLISHED_AT;
  if (textVal.includes('today')) return new Date(observed).toISOString();
  if (textVal.includes('yesterday')) return new Date(observed - 24 * 60 * 60 * 1000).toISOString();
  const days = /(\d+)\+?\s*days?/.exec(textVal);
  if (days) {
    return new Date(observed - Number(days[1]) * 24 * 60 * 60 * 1000).toISOString();
  }
  const iso = fromIso(textVal);
  return iso !== UNKNOWN_PUBLISHED_AT ? iso : fromLooseDate(textVal);
}

function extractBaytCards(html: string): string[] {
  const cardRegex = /<li\b[^>]*\bdata-js-job[^>]*>[\s\S]*?<\/li>/gi;
  const matches = html.match(cardRegex);
  if (matches && matches.length > 0) return matches;
  const parts = html.split(/<li\b/i).slice(1);
  return parts
    .filter((p) => /data-js-job/i.test(p))
    .map((p) => `<li ${p.split('</li>')[0]}</li>`);
}

function extractBaytLinkAndTitle(
  card: string,
  externalId: string,
): { url: string; title: string } {
  const titleMatch = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(card);
  const titleHtml = titleMatch ? titleMatch[1]! : card;
  const linkMatch =
    /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(titleHtml) ??
    /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(card);

  const rawUrl = linkMatch ? linkMatch[1]! : '';
  const url = rawUrl
    ? rawUrl.startsWith('http')
      ? rawUrl
      : `https://www.bayt.com${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`
    : externalId
      ? `https://www.bayt.com/en/international/jobs/${externalId}/`
      : '';

  const rawTitle = linkMatch ? linkMatch[2]! : titleMatch ? titleMatch[1]! : '';
  const title = htmlToFeedText(rawTitle);
  return { url, title };
}

function extractBaytSnippets(card: string): {
  company: string;
  location?: string;
  descSnippet: string;
  dateText: string;
  salarySnippet?: string;
} {
  const companyMatch =
    /<(?:b|span|div|a)\b[^>]*\bclass=["'][^"']*\bjb-company[^"']*["'][^>]*>([\s\S]*?)<\/(?:b|span|div|a)>/i.exec(
      card,
    ) ?? /<b\b[^>]*>([\s\S]*?)<\/b>/i.exec(card);
  const locMatch =
    /<(?:span|div)\b[^>]*\bclass=["'][^"']*\bjb-loc[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|div)>/i.exec(
      card,
    );
  const descMatch =
    /<p\b[^>]*\bclass=["'][^"']*\bjb-desc[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(card) ??
    /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(card);
  const dateMatch =
    /<(?:span|div)\b[^>]*\bclass=["'][^"']*\bjb-date[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|div)>/i.exec(
      card,
    );
  const salMatch =
    /<(?:span|div)\b[^>]*\bclass=["'][^"']*\bjb-salary[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|div)>/i.exec(
      card,
    );

  return {
    company: companyMatch ? htmlToFeedText(companyMatch[1]!) : '',
    location: locMatch ? htmlToFeedText(locMatch[1]!) : undefined,
    descSnippet: descMatch ? htmlToFeedText(descMatch[1]!) : '',
    dateText: dateMatch ? htmlToFeedText(dateMatch[1]!) : '',
    salarySnippet: salMatch ? salMatch[1]! : undefined,
  };
}

function extractBaytJob(
  card: string,
  context: JsonAdapterContext,
  sourceId: string,
): UnifiedVacancy {
  const idMatch =
    /data-js-job=["']?(\w+)["']?/i.exec(card) || /data-job-id=["']?(\w+)["']?/i.exec(card);
  const externalId = idMatch ? idMatch[1]! : '';
  const { url, title } = extractBaytLinkAndTitle(card, externalId);
  const snippets = extractBaytSnippets(card);
  const description = snippets.descSnippet || title;
  const isRemote =
    /remote/i.test(snippets.location ?? '') ||
    /remote/i.test(title) ||
    /remote/i.test(description);

  return build({
    sourceId,
    context,
    externalId,
    title,
    company: snippets.company,
    location: snippets.location,
    isRemote,
    description,
    skills: [],
    salary: snippets.salarySnippet ? parseBaytSalary(snippets.salarySnippet) : undefined,
    url,
    publishedAt: parseBaytDate(snippets.dateText, context.observedAt),
  });
}

function isRecognizedBaytHtml(html: string): boolean {
  return (
    /bayt\.com/i.test(html) ||
    /data-js-job/i.test(html) ||
    /search[_-]results/i.test(html) ||
    /class=["'][^"']*jb-/i.test(html) ||
    /<title>[^<]*bayt/i.test(html) ||
    /id=["']search_results/i.test(html)
  );
}

/** Pure parser for Bayt HTML job listings scraper. */
export function normalizeBaytHtml(
  html: string,
  context: JsonAdapterContext,
  sourceId: string = BAYT_SOURCE_ID,
): UnifiedVacancy[] {
  if (typeof html !== 'string' || !html.trim()) {
    throw new Error(UNREADABLE);
  }
  const cards = extractBaytCards(html);
  if (cards.length === 0) {
    if (isRecognizedBaytHtml(html)) {
      return [];
    }
    throw new Error(UNREADABLE);
  }
  return cards.map((card) => extractBaytJob(card, context, sourceId)).filter(isUsable);
}

/** Detects Cloudflare 403 or anti-bot challenge signatures. */
export function isCloudflareChallenge(status: number, body?: string): boolean {
  if (status === 403) return true;
  if (status === 503 && body && /cf-chl|cloudflare|just a moment/i.test(body)) {
    return true;
  }
  if (body && /challenge-platform|cf-turnstile|cf-chl|just a moment\.\.\./i.test(body)) {
    return true;
  }
  return false;
}

export interface StealthFetchResult {
  readonly status: number;
  readonly body: string;
  readonly usedStealth: boolean;
  readonly headers?: Record<string, string>;
}

export interface StealthFetchDeps {
  readonly httpFetch?: (
    url: string,
    init?: RequestInit,
  ) => Promise<{ status: number; text: () => Promise<string>; headers?: unknown }>;
  readonly stealthFetch?: (
    url: string,
    options?: { headers?: Record<string, string>; method?: string; body?: unknown },
  ) => Promise<{ status: number; content: string }>;
}

export interface StealthFetchOptions {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
}

function buildDirectRequestInit(options: StealthFetchOptions): RequestInit {
  return {
    method: options.method ?? 'GET',
    headers: options.headers,
    ...(options.body
      ? {
          body: typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
        }
      : {}),
  };
}

async function executeHeadlessObscuraFetch(
  url: string,
  options: StealthFetchOptions = {},
): Promise<StealthFetchResult> {
  const runner = new ObscuraRunner();
  const userAgent = options.headers?.['User-Agent'] ?? options.headers?.['user-agent'];
  const isPost = options.method === 'POST' || options.body !== undefined;

  if (isPost) {
    const body = await runner.fetchOriginal(url, { userAgent });
    return { status: 200, body, usedStealth: true };
  }

  const body = await runner.fetchHtml(url, { userAgent });
  return { status: 200, body, usedStealth: true };
}

/**
 * Two-phase fetch strategy: tries direct HTTP first; when blocked by Cloudflare 403 challenge,
 * falls back to Obscura stealth runner.
 */
export async function fetchWithStealthFallback(
  url: string,
  options: StealthFetchOptions = {},
  deps: StealthFetchDeps = {},
): Promise<StealthFetchResult> {
  const httpFetch =
    deps.httpFetch ??
    (async (u, init) => {
      const res = await fetch(u, init);
      return {
        status: res.status,
        text: () => res.text(),
      };
    });

  const directRes = await httpFetch(url, buildDirectRequestInit(options));
  const directBody = await directRes.text();

  if (!isCloudflareChallenge(directRes.status, directBody)) {
    return {
      status: directRes.status,
      body: directBody,
      usedStealth: false,
    };
  }

  if (deps.stealthFetch) {
    const stealthRes = await deps.stealthFetch(url, options);
    return {
      status: stealthRes.status,
      body: stealthRes.content,
      usedStealth: true,
    };
  }

  return executeHeadlessObscuraFetch(url, options);
}

export function glassdoorAdapter(
  payload: unknown,
  context: JsonAdapterContext,
  sourceId = GLASSDOOR_SOURCE_ID,
): UnifiedVacancy[] {
  return normalizeGlassdoorJobs(payload, context, sourceId);
}

export function baytAdapter(
  payload: unknown,
  context: JsonAdapterContext,
  sourceId = BAYT_SOURCE_ID,
): UnifiedVacancy[] {
  const html =
    typeof payload === 'string'
      ? payload
      : text(record(payload).html) || text(record(payload).content) || '';
  return normalizeBaytHtml(html, context, sourceId);
}

