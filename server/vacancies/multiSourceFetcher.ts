import { parseRssJobFeed } from '../connectors/rssFeedParser';
import { normalizeJsonSource } from './jsonSourceAdapters';
import { parseAtsBoardSourceId } from './atsBoardAdapters';
import { parseTelegramChannelHtml } from '../connectors/telegramChannelParser';
import type { HhVacancySample } from '../connectors/hhVacancySearch';
import type { VacancySample } from '../domain/vacancy';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import type { SourceFetcher } from './multiSourceVacancyEngine';
import type { RobotsFetcher } from './robotsPolicyLoader';
import type { HhCrawlCoordinator } from './hhCrawlCoordinator';
import { pagingPlanFor, type PagedRequest } from './pagedJsonSources';
import type { SourceReading } from './multiSourceVacancyEngine';
import { CROSSOVER_KONTENT_URL, CROSSOVER_SOURCE_ID, fetchCrossover } from './crossoverSource';
import { LINKEDIN_SOURCE_ID, fetchLinkedinGuest } from './linkedinGuestSource';
import {
  BAYT_SOURCE_ID,
  fetchWithStealthFallback,
  isCloudflareChallenge,
  normalizeBaytHtml,
} from './jobspyAdapters';
import { baytHeaders } from './jobspyEndpoints';
import { fetchLinkedinCrawler, type LinkedinCrawlerDeps } from '../crawler/linkedinIngestRunner';
import { fetchYcWorkAtStartup, YC_WORK_AT_STARTUP_SOURCE_ID } from './ycWorkAtStartupSource';

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
  if (parseAtsBoardSourceId(source.id)?.provider === 'personio') {
    return fetchXmlAtsBoard(source, url);
  }
  return readJsonPage(source, { url });
}

async function fetchXmlAtsBoard(
  source: VacancySourceConfig,
  url: string,
): Promise<UnifiedVacancy[]> {
  const res = await fetch(url, {
    headers: { ...FETCH_HEADERS, Accept: 'application/xml, text/xml' },
    signal: AbortSignal.timeout(JSON_SOURCE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`vacancy_source_unreachable: ${res.status}`);
  const observedAt = new Date().toISOString();
  return normalizeJsonSource(source.id, await res.text(), {
    observedAt,
    sourceName: source.name,
    sourceUrl: url,
  });
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
  fetchStealth: typeof fetchWithStealthFallback = fetchWithStealthFallback,
): Promise<{ payload: unknown; observedAt: string }> {
  const mergedHeaders = mergeHeaders(
    {
      ...FETCH_HEADERS,
      Accept: 'application/json',
      ...(request.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    request.headers,
  );
  const res = await fetch(request.url, {
    method: request.method ?? 'GET',
    headers: mergedHeaders,
    ...(request.method === 'POST' ? { body: JSON.stringify(request.body ?? {}) } : {}),
    signal: AbortSignal.timeout(JSON_SOURCE_TIMEOUT_MS),
  });
  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    if (isCloudflareChallenge(res.status, errorBody)) {
      const stealthRes = await fetchStealth(request.url, {
        method: request.method,
        headers: mergedHeaders,
        body: request.body,
      });
      if (stealthRes.status >= 200 && stealthRes.status < 300) {
        try {
          return {
            payload: JSON.parse(stealthRes.body),
            observedAt: new Date().toISOString(),
          };
        } catch {
          throw new Error('vacancy_source_payload_unreadable');
        }
      }
    }
    throw new Error(`vacancy_source_unreachable: ${res.status}`);
  }
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
  fetchStealth?: typeof fetchWithStealthFallback,
): Promise<SourceReading> {
  const plan = pagingPlanFor(source.id);
  if (!plan) throw new Error(`vacancy_source_paging_missing: ${source.id}`);
  const vacancies: UnifiedVacancy[] = [];
  let request: PagedRequest | null = plan.first(source.targetUrl, now());
  let pagesRead = 0;
  while (request && pagesRead < plan.pagesPerSync) {
    // Джиттер паузы: ровный такт выглядит роботом; ±25 % ломает регулярность,
    // не ускоряя опрос заметно (B218 security-review).
    if (pagesRead > 0) await sleep(jitter(plan.delayMs, now));
    const { payload, observedAt } = await fetchJsonPayload(request, fetchStealth);
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

/** LinkedIn — гостевой список, свой HTML-разбор и вежливый темп (B218). */
async function fetchLinkedinGuestSource(
  sleep: (ms: number) => Promise<void>,
): Promise<SourceReading> {
  return fetchLinkedinGuest({
    fetchPage: async (url, headers) => {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(JSON_SOURCE_TIMEOUT_MS),
      });
      return { status: res.status, body: res.ok ? await res.text() : '' };
    },
    sleep,
    observedAt: new Date().toISOString(),
  });
}

export const BAYT_PAGES_PER_SYNC = 5;
export const BAYT_DELAY_MS = 1_000;

function baytRequestUrl(targetUrl: string, query?: string, page = 1): string {
  const url = new URL(targetUrl);
  const keyword = query?.trim() || url.searchParams.get('q') || 'software engineer';
  url.searchParams.set('q', keyword);
  url.searchParams.set('page', String(page));
  return url.toString();
}

/** Bayt — HTML-выдача скрейпера, постраничный обход с Obscura stealth (B218). */
async function fetchBaytSource(
  source: VacancySourceConfig,
  sleep: (ms: number) => Promise<void>,
  now: () => number,
  options?: { query?: string },
  fetchStealth: typeof fetchWithStealthFallback = fetchWithStealthFallback,
): Promise<SourceReading> {
  const vacancies: UnifiedVacancy[] = [];
  const observedAt = new Date().toISOString();
  let partial = false;

  for (let page = 1; page <= BAYT_PAGES_PER_SYNC; page += 1) {
    if (page > 1) await sleep(jitter(BAYT_DELAY_MS, now));
    const pageUrl = baytRequestUrl(source.targetUrl, options?.query, page);
    const result = await fetchStealth(pageUrl, {
      method: 'GET',
      headers: baytHeaders(),
    });

    if (result.status === 429) {
      if (page === 1) throw new Error('vacancy_source_unreachable: 429');
      return { vacancies, partial: true };
    }
    if (result.status < 200 || result.status >= 400) {
      if (page === 1) throw new Error(`vacancy_source_unreachable: ${result.status}`);
      return { vacancies, partial: true };
    }

    const pageVacancies = normalizeBaytHtml(
      result.body,
      { observedAt, sourceName: source.name, sourceUrl: pageUrl },
      source.id,
    );

    if (pageVacancies.length === 0) {
      partial = false;
      break;
    }
    vacancies.push(...pageVacancies);
    if (page === BAYT_PAGES_PER_SYNC) {
      partial = true;
    }
  }

  return { vacancies, partial };
}

/** Crossover: sitemap → открытые вакансии, Kentico без ключа → описания (B217). */
async function fetchCrossoverSource(source: VacancySourceConfig): Promise<SourceReading> {
  const observedAt = new Date().toISOString();
  return fetchCrossover(
    { sitemapUrl: source.targetUrl, kontentUrl: CROSSOVER_KONTENT_URL },
    {
      fetchText: async (url) => {
        const res = await fetch(url, {
          headers: { ...FETCH_HEADERS, Accept: 'application/xml, text/xml' },
          signal: AbortSignal.timeout(JSON_SOURCE_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`vacancy_source_unreachable: ${res.status}`);
        return res.text();
      },
      fetchJson: async (url) => (await fetchJsonPayload({ url })).payload,
      observedAt,
    },
  );
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
  readonly fetchWithStealth?: typeof fetchWithStealthFallback;
  readonly linkedinCrawlerDeps?: LinkedinCrawlerDeps;
  readonly fetchLinkedinCrawler?: (deps?: LinkedinCrawlerDeps) => Promise<SourceReading>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Сливает заголовки так, что заголовки площадки заменяют общие по имени без
 * учёта регистра: `Content-Type` и `content-type` — один заголовок, и оставить
 * оба нельзя (Indeed видит склейку через запятую как CSRF, B218).
 */
function mergeHeaders(
  base: Record<string, string>,
  overrides?: Readonly<Record<string, string>>,
): Record<string, string> {
  if (!overrides) return base;
  const result = new Map<string, [string, string]>();
  for (const [key, value] of Object.entries(base)) result.set(key.toLowerCase(), [key, value]);
  for (const [key, value] of Object.entries(overrides)) result.set(key.toLowerCase(), [key, value]);
  return Object.fromEntries(result.values());
}

/** Пауза ±25 % от базовой: обход не должен идти ровным тактом (B218). */
function jitter(baseMs: number, now: () => number): number {
  const spread = baseMs * 0.5;
  return Math.round(baseMs - spread / 2 + ((now() % 1000) / 1000) * spread);
}

/**
 * Веер обхода hh.ru. Координатор сам решает, быстрый это тик или глубокий, и
 * отдаёт улов одним пакетом: пересобирать пул на каждой странице нельзя — на
 * сорока тысячах записей это четыре секунды за раз (замер B214).
 *
 * Любой тик — частичное чтение: быстрый видит только свежие сутки, а глубокий
 * отдаёт лишь то, что успел прочитать за тик. Иначе каждые двадцать минут пул
 * схлопывался бы до одного чтения — ровно это и случилось на проде (B214).
 * Снятие невиденного делает последний тик глубокого прохода через
 * `dropObservedBefore` (B219).
 */
async function fetchHhSearchBatch(coordinator?: HhCrawlCoordinator): Promise<SourceReading> {
  if (!coordinator) {
    // Источник включён, а обход не собран: это поломка сборки, а не пустая
    // выдача. Молчаливый ноль здесь спрятал бы причину (B199).
    throw new Error('hh_crawl_coordinator_missing');
  }
  const result = await coordinator.collect();
  return {
    vacancies: [...result.vacancies],
    partial: true,
    ...(result.dropObservedBefore ? { dropObservedBefore: result.dropObservedBefore } : {}),
  };
}

async function fetchJsonOrCareerSite(
  source: VacancySourceConfig,
  options: { query?: string } | undefined,
  deps: MultiSourceFetcherDeps,
  sleep: (ms: number) => Promise<void>,
  now: () => number,
): Promise<UnifiedVacancy[] | SourceReading> {
  if (source.type === 'career_site' && source.id === YC_WORK_AT_STARTUP_SOURCE_ID) {
    return fetchYcWorkAtStartup(source);
  }
  if (source.type === 'career_site' && source.id === BAYT_SOURCE_ID) {
    return fetchBaytSource(source, sleep, now, options, deps.fetchWithStealth);
  }
  if (source.type === 'json_api') {
    if (source.id === CROSSOVER_SOURCE_ID) return fetchCrossoverSource(source);
    if (source.id === LINKEDIN_SOURCE_ID) return fetchLinkedinGuestSource(sleep);
    if (source.id === BAYT_SOURCE_ID) {
      return fetchBaytSource(source, sleep, now, options, deps.fetchWithStealth);
    }
    if (pagingPlanFor(source.id)) {
      return fetchPagedJsonApi(source, sleep, now, deps.fetchWithStealth);
    }
    return fetchJsonApi(source, options);
  }
  throw new Error(`vacancy_source_type_unsupported: ${source.type}`);
}

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
    if (source.type === 'telegram') return fetchTelegramChannel(source);
    if (source.type === 'rss') return fetchRssFeed(source, options);
    if (source.type === 'career_site' || source.type === 'json_api') {
      return fetchJsonOrCareerSite(source, options, deps, sleep, now);
    }
    if (source.type === 'hh_search') return fetchHhSearchBatch(crawlCoordinator);
    if (source.type === 'linkedin_crawler' || source.id === 'src-linkedin-crawler') {
      const runner = deps.fetchLinkedinCrawler ?? fetchLinkedinCrawler;
      return runner({
        ...deps.linkedinCrawlerDeps,
        ...(options?.query ? { query: options.query } : {}),
      });
    }
    // An unimplemented source type has not been measured, so it must not report
    // a successful empty reading (B161).
    throw new Error(`vacancy_source_type_unsupported: ${source.type}`);
  };
}
