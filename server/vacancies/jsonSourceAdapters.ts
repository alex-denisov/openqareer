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
} from './jsonVacancyRecord';
import { hasAtsBoardAdapter, normalizeAtsBoard } from './atsBoardAdapters';

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
  return sourceId in ADAPTERS || hasAtsBoardAdapter(sourceId);
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

function numericSalary(job: JsonRecord): UnifiedVacancy['salary'] | undefined {
  const from = numeric(job.salary_min);
  const to = numeric(job.salary_max);
  if (from === undefined && to === undefined) return undefined;
  return { from, to, currency: 'RUR' };
}
