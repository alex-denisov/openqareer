import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import {
  asArray,
  buildJsonVacancy,
  fromEpochMilliseconds,
  fromIso,
  fromLooseDate,
  isUsableVacancy,
  listOf,
  numeric,
  record,
  text,
  UNREADABLE,
  type JsonAdapterContext,
  type JsonRecord,
} from './jsonVacancyRecord';

/**
 * B202 — вакансии прямо с карьерной доски работодателя.
 *
 * Это не шесть новых площадок, а одно семейство: у каждого провайдера один
 * адрес с подстановкой доски компании, поэтому источник называется
 * `ats-<провайдер>-<доска>`, а разбор выбирается по провайдеру. Адреса и формы
 * записей замерены живьём 2026-09-05 с маршрута eu-prod — таблица в тикете
 * B202; ничего здесь не перенесено из памяти агента.
 *
 * Вакансия с такой доски доверенная по построению: работодатель известен, ссылка
 * ведёт к нему, дата настоящая (опорный класс доверия из B200).
 */
export type AtsProvider =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workable'
  | 'recruitee'
  | 'smartrecruiters';

/**
 * Что площадка разрешила словами в своём `robots.txt` на 2026-09-05. Запрет —
 * такой же замер, как и ответ ленты, и он обязан жить в коде, а не в памяти
 * агента: SmartRecruiters отдаёт 4811 вакансий Bosch и при этом запрещает обход
 * всем, кроме `LinkedInBot`.
 */
export type AtsCrawlPermission = 'allowed' | 'robots_forbidden';

export interface AtsProviderContract {
  readonly provider: AtsProvider;
  readonly name: string;
  /** Адрес ленты доски. Подставляется слаг компании у этого провайдера. */
  readonly endpoint: (board: string) => string;
  /** Публичная страница доски — её видит кандидат, не сервер. */
  readonly boardUrl: (board: string) => string;
  readonly crawlPermission: AtsCrawlPermission;
  readonly robotsNote: string;
  readonly measuredAt: string;
}

export const ATS_PROVIDERS: readonly AtsProviderContract[] = [
  {
    provider: 'greenhouse',
    name: 'Greenhouse',
    // `content=true` — иначе лента отдаёт вакансии вовсе без текста: карточка
    // выходит с одним названием, а сопоставлять требования не с чем. Замер:
    // `stripe` — 384 343 б без текста и 1 751 831 б с текстом (2026-09-05).
    endpoint: (board) => `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`,
    boardUrl: (board) => `https://boards.greenhouse.io/${board}`,
    crawlPermission: 'allowed',
    robotsNote: 'Disallow только /embed/ — лента разрешена (замер 2026-09-05)',
    measuredAt: '2026-09-05',
  },
  {
    provider: 'lever',
    name: 'Lever',
    endpoint: (board) => `https://api.lever.co/v0/postings/${board}?mode=json`,
    boardUrl: (board) => `https://jobs.lever.co/${board}`,
    crawlPermission: 'allowed',
    robotsNote: 'Allow: / при Crawl-delay: 1 (замер 2026-09-05)',
    measuredAt: '2026-09-05',
  },
  {
    provider: 'ashby',
    name: 'Ashby',
    endpoint: (board) => `https://api.ashbyhq.com/posting-api/job-board/${board}`,
    boardUrl: (board) => `https://jobs.ashbyhq.com/${board}`,
    crawlPermission: 'allowed',
    robotsNote: 'robots.txt отвечает Unauthorized — запрета словами нет (замер 2026-09-05)',
    measuredAt: '2026-09-05',
  },
  {
    provider: 'workable',
    name: 'Workable',
    endpoint: (board) => `https://apply.workable.com/api/v1/widget/accounts/${board}?details=true`,
    boardUrl: (board) => `https://apply.workable.com/${board}/`,
    crawlPermission: 'allowed',
    robotsNote: 'Disallow пуст; Content-Signal ai-train=no — учить на содержимом нельзя',
    measuredAt: '2026-09-05',
  },
  {
    provider: 'recruitee',
    name: 'Recruitee',
    endpoint: (board) => `https://${board}.recruitee.com/api/offers/`,
    boardUrl: (board) => `https://${board}.recruitee.com/`,
    crawlPermission: 'allowed',
    robotsNote: 'Disallow: /v/ — /api/offers/ разрешён (замер 2026-09-05)',
    measuredAt: '2026-09-05',
  },
  {
    provider: 'smartrecruiters',
    name: 'SmartRecruiters',
    endpoint: (board) => `https://api.smartrecruiters.com/v1/companies/${board}/postings?limit=100`,
    boardUrl: (board) => `https://jobs.smartrecruiters.com/${board}`,
    crawlPermission: 'robots_forbidden',
    robotsNote:
      'robots.txt: User-agent * → Disallow: /, разрешён только LinkedInBot (замер 2026-09-05)',
    measuredAt: '2026-09-05',
  },
];

const CONTRACTS: Readonly<Record<AtsProvider, AtsProviderContract>> = Object.fromEntries(
  ATS_PROVIDERS.map((contract) => [contract.provider, contract]),
) as Record<AtsProvider, AtsProviderContract>;

const SOURCE_ID_PREFIX = 'ats-';

export function atsBoardSourceId(provider: AtsProvider, board: string): string {
  return `${SOURCE_ID_PREFIX}${provider}-${board}`;
}

export interface AtsBoardRef {
  readonly provider: AtsProvider;
  readonly board: string;
}

/**
 * Слаг доски сам может содержать дефисы (`nova-labs`), поэтому разбор идёт от
 * известного провайдера, а не по первому дефису.
 */
export function parseAtsBoardSourceId(sourceId: string): AtsBoardRef | null {
  if (!sourceId.startsWith(SOURCE_ID_PREFIX)) return null;
  const rest = sourceId.slice(SOURCE_ID_PREFIX.length);
  for (const contract of ATS_PROVIDERS) {
    const head = `${contract.provider}-`;
    if (rest.startsWith(head)) {
      const board = rest.slice(head.length);
      return board.length > 0 ? { provider: contract.provider, board } : null;
    }
  }
  return null;
}

export function atsBoardContract(provider: AtsProvider): AtsProviderContract {
  return CONTRACTS[provider];
}

export function atsBoardEndpoint(provider: AtsProvider, board: string): string {
  return CONTRACTS[provider].endpoint(board);
}

export function hasAtsBoardAdapter(sourceId: string): boolean {
  return parseAtsBoardSourceId(sourceId) !== null;
}

export function normalizeAtsBoard(
  sourceId: string,
  payload: unknown,
  context: JsonAdapterContext,
): UnifiedVacancy[] {
  const ref = parseAtsBoardSourceId(sourceId);
  if (!ref) throw new Error(`vacancy_source_adapter_missing: ${sourceId}`);
  return READERS[ref.provider](payload, context, sourceId, ref.board).filter(isUsableVacancy);
}

type BoardReader = (
  payload: unknown,
  context: JsonAdapterContext,
  sourceId: string,
  board: string,
) => UnifiedVacancy[];

/** Имя работодателя: сначала то, что публикует сама доска, иначе — реестр. */
function employer(published: string, context: JsonAdapterContext, board: string): string {
  return published.trim() || context.sourceName?.trim() || board;
}

const READERS: Readonly<Record<AtsProvider, BoardReader>> = {
  greenhouse: (payload, context, sourceId, board) =>
    listOf(payload, (value) => asArray(record(value).jobs)).map((item) => {
      const job = record(item);
      const location = text(record(job.location).name) || undefined;
      return buildJsonVacancy({
        sourceId,
        context,
        externalId: text(job.id),
        title: text(job.title),
        company: employer(text(job.company_name), context, board),
        location,
        isRemote: /\bremote\b/i.test(location ?? ''),
        description: text(job.content) || text(job.title),
        skills: [],
        url: text(job.absolute_url),
        publishedAt: fromIso(job.first_published ?? job.updated_at),
      });
    }),

  lever: (payload, context, sourceId, board) =>
    listOf(payload, asArray).map((item) => {
      const job = record(item);
      const categories = record(job.categories);
      return buildJsonVacancy({
        sourceId,
        context,
        externalId: text(job.id),
        title: text(job.text),
        // Lever не публикует работодателя в записи вовсе: его называет реестр.
        company: employer('', context, board),
        location: text(categories.location) || undefined,
        isRemote: text(job.workplaceType).toLowerCase() === 'remote',
        description: text(job.descriptionPlain) || text(job.description) || text(job.text),
        skills: [],
        employmentType: text(categories.commitment) || undefined,
        salary: rangeSalary(job.salaryRange),
        url: text(job.hostedUrl) || text(job.applyUrl),
        publishedAt: fromEpochMilliseconds(job.createdAt),
      });
    }),

  ashby: (payload, context, sourceId, board) =>
    listOf(payload, (value) => asArray(record(value).jobs))
      // `isListed: false` — вакансия снята с публичной доски самим работодателем.
      .filter((item) => record(item).isListed !== false)
      .map((item) => {
        const job = record(item);
        return buildJsonVacancy({
          sourceId,
          context,
          externalId: text(job.id),
          title: text(job.title),
          // Ashby тоже не называет работодателя в записи.
          company: employer('', context, board),
          location: text(job.location) || undefined,
          isRemote: job.isRemote === true,
          description: text(job.descriptionPlain) || text(job.descriptionHtml) || text(job.title),
          skills: [],
          employmentType: text(job.employmentType) || undefined,
          url: text(job.jobUrl) || text(job.applyUrl),
          publishedAt: fromIso(job.publishedAt),
        });
      }),

  workable: (payload, context, sourceId, board) => {
    const account = record(payload);
    const accountName = text(account.name);
    return listOf(payload, (value) => asArray(record(value).jobs)).map((item) => {
      const job = record(item);
      return buildJsonVacancy({
        sourceId,
        context,
        externalId: text(job.shortcode),
        title: text(job.title),
        company: employer(accountName, context, board),
        location: placeOf(text(job.city), text(job.country)),
        isRemote: job.telecommuting === true,
        description: text(job.description) || text(job.title),
        skills: [],
        employmentType: text(job.employment_type) || undefined,
        experienceLevel: text(job.experience) || undefined,
        url: text(job.url) || text(job.shortlink),
        publishedAt: fromLooseDate(job.published_on ?? job.created_at),
      });
    });
  },

  recruitee: (payload, context, sourceId, board) =>
    listOf(payload, (value) => asArray(record(value).offers)).map((item) => {
      const offer = record(item);
      return buildJsonVacancy({
        sourceId,
        context,
        externalId: text(offer.id),
        title: text(offer.title),
        company: employer(text(offer.company_name), context, board),
        location: text(offer.location) || placeOf(text(offer.city), text(offer.country)),
        isRemote: offer.remote === true,
        description: text(offer.description) || text(offer.title),
        skills: [],
        salary: rangeSalary(offer.salary),
        url: text(offer.careers_url) || text(offer.careers_apply_url),
        publishedAt: fromLooseDate(offer.published_at ?? offer.created_at),
      });
    }),

  smartrecruiters: (payload, context, sourceId, board) =>
    listOf(payload, (value) => asArray(record(value).content)).map((item) => {
      const posting = record(item);
      const location = record(posting.location);
      const id = text(posting.id);
      return buildJsonVacancy({
        sourceId,
        context,
        externalId: id,
        title: text(posting.name),
        company: employer(text(record(posting.company).name), context, board),
        location: text(location.fullLocation) || text(location.city) || undefined,
        isRemote: location.remote === true,
        // Список постингов не содержит текста вакансии — за ним нужен второй
        // запрос на карточку. Пока его нет, описанием остаётся само название:
        // придумывать содержание запрещено (B161).
        description: text(posting.name),
        skills: [],
        employmentType: text(record(posting.typeOfEmployment).label) || undefined,
        experienceLevel: text(record(posting.experienceLevel).label) || undefined,
        url: `https://jobs.smartrecruiters.com/${board}/${id}`,
        publishedAt: fromIso(posting.releasedDate),
      });
    }),
};

function placeOf(city: string, country: string): string | undefined {
  const parts = [city, country].map((part) => part.trim()).filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/**
 * Вилка приходит и числами (Lever), и строками (Recruitee). Нулевая вилка у
 * Lever означает «не указана», а не «ноль».
 */
function rangeSalary(value: unknown): UnifiedVacancy['salary'] | undefined {
  const range: JsonRecord = record(value);
  const from = numeric(range.min);
  const to = numeric(range.max);
  const currency = text(range.currency).trim() || undefined;
  if (!from && !to) return undefined;
  return { from: from || undefined, to: to || undefined, currency };
}

export { UNREADABLE as ATS_PAYLOAD_UNREADABLE };
