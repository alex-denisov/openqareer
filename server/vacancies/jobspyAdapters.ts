import type { UnifiedVacancy } from '../domain/unifiedVacancy';
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
} from './jsonVacancyRecord';

export const NAUKRI_SOURCE_ID = 'src-naukri';
export const BDJOBS_SOURCE_ID = 'src-bdjobs';
export const ZIPRECRUITER_SOURCE_ID = 'src-ziprecruiter';

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
  const externalId = text(job.JobId) || text(job.job_id) || text(job.id);
  const title = text(job.JobTitle) || text(job.job_title) || text(job.title);
  const company =
    text(job.CompnayName) ||
    text(job.CompanyName) ||
    text(job.company_name) ||
    text(job.company);
  const location = text(job.JobLocation) || text(job.location) || undefined;
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
  const from = numeric(job.compensation_min);
  const to = numeric(job.compensation_max);
  if (from === undefined && to === undefined) return undefined;
  return {
    from,
    to,
    currency: text(job.compensation_currency) || 'USD',
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
