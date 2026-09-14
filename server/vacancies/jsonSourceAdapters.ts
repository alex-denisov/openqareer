import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import {
  asArray,
  buildJsonVacancy as build,
  firstOf,
  fromEpochSeconds,
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
import { hasAtsBoardAdapter, normalizeAtsBoard } from './atsBoardAdapters';
import { eightfoldPayload, isWorkdaySource } from './pagedJsonSources';
import { CROSSOVER_SOURCE_ID } from './crossoverSource';
import { LINKEDIN_SOURCE_ID } from './linkedinGuestSource';

export type { JsonAdapterContext } from './jsonVacancyRecord';

/**
 * Each job board publishes its own JSON record shape, so normalisation is a
 * per-source adapter rather than one guessy reader (B164).
 *
 * Two rules hold for every adapter:
 * - a payload the adapter cannot read raises, because a successful empty
 *   reading is a measurement nobody took (B161);
 * - `observedAt` is passed in from the moment of the actual request, never
 *   taken when the object is constructed.
 *
 * Доски работодателей (Greenhouse, Lever, Ashby, Workable, Recruitee,
 * SmartRecruiters) — не отдельные площадки, а одно семейство с общим адресом на
 * компанию, поэтому они живут в `atsBoardAdapters.ts` и подключаются здесь
 * (B202).
 */
export function normalizeJsonSource(
  sourceId: string,
  payload: unknown,
  context: JsonAdapterContext,
): UnifiedVacancy[] {
  if (hasAtsBoardAdapter(sourceId)) return normalizeAtsBoard(sourceId, payload, context);
  if (isWorkdaySource(sourceId)) return workday(payload, context, sourceId).filter(isUsable);
  const adapter = ADAPTERS[sourceId];
  if (!adapter) throw new Error(`vacancy_source_adapter_missing: ${sourceId}`);
  return adapter(payload, context, sourceId).filter(isUsable);
}

/**
 * Есть ли у площадки свой разбор записи. Реестр источников обязан спросить это
 * до того, как включит JSON-площадку: без адаптера сбор падает, а источник
 * выглядит подключённым (B199).
 */
export function hasJsonAdapter(sourceId: string): boolean {
  return (
    sourceId in ADAPTERS ||
    hasAtsBoardAdapter(sourceId) ||
    isWorkdaySource(sourceId) ||
    // Crossover собирается из sitemap и Kentico своим сборщиком (B217).
    sourceId === CROSSOVER_SOURCE_ID ||
    // LinkedIn собирается своим HTML-разбором (B218).
    sourceId === LINKEDIN_SOURCE_ID
  );
}

type Adapter = (
  payload: unknown,
  context: JsonAdapterContext,
  sourceId: string,
) => UnifiedVacancy[];

const ADAPTERS: Readonly<Record<string, Adapter>> = {
  'src-arbeitnow': (payload, context, sourceId) =>
    listOf(payload, (value) => asArray(record(value).data)).map((item) => {
      const job = record(item);
      return build({
        sourceId,
        context,
        externalId: text(job.slug),
        title: text(job.title),
        company: text(job.company_name),
        location: text(job.location) || undefined,
        isRemote: job.remote === true,
        description: text(job.description),
        skills: stringList(job.tags),
        url: text(job.url),
        publishedAt: fromEpochSeconds(job.created_at),
      });
    }),

  'src-remoteok': (payload, context, sourceId) =>
    listOf(payload, asArray)
      // The first element is RemoteOK's licence notice, not a vacancy.
      .filter((item) => record(item).legal === undefined)
      .map((item) => {
        const job = record(item);
        return build({
          sourceId,
          context,
          externalId: text(job.id) || text(job.slug),
          title: text(job.position) || text(job.title),
          company: text(job.company),
          location: text(job.location) || undefined,
          isRemote: true,
          description: text(job.description) || text(job.position),
          skills: stringList(job.tags),
          url: text(job.url),
          publishedAt: fromIso(job.date),
        });
      }),

  'src-jobicy': (payload, context, sourceId) =>
    listOf(payload, (value) => asArray(record(value).jobs)).map((item) => {
      const job = record(item);
      return build({
        sourceId,
        context,
        externalId: text(job.id),
        title: text(job.jobTitle),
        company: text(job.companyName),
        location: text(job.jobGeo) || undefined,
        isRemote: true,
        description: text(job.jobExcerpt) || text(job.jobDescription),
        skills: stringList(job.jobIndustry),
        employmentType: firstOf(job.jobType),
        experienceLevel: text(job.jobLevel) || undefined,
        url: text(job.url),
        publishedAt: fromLooseDate(job.pubDate),
      });
    }),

  'src-workingnomads': (payload, context, sourceId) =>
    listOf(payload, asArray).map((item) => {
      const job = record(item);
      return build({
        sourceId,
        context,
        externalId: text(job.url),
        title: text(job.title),
        company: text(job.company_name),
        location: text(job.location) || undefined,
        isRemote: true,
        description: text(job.description),
        skills: stringList(job.tags),
        employmentType: text(job.category_name) || undefined,
        url: text(job.url),
        publishedAt: fromIso(job.pub_date),
      });
    }),

  'src-getonbrd': (payload, context, sourceId) =>
    listOf(payload, (value) => asArray(record(value).data)).map((item) => {
      const envelope = record(item);
      const job = record(envelope.attributes);
      // Работодатель приходит только с `expand=["company"]` — иначе в записи
      // один числовой id, и карточка не годится (B216 → B217).
      const company = record(record(record(job.company).data).attributes);
      const countries = stringList(job.countries);
      return build({
        sourceId,
        context,
        externalId: text(envelope.id),
        title: text(job.title),
        company: text(job.company_name) || text(company.name) || text(record(job.company).name),
        location: countries[0] || text(job.country) || text(job.city) || undefined,
        isRemote: job.remote === true,
        description: [text(job.description), text(job.functions), text(job.desirable)]
          .filter(Boolean)
          .join('\n'),
        skills: [],
        employmentType: nestedName(job.modality) || undefined,
        experienceLevel: nestedName(job.seniority) || undefined,
        url: text(record(envelope.links).public_url) || text(job.public_url) || text(job.url),
        publishedAt: fromEpochSeconds(job.published_at),
      });
    }),

  'src-indeed': (payload, context, sourceId) =>
    listOf(payload, (value) => asArray(record(record(record(value).data).jobSearch).results)).map(
      (item) => {
        const job = record(record(item).job);
        const loc = record(job.location);
        const city = text(loc.city);
        const country = text(loc.countryName);
        const location = text(record(loc.formatted).long) || [city, country].filter(Boolean).join(', ');
        const key = text(job.key);
        return build({
          sourceId,
          context,
          externalId: key,
          title: text(job.title),
          company: text(record(job.employer).name),
          location: location || undefined,
          isRemote: /remote/i.test(location),
          description: text(record(job.description).html) || text(job.title),
          skills: [],
          url: text(record(job.recruit).viewJobUrl) || `https://www.indeed.com/viewjob?jk=${key}`,
          publishedAt: fromEpochMilliseconds(numeric(job.datePublished) ?? numeric(job.dateOnIndeed)),
        });
      },
    ),

  'src-themuse': (payload, context, sourceId) =>
    listOf(payload, (value) => asArray(record(value).results)).map((item) => {
      const job = record(item);
      const locations = asArray(job.locations)?.map((entry) => text(record(entry).name)) ?? [];
      const categories = asArray(job.categories)?.map((entry) => text(record(entry).name)) ?? [];
      const levels = asArray(job.levels)?.map((entry) => text(record(entry).name)) ?? [];
      return build({
        sourceId,
        context,
        externalId: text(job.id),
        title: text(job.name),
        company: text(record(job.company).name),
        location: locations.filter(Boolean).join('; ') || undefined,
        isRemote: locations.some((name) => /remote/i.test(name)),
        description: text(job.contents) || text(job.name),
        skills: categories.filter(Boolean),
        experienceLevel: levels.find(Boolean),
        url: text(record(job.refs).landing_page),
        publishedAt: fromIso(job.publication_date),
      });
    }),

  'src-himalayas-api': (payload, context, sourceId) =>
    listOf(payload, (value) => asArray(record(value).jobs)).map((item) => {
      const job = record(item);
      const from = numeric(job.minSalary);
      const to = numeric(job.maxSalary);
      const currency = text(job.currency) || undefined;
      return build({
        sourceId,
        context,
        externalId: text(job.guid) || text(job.applicationLink),
        title: text(job.title),
        company: text(job.companyName),
        location: stringList(job.locationRestrictions).join('; ') || undefined,
        isRemote: true,
        description: text(job.description) || text(job.excerpt) || text(job.title),
        skills: stringList(job.categories),
        employmentType: text(job.employmentType) || undefined,
        experienceLevel: firstOf(job.seniority),
        salary: from === undefined && to === undefined ? undefined : { from, to, currency },
        url: text(job.applicationLink) || text(job.guid),
        publishedAt: fromEpochSeconds(numeric(job.pubDate)),
      });
    }),

  'src-amazon-jobs': (payload, context, sourceId) =>
    listOf(payload, (value) => asArray(record(value).jobs)).map((item) => {
      const job = record(item);
      const path = text(job.job_path);
      const location = text(job.normalized_location) || text(job.location) || undefined;
      const description = [text(job.description), text(job.basic_qualifications)]
        .filter(Boolean)
        .join('\n\n');
      return build({
        sourceId,
        context,
        externalId: text(job.id_icims) || text(job.id),
        title: text(job.title),
        company: text(job.company_name) || context.sourceName || '',
        location,
        isRemote: /virtual|remote/i.test(location ?? ''),
        description: description || text(job.title),
        skills: [text(job.job_category), text(job.job_family)].filter(Boolean),
        employmentType: text(job.job_schedule_type) || undefined,
        url: path ? `https://www.amazon.jobs${path}` : '',
        publishedAt: fromLooseDate(job.posted_date),
      });
    }),

  'src-netflix': (payload, context, sourceId) =>
    eightfold(payload, context, sourceId, 'https://explore.jobs.netflix.net'),

  'src-microsoft-careers': (payload, context, sourceId) =>
    eightfold(payload, context, sourceId, 'https://apply.careers.microsoft.com'),

  'src-apple-jobs': (payload, context, sourceId) =>
    listOf(payload, (value) => asArray(record(record(value).res).searchResults)).map((item) => {
      const job = record(item);
      // Идентификатор идёт в адрес карточки: чужой символ в нём — не вакансия.
      const positionId = /^[A-Za-z0-9-]+$/.test(text(job.positionId)) ? text(job.positionId) : '';
      const location = firstOf(job.locations) || text(record(asArray(job.locations)?.[0]).name);
      const team = text(record(job.team).teamName);
      return build({
        sourceId,
        context,
        externalId: positionId,
        title: text(job.postingTitle),
        company: context.sourceName ?? 'Apple',
        location: location || undefined,
        isRemote: job.homeOffice === true || /remote/i.test(location),
        description: text(job.jobSummary) || [text(job.postingTitle), team].filter(Boolean).join(' — '),
        skills: [team].filter(Boolean),
        employmentType: text(job.type) || undefined,
        url: positionId
          ? `https://jobs.apple.com/en-us/details/${positionId}/${encodeURIComponent(text(job.transformedPostingTitle))}`
          : '',
        publishedAt: fromIso(job.postDateInGMT),
      });
    }),

  remotive: (payload, context, sourceId) =>
    listOf(payload, (value) => asArray(record(value).jobs)).map((item) => {
      const job = record(item);
      const location = text(job.candidate_required_location);
      return build({
        sourceId,
        context,
        externalId: text(job.id),
        title: text(job.title),
        company: text(job.company_name).trim(),
        location: location || undefined,
        isRemote: true,
        description: text(job.description) || text(job.title),
        skills: stringList(job.tags),
        employmentType: text(job.job_type) || undefined,
        url: text(job.url),
        publishedAt: fromIso(job.publication_date),
      });
    }),

  'src-trudvsem': (payload, context, sourceId) =>
    listOf(payload, (value) => asArray(record(record(value).results).vacancies)).map((item) => {
      const job = record(record(item).vacancy);
      const salary = numericSalary(job);
      return build({
        sourceId,
        context,
        externalId: text(job.id),
        title: text(job['job-name']),
        company: text(record(job.company).name),
        location: text(record(job.region).name) || undefined,
        isRemote: false,
        description: text(job.duty) || text(job['job-name']),
        skills: [],
        employmentType: text(job.schedule) || undefined,
        salary,
        url: text(job.vac_url),
        publishedAt: fromLooseDate(job['creation-date']),
      });
    }),
};

/**
 * Workday (B216): список отдаёт заголовок, место, относительный путь и «Posted
 * 3 Days Ago» вместо даты. Описания в списке нет — карточка честно несёт
 * заголовок и место, а публичная ссылка собирается из адреса сайта тенанта:
 * `…/wday/cxs/<tenant>/<site>/jobs` → `https://<host>/<site><externalPath>`.
 */
const workday: Adapter = (payload, context, sourceId) =>
  listOf(payload, (value) => asArray(record(value).jobPostings)).map((item) => {
    const job = record(item);
    const path = text(job.externalPath);
    const location = text(job.locationsText) || undefined;
    return build({
      sourceId,
      context,
      externalId: firstOf(job.bulletFields) || path,
      title: text(job.title),
      company: context.sourceName ?? '',
      location,
      isRemote: /remote/i.test(location ?? ''),
      description: [text(job.title), location].filter(Boolean).join(' — '),
      skills: [],
      url: workdayPublicUrl(context.sourceUrl, path),
      publishedAt: fromWorkdayPostedOn(job.postedOn, context.observedAt),
    });
  });

export function workdayPublicUrl(sourceUrl: string | undefined, externalPath: string): string {
  if (!sourceUrl || !externalPath) return '';
  const url = new URL(sourceUrl);
  const segments = url.pathname.split('/').filter(Boolean);
  const site = segments[3];
  if (segments[0] !== 'wday' || segments[1] !== 'cxs' || !site) return '';
  return `${url.origin}/${site}${externalPath}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `Posted Today` / `Posted Yesterday` / `Posted 3 Days Ago` / `Posted 30+ Days Ago`. */
export function fromWorkdayPostedOn(value: unknown, observedAt: string): string {
  const raw = text(value).trim().toLowerCase();
  const observed = Date.parse(observedAt);
  if (!raw || Number.isNaN(observed)) return UNKNOWN_PUBLISHED_AT;
  if (raw.includes('today')) return new Date(observed).toISOString();
  if (raw.includes('yesterday')) return new Date(observed - DAY_MS).toISOString();
  const days = /(\d+)\+?\s*days?/.exec(raw);
  if (!days) return UNKNOWN_PUBLISHED_AT;
  return new Date(observed - Number(days[1]) * DAY_MS).toISOString();
}

function numericSalary(job: JsonRecord): UnifiedVacancy['salary'] | undefined {
  const from = numeric(job.salary_min);
  const to = numeric(job.salary_max);
  if (from === undefined && to === undefined) return undefined;
  return { from, to, currency: 'RUR' };
}

/** Имя вложенного справочника Get on Board: `{ data: { attributes: { name } } }`. */
function nestedName(value: unknown): string {
  return text(record(record(record(value).data).attributes).name);
}

/**
 * Eightfold (Netflix, Microsoft): работодателя в записи нет — его называет
 * реестр; описания в списке тоже нет, поэтому карточка собирается из названия
 * и подразделения. Microsoft отдаёт относительный `positionUrl` и поля в
 * camelCase, Netflix — абсолютный `canonicalPositionUrl` и snake_case (B217).
 */
function eightfold(
  payload: unknown,
  context: JsonAdapterContext,
  sourceId: string,
  baseUrl: string,
): UnifiedVacancy[] {
  return listOf(payload, (value) => eightfoldPayload(value).positions).map((item) => {
    const job = record(item);
    const location = text(job.location) || firstOf(job.locations) || '';
    const workLocation = text(job.work_location_option) || text(job.workLocationOption);
    const url = sameOriginUrl(text(job.canonicalPositionUrl) || text(job.positionUrl), baseUrl);
    return build({
      sourceId,
      context,
      externalId: text(job.display_job_id) || text(job.displayJobId) || text(job.id),
      title: text(job.name) || text(job.posting_name),
      company: context.sourceName ?? '',
      location: location || undefined,
      isRemote: /remote/i.test(location) || workLocation === 'remote',
      description:
        text(job.job_description) ||
        [text(job.name), text(job.department), text(job.business_unit)].filter(Boolean).join(' — '),
      skills: [text(job.department)].filter(Boolean),
      url,
      publishedAt: fromEpochSeconds(numeric(job.t_create) ?? numeric(job.postedTs)),
    });
  });
}

/** Относительный адрес площадки — только на её же хосте; чужой хост — пустая ссылка. */
function sameOriginUrl(candidate: string, baseUrl: string): string {
  if (!candidate) return '';
  try {
    const resolved = new URL(candidate, baseUrl);
    return resolved.origin === new URL(baseUrl).origin ? resolved.toString() : '';
  } catch {
    return '';
  }
}
