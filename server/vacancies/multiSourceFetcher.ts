import { parseRssJobFeed } from '../connectors/rssFeedParser';
import { normalizeJsonSource } from './jsonSourceAdapters';
import { parseTelegramChannelHtml } from '../connectors/telegramChannelParser';
import type { HhVacancySample } from '../connectors/hhVacancySearch';
import type { VacancySample } from '../domain/vacancy';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import type { SourceFetcher } from './multiSourceVacancyEngine';
import type { RobotsFetcher } from './robotsPolicyLoader';
import type { HhCrawlCoordinator } from './hhCrawlCoordinator';
import { pagingPlanFor, type PagedRequest } from './pagedJsonSources';
import type { SourceReading } from './multiSourceVacancyEngine';

type HhSearch = (input: { text: string; perPage?: number }) => Promise<HhVacancySample>;
type RemotiveSearch = (input: { text: string; perPage?: number }) => Promise<VacancySample>;

/**
 * Доска работодателя отдаёт весь список целиком: у Ashby это до 10 МБ (замер
 * `airwallex`, 2026-09-05), у Greenhouse с текстом вакансий — до 1,7 МБ. Пока
 * потолок был 15 с, волна больших досок упиралась в него и записывала живым
 * площадкам отказ «aborted due to timeout» (прод 2026-09-06, 92 источника).
 */
const JSON_SOURCE_TIMEOUT_MS = 45_000;

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; openqareer/1.0; +https://openqareer.com)',
} as const;

function hhSampleToUnified(sample: HhVacancySample, sourceId: string): UnifiedVacancy[] {
  return sample.items.map((v) => ({
    id: v.id,
    fingerprint: v.id,
    title: v.title,
    company: v.company,
    location: v.location,
    salary: v.salary
      ? {
          from: v.salary.from ?? undefined,
          to: v.salary.to ?? undefined,
          currency: v.salary.currency,
        }
      : undefined,
    description: v.title,
    requiredSkills: v.requirements ?? [],
    url: v.sourceUrl,
    provenance: {
      sourceType: 'hh' as const,
      sourceId,
      sourceUrl: v.sourceUrl,
      observedAt: new Date().toISOString(),
    },
    publishedAt: v.publishedAt ?? new Date().toISOString(),
    status: 'active' as const,
  }));
}

function remotiveSampleToUnified(sample: VacancySample, sourceId: string): UnifiedVacancy[] {
  return sample.items.map((v) => ({
    id: v.id,
    fingerprint: v.id,
    title: v.title,
    company: v.company,
    location: v.location,
    isRemote: true,
    description: v.title,
    requiredSkills: v.requirements ?? [],
    url: v.sourceUrl,
    provenance: {
      sourceType: 'remotive' as const,
      sourceId,
      sourceUrl: v.sourceUrl,
      observedAt: new Date().toISOString(),
    },
    publishedAt: v.publishedAt ?? new Date().toISOString(),
    status: 'active' as const,
  }));
}

async function fetchTelegramChannel(source: VacancySourceConfig): Promise<UnifiedVacancy[]> {
  const channelMatch = source.targetUrl.match(/t\.me\/(?:s\/)?([a-zA-Z0-9_]+)/i);
  const channelName = channelMatch ? channelMatch[1] : source.id.replace(/^src-tg-/, '');
  try {
    const res = await fetch(`https://t.me/s/${channelName}`, {
      headers: { ...FETCH_HEADERS, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`vacancy_source_unreachable: ${res.status}`);
    const html = await res.text();
    const vacancies = parseTelegramChannelHtml(html, {
      channelName,
      sourceId: source.id,
      observedAt: new Date().toISOString(),
    });
    return vacancies;
  } catch (reason) {
    // An unreachable channel is not an empty channel. Returning [] here made
    // syncSource take its success path and paint the source «Активен» (B161).
    throw reason instanceof Error ? reason : new Error('vacancy_source_unreachable');
  }
}

/**
 * A board's own JSON endpoint. The observation time is taken before the record
 * objects are built, so `observedAt` names the moment of the request (B164).
 */
async function fetchJsonApi(
  source: VacancySourceConfig,
  options?: { query?: string },
): Promise<UnifiedVacancy[]> {
  const url = withQuery(source, options?.query);
  return readJsonPage(source, { url });
}

async function readJsonPage(
  source: VacancySourceConfig,
  request: PagedRequest,
): Promise<UnifiedVacancy[]> {
  const { payload, observedAt } = await fetchJsonPayload(request);
  // Имя источника нужно разбору: доски Lever и Ashby не публикуют работодателя
  // в записи, и назвать его может только реестр (B202).
  return normalizeJsonSource(source.id, payload, {
    observedAt,
    sourceName: source.name,
    sourceUrl: request.url,
  });
}

async function fetchJsonPayload(
  request: PagedRequest,
): Promise<{ payload: unknown; observedAt: string }> {
  const res = await fetch(request.url, {
    method: request.method ?? 'GET',
    headers: {
      ...FETCH_HEADERS,
      Accept: 'application/json',
      ...(request.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(request.method === 'POST' ? { body: JSON.stringify(request.body ?? {}) } : {}),
    signal: AbortSignal.timeout(JSON_SOURCE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`vacancy_source_unreachable: ${res.status}`);
  const observedAt = new Date().toISOString();
  return { payload: await res.json(), observedAt };
}

/**
 * Постраничная площадка (B216): опрос читает не больше `pagesPerSync` страниц
 * и, если площадка отдала не всё, называет чтение частичным — движок тогда
 * дополняет срез, а не заменяет его. Первая страница обязана прочитаться:
 * отказ на ней — отказ площадки, а не «ноль вакансий».
 */
async function fetchPagedJsonApi(
  source: VacancySourceConfig,
  sleep: (ms: number) => Promise<void>,
  now: () => number,
): Promise<SourceReading> {
  const plan = pagingPlanFor(source.id);
  if (!plan) throw new Error(`vacancy_source_paging_missing: ${source.id}`);
  const vacancies: UnifiedVacancy[] = [];
  let request: PagedRequest | null = plan.first(source.targetUrl, now());
  let pagesRead = 0;
  while (request && pagesRead < plan.pagesPerSync) {
    if (pagesRead > 0) await sleep(plan.delayMs);
    const { payload, observedAt } = await fetchJsonPayload(request);
    vacancies.push(
      ...normalizeJsonSource(source.id, payload, {
        observedAt,
        sourceName: source.name,
        sourceUrl: request.url,
      }),
    );
    pagesRead += 1;
    request = plan.next(request, payload);
  }
  return { vacancies, partial: request !== null };
}

/** Only the sources whose live probe proved they honour a query get one. */
const QUERY_PARAMETER: Readonly<Record<string, string>> = {
  'src-getonbrd': 'query',
  'src-habr-career': 'q',
  'src-hh-rss': 'text',
};

function withQuery(source: VacancySourceConfig, query?: string): string {
  const parameter = QUERY_PARAMETER[source.id];
  if (!parameter || !query?.trim()) return source.targetUrl;
  const url = new URL(source.targetUrl);
  url.searchParams.set(parameter, query.trim());
  return url.toString();
}

async function fetchRssFeed(
  source: VacancySourceConfig,
  options?: { query?: string },
): Promise<UnifiedVacancy[]> {
  try {
    const url = withQuery(source, options?.query);
    const res = await fetch(url, {
      headers: {
        ...FETCH_HEADERS,
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`vacancy_source_unreachable: ${res.status}`);
    const xml = await res.text();
    const observedAt = new Date().toISOString();
    return parseRssJobFeed(xml, {
      sourceId: source.id,
      sourceUrl: url,
      // Имя площадки — не имя работодателя: агрегатор печатал себя в поле
      // нанимателя у каждой своей записи. Работодателя называет сама запись.
      employerShape: source.employerShape,
      observedAt,
    });
  } catch (reason) {
    throw reason instanceof Error ? reason : new Error('vacancy_source_unreachable');
  }
}

/**
 * Читает `robots.txt` площадки. Отдельный короткий запрос: правило обхода
 * нужно до самого обхода, и ждать его дольше нескольких секунд бессмысленно —
 * недоступное правило не запрещает и не разрешает (B204).
 */
export const fetchRobotsTxt: RobotsFetcher = async (robotsUrl) => {
  const res = await fetch(robotsUrl, {
    headers: { ...FETCH_HEADERS, Accept: 'text/plain' },
    signal: AbortSignal.timeout(8_000),
  });
  return { status: res.status, body: res.ok ? await res.text() : null };
};

export interface MultiSourceFetcherDeps {
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function buildMultiSourceFetcher(
  hh: HhSearch,
  remotive: RemotiveSearch,
  crawlCoordinator?: HhCrawlCoordinator,
  deps: MultiSourceFetcherDeps = {},
): SourceFetcher {
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  return async (source, options) => {
    if (source.type === 'hh') {
      const sample = await hh({ text: options?.query || 'Developer', perPage: 20 });
      return hhSampleToUnified(sample, source.id);
    }
    if (source.type === 'remotive') {
      const sample = await remotive({ text: options?.query || 'Engineer', perPage: 20 });
      return remotiveSampleToUnified(sample, source.id);
    }
    if (source.type === 'telegram') {
      return fetchTelegramChannel(source);
    }
    if (source.type === 'rss') {
      return fetchRssFeed(source, options);
    }
    if (source.type === 'json_api') {
      if (pagingPlanFor(source.id)) return fetchPagedJsonApi(source, sleep, now);
      return fetchJsonApi(source, options);
    }
    if (source.type === 'hh_search') {
      // Веер обхода hh.ru. Координатор сам решает, быстрый это проход или
      // глубокий, и отдаёт весь улов одним пакетом: пересобирать пул на каждой
      // странице нельзя — на сорока тысячах записей это четыре секунды за раз
      // (замер B214).
      if (!crawlCoordinator) {
        // Источник включён, а обход не собран: это поломка сборки, а не пустая
        // выдача. Молчаливый ноль здесь спрятал бы причину (B199).
        throw new Error('hh_crawl_coordinator_missing');
      }
      const result = await crawlCoordinator.collect();
      // Быстрый проход видит только свежие сутки: он дополняет срез, а не
      // заменяет его. Иначе каждые двадцать минут пул схлопывался бы до
      // выдачи одного дня — ровно это и случилось на проде (B214).
      return { vacancies: [...result.vacancies], partial: result.mode === 'fresh' };
    }
    // An unimplemented source type has not been measured, so it must not report
    // a successful empty reading (B161).
    throw new Error(`vacancy_source_type_unsupported: ${source.type}`);
  };
}
