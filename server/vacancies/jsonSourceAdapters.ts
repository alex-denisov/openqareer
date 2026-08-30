import type { UnifiedVacancy } from '../domain/unifiedVacancy';

/**
 * Each job board publishes its own JSON record shape, so normalisation is a
 * per-source adapter rather than one guessy reader (B164).
 *
 * Two rules hold for every adapter:
 * - a payload the adapter cannot read raises, because a successful empty
 *   reading is a measurement nobody took (B161);
 * - `observedAt` is passed in from the moment of the actual request, never
 *   taken when the object is constructed.
 */
export interface JsonAdapterContext {
  readonly observedAt: string;
}

type JsonRecord = Record<string, unknown>;

const UNREADABLE = 'vacancy_source_payload_unreadable';

export function normalizeJsonSource(
  sourceId: string,
  payload: unknown,
  context: JsonAdapterContext,
): UnifiedVacancy[] {
  const adapter = ADAPTERS[sourceId];
  if (!adapter) throw new Error(`vacancy_source_adapter_missing: ${sourceId}`);
  return adapter(payload, context, sourceId).filter(isUsable);
}

/** A record without a title, a company or a link cannot be shown or opened. */
function isUsable(vacancy: UnifiedVacancy): boolean {
  return (
    vacancy.title.trim().length > 0 &&
    vacancy.company.trim().length > 0 &&
    vacancy.url.trim().length > 0
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

function build(input: {
  sourceId: string;
  context: JsonAdapterContext;
  externalId: string;
  title: string;
  company: string;
  location?: string;
  isRemote: boolean;
  description: string;
  skills: string[];
  employmentType?: string;
  experienceLevel?: string;
  salary?: UnifiedVacancy['salary'];
  url: string;
  publishedAt: string;
}): UnifiedVacancy {
  const id = `${input.sourceId}:${input.externalId || input.url}`;
  return {
    id,
    fingerprint: id,
    title: input.title.trim(),
    company: input.company.trim(),
    location: input.location,
    isRemote: input.isRemote,
    salary: input.salary,
    description: input.description,
    requiredSkills: input.skills,
    employmentType: input.employmentType,
    experienceLevel: input.experienceLevel,
    url: input.url,
    provenance: {
      sourceType: 'json_api',
      sourceId: input.sourceId,
      sourceUrl: input.url,
      externalId: input.externalId || undefined,
      observedAt: input.context.observedAt,
    },
    publishedAt: input.publishedAt,
    status: 'active',
  };
}

function listOf(payload: unknown, select: (value: unknown) => unknown[] | null): unknown[] {
  const items = select(payload);
  if (!items) throw new Error(UNREADABLE);
  return items;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' ? (value as JsonRecord) : {};
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter((item) => item.length > 0) : [];
}

function firstOf(value: unknown): string | undefined {
  const list = stringList(value);
  return list[0];
}

function numericSalary(job: JsonRecord): UnifiedVacancy['salary'] | undefined {
  const from = typeof job.salary_min === 'number' ? job.salary_min : undefined;
  const to = typeof job.salary_max === 'number' ? job.salary_max : undefined;
  if (from === undefined && to === undefined) return undefined;
  return { from, to, currency: 'RUR' };
}

/**
 * An unreadable date is not today. Falling back to `now` is what made a
 * long-dead posting look fresh, so an unparseable value keeps the epoch and is
 * filtered out by the freshness window instead.
 */
const UNKNOWN_PUBLISHED_AT = new Date(0).toISOString();

function fromEpochSeconds(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return UNKNOWN_PUBLISHED_AT;
  return new Date(value * 1000).toISOString();
}

function fromIso(value: unknown): string {
  const parsed = Date.parse(text(value));
  return Number.isNaN(parsed) ? UNKNOWN_PUBLISHED_AT : new Date(parsed).toISOString();
}

/** `2026-08-27 09:00:00` and `2026-08-14` are both dates these boards return. */
function fromLooseDate(value: unknown): string {
  const raw = text(value).trim();
  if (!raw) return UNKNOWN_PUBLISHED_AT;
  const parsed = Date.parse(raw.includes(' ') ? raw.replace(' ', 'T') + 'Z' : raw);
  return Number.isNaN(parsed) ? UNKNOWN_PUBLISHED_AT : new Date(parsed).toISOString();
}
