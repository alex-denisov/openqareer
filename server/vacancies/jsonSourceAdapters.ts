import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import {
  asArray,
  buildJsonVacancy as build,
  firstOf,
  fromEpochSeconds,
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
import { isWorkdaySource } from './pagedJsonSources';

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
  return sourceId in ADAPTERS || hasAtsBoardAdapter(sourceId) || isWorkdaySource(sourceId);
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
      return build({
        sourceId,
        context,
        externalId: text(envelope.id),
        title: text(job.title),
        company: text(job.company_name) || text(record(job.company).name),
        location: text(job.country) || text(job.city) || undefined,
        isRemote: job.remote === true,
        description: text(job.description),
        skills: [],
        url: text(job.public_url) || text(job.url),
        publishedAt: fromEpochSeconds(job.published_at),
      });
    }),

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
    listOf(payload, (value) => asArray(record(value).positions)).map((item) => {
      const job = record(item);
      const location = text(job.location) || firstOf(job.locations);
      return build({
        sourceId,
        context,
        externalId: text(job.display_job_id) || text(job.id),
        title: text(job.name) || text(job.posting_name),
        company: context.sourceName ?? '',
        location: location || undefined,
        isRemote: /remote/i.test(location ?? '') || job.work_location_option === 'remote',
        description:
          text(job.job_description) ||
          [text(job.name), text(job.department), text(job.business_unit)]
            .filter(Boolean)
            .join(' — '),
        skills: [text(job.department)].filter(Boolean),
        url: text(job.canonicalPositionUrl),
        publishedAt: fromEpochSeconds(numeric(job.t_create)),
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
