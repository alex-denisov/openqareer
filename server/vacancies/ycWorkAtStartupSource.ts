import { htmlToFeedText } from '../connectors/feedText';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import { UNKNOWN_PUBLISHED_AT } from './jsonVacancyRecord';
import type { SourceReading } from './multiSourceVacancyEngine';

export const YC_WORK_AT_STARTUP_SOURCE_ID = 'src-yc-work-at-startup';

/**
 * The public YC page exposes a bounded set of role pages. Reading these pages
 * keeps the source useful beyond the default engineering tab without
 * inventing a private API or following the application flow.
 */
export const YC_JOB_PATHS = [
  'jobs',
  'jobs/role/product-manager',
  'jobs/role/recruiting-hr',
  'jobs/role/sales-manager',
  'jobs/role/operations',
] as const;

const YC_ORIGIN = 'https://www.ycombinator.com';
const YC_HOST = 'www.ycombinator.com';
const YC_SOURCE_TIMEOUT_MS = 20_000;

interface YcJobPosting {
  id?: string | number;
  title?: string;
  url?: string;
  location?: string;
  type?: string;
  roleSpecificType?: string;
  prettyRole?: string;
  minExperience?: string;
  skills?: unknown;
  companyName?: string;
  companyOneLiner?: string;
  createdAt?: string;
  salaryRange?: string;
}

interface YcPagePayload {
  props?: {
    jobPostings?: unknown;
  };
}

export type YcPageFetcher = (url: string, init?: RequestInit) => Promise<Response>;

function decodeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function extractPagePayloads(html: string): YcPagePayload[] {
  const marker = 'data-page="';
  const payloads: YcPagePayload[] = [];
  let cursor = 0;

  while (true) {
    const start = html.indexOf(marker, cursor);
    if (start < 0) break;
    const valueStart = start + marker.length;
    const valueEnd = html.indexOf('"', valueStart);
    if (valueEnd < 0) break;
    const decoded = decodeHtmlAttribute(html.slice(valueStart, valueEnd));
    try {
      const parsed = JSON.parse(decoded) as YcPagePayload;
      if (Array.isArray(parsed.props?.jobPostings)) payloads.push(parsed);
    } catch {
      // Other page components may use data-page for a different payload. Keep
      // looking for the public Work at a Startup component.
    }
    cursor = valueEnd + 1;
  }

  return payloads;
}

function relativeDate(value: string | undefined, observedAt: string): string {
  const raw = value?.trim().toLowerCase() ?? '';
  if (!raw) return UNKNOWN_PUBLISHED_AT;
  if (/^(today|just now|now)$/.test(raw)) return observedAt;
  if (raw === 'yesterday') {
    return new Date(Date.parse(observedAt) - 24 * 60 * 60 * 1000).toISOString();
  }

  const match = raw.match(/(\d+)\s*(day|days|week|weeks|month|months|year|years)/);
  if (!match) return UNKNOWN_PUBLISHED_AT;
  const amount = Number(match[1]);
  const unit = match[2];
  const days = unit.startsWith('week')
    ? amount * 7
    : unit.startsWith('month')
      ? amount * 30
      : unit.startsWith('year')
        ? amount * 365
        : amount;
  return new Date(Date.parse(observedAt) - days * 24 * 60 * 60 * 1000).toISOString();
}

function listOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function absoluteJobUrl(value: string | undefined): string {
  if (!value) return '';
  try {
    const url = new URL(value, YC_ORIGIN);
    return url.protocol === 'https:' && url.hostname === YC_HOST ? url.toString() : '';
  } catch {
    return '';
  }
}

function isUsableYcJob(job: YcJobPosting, title: string, company: string, url: string): boolean {
  return (
    title.length > 0 &&
    company.length > 0 &&
    url.length > 0 &&
    (typeof job.id === 'string' || typeof job.id === 'number') &&
    String(job.id).trim().length > 0
  );
}

function ycJobDetails(job: YcJobPosting): string {
  return [
    job.companyOneLiner,
    job.prettyRole,
    job.roleSpecificType,
    job.minExperience,
    job.salaryRange,
  ]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(' · ');
}

function buildVacancy(
  job: YcJobPosting,
  source: VacancySourceConfig,
  sourceUrl: string,
  observedAt: string,
): UnifiedVacancy | undefined {
  const title = htmlToFeedText(job.title ?? '').trim();
  const company = htmlToFeedText(job.companyName ?? '').trim();
  const url = absoluteJobUrl(job.url);
  if (!isUsableYcJob(job, title, company, url)) return undefined;

  const skills = listOfStrings(job.skills);
  const details = ycJobDetails(job);
  const id = `${source.id}:${String(job.id)}`;

  return {
    id,
    fingerprint: id,
    title,
    company,
    location: job.location?.trim() || undefined,
    isRemote: /\bremote\b/i.test(job.location ?? ''),
    description: htmlToFeedText(details || title),
    requiredSkills: skills,
    employmentType: job.type?.trim() || undefined,
    experienceLevel: job.minExperience?.trim() || undefined,
    url,
    provenance: {
      sourceType: 'career_site',
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl,
      externalId: String(job.id),
      observedAt,
    },
    publishedAt: relativeDate(job.createdAt, observedAt),
    status: 'active',
  };
}

/** Parse the escaped `data-page` payload rendered by the public YC jobs page. */
export function parseYcWorkAtStartupPage(
  html: string,
  source: VacancySourceConfig,
  sourceUrl: string,
  observedAt: string,
): UnifiedVacancy[] {
  if (!html.trim()) throw new Error('vacancy_source_payload_unreadable');
  const payloads = extractPagePayloads(html);
  if (payloads.length === 0) throw new Error('vacancy_source_payload_unreadable');

  const vacancies = new Map<string, UnifiedVacancy>();
  for (const payload of payloads) {
    for (const rawJob of payload.props?.jobPostings as unknown[]) {
      const vacancy = buildVacancy(rawJob as YcJobPosting, source, sourceUrl, observedAt);
      if (vacancy) vacancies.set(vacancy.id, vacancy);
    }
  }
  return [...vacancies.values()];
}

/** Bounded public-page reader; it never follows the private application flow. */
export async function fetchYcWorkAtStartup(
  source: VacancySourceConfig,
  fetchPage: YcPageFetcher = fetch,
): Promise<SourceReading> {
  const vacancies = new Map<string, UnifiedVacancy>();
  for (const path of YC_JOB_PATHS) {
    // The registry target is descriptive configuration, not an authority to
    // redirect this adapter to another host. Keep every request on the
    // provider origin and let a changed target fail through the normal source
    // health path rather than turning it into an SSRF primitive.
    const url = new URL(`/${path}`, YC_ORIGIN).toString();
    const response = await fetchPage(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (compatible; openqareer/1.0; +https://openqareer.com)',
      },
      signal: AbortSignal.timeout(YC_SOURCE_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`vacancy_source_unreachable: ${response.status}`);
    const observedAt = new Date().toISOString();
    for (const vacancy of parseYcWorkAtStartupPage(
      await response.text(),
      source,
      url,
      observedAt,
    )) {
      vacancies.set(vacancy.id, vacancy);
    }
  }
  return { vacancies: [...vacancies.values()], partial: false };
}
