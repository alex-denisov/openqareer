import type { RegisteredVacancySource, VacancySourceMeasurement } from '../defaultVacancySources';
import type { DetailTextSource } from '../detailTextSources';
import type { SourceReading } from '../multiSourceVacancyEngine';
import { htmlToFeedText } from '../../connectors/feedText';
import { record, text } from '../jsonVacancyRecord';
import { createFeedClient, type FeedClient } from './feedClient';
import { RUSSIAN_COMPANY_FEEDS, type FreehireFeed } from './russianCompanyFeeds';
import { RUSSIAN_PLATFORM_FEEDS } from './russianPlatformFeeds';
import { SITEMAP_FEEDS } from './sitemapJsonLdFeed';
import { atsBoardFeed, atsFeedId, ORACLE_DETAIL } from './atsFamilies';
import { MEASURED_ATS_BOARDS } from './atsBoards';
import { atsFuseTripped, recordAtsReading } from './atsFuse';
import { readJsonLdJobPosting } from '../detailTextSources';

/**
 * Ленты, перенесённые из github.com/strelov1/freehire (MIT, © 2026 freehire
 * contributors), B641. Источник называется `src-fh-<лента>`.
 */
export const FREEHIRE_SOURCE_PREFIX = 'src-fh-';
/** Опрос раз в три часа: как доски ATS после #571. */
const REFRESH_MINUTES = 180;

const FEEDS: readonly FreehireFeed[] = [
  ...RUSSIAN_COMPANY_FEEDS,
  ...RUSSIAN_PLATFORM_FEEDS,
  ...SITEMAP_FEEDS,
  ...MEASURED_ATS_BOARDS.map(atsBoardFeed),
];
const BY_SOURCE_ID = new Map(FEEDS.map((f) => [`${FREEHIRE_SOURCE_PREFIX}${f.id}`, f]));

export function freehireFeedFor(sourceId: string): FreehireFeed | undefined {
  return BY_SOURCE_ID.get(sourceId);
}

/**
 * B641: доски ATS включаются порциями по 300 в сутки от даты старта (решение CPO
 * 10.11 — пул вырастет больше чем вдвое). Порядок — порядок `MEASURED_ATS_BOARDS`.
 * Набор пересчитывается при старте и на смене суток UTC в цикле опроса
 * (`atsRolloutAdmits`), без перезапуска.
 */
export const ATS_ROLLOUT_START_MS = Date.UTC(2026, 10, 10);
export const ATS_BOARDS_PER_DAY = 300;

export function admittedAtsBoards(nowMs: number): number {
  const days = Math.floor((nowMs - ATS_ROLLOUT_START_MS) / 86_400_000);
  return days < 0 ? 0 : (days + 1) * ATS_BOARDS_PER_DAY;
}

const ATS_IDS = new Set(MEASURED_ATS_BOARDS.map((b) => atsFeedId(b)));
const ADMITTED_ATS = new Set(
  MEASURED_ATS_BOARDS.slice(0, admittedAtsBoards(Date.now())).map((b) => atsFeedId(b)),
);

export const ATS_ROLLOUT_WAIT_REASON = 'Доска ATS ждёт своей порции';

const ATS_ORDER = new Map(
  MEASURED_ATS_BOARDS.map((b, i) => [`${FREEHIRE_SOURCE_PREFIX}${atsFeedId(b)}`, i]),
);

/** Допущена ли доска ATS к опросу на момент `nowMs`; undefined — не доска порций. */
export function atsRolloutAdmits(sourceId: string, nowMs: number): boolean | undefined {
  const index = ATS_ORDER.get(sourceId);
  return index === undefined ? undefined : index < admittedAtsBoards(nowMs);
}

function rollout(feedId: string): Pick<RegisteredVacancySource, 'enabled' | 'disabledReason'> {
  if (!ATS_IDS.has(feedId) || ADMITTED_ATS.has(feedId)) return { enabled: true };
  return {
    enabled: false,
    disabledReason: `${ATS_ROLLOUT_WAIT_REASON}: ${ATS_BOARDS_PER_DAY} досок в сутки с 10.11 (B641).`,
  };
}

export const FREEHIRE_FEED_SOURCES: readonly RegisteredVacancySource[] = FEEDS.map((f) => ({
  id: `${FREEHIRE_SOURCE_PREFIX}${f.id}`,
  name: f.name,
  type: 'json_api',
  accessClass: 'open_web',
  market: f.market,
  addressStatus: 'live',
  ...rollout(f.id),
  targetUrl: f.homeUrl,
  refreshIntervalMinutes: REFRESH_MINUTES,
  itemsFoundTotal: 0,
  itemsActiveTotal: 0,
}));

/**
 * Живой прогон адаптера с прод-VM (Франкфурт) и с машины владельца 10.11:
 * число записей после фильтров адаптера. Ответы с прода совпали по объёму.
 */
const MEASURED_ITEMS: Readonly<Record<string, number>> = {
  ...Object.fromEntries(MEASURED_ATS_BOARDS.map((b) => [atsFeedId(b), b.jobs])),
  sber: 2485,
  yandex: 150,
  ozon: 2280,
  vk: 217,
  x5: 402,
  magnit: 43,
  rostelecom: 123,
  lamoda: 145,
  kuper: 1,
  domclick: 20,
  dodo: 16,
  rwb: 204,
  mtslink: 2,
  getmatch: 909,
  'habr-career': 1109,
  megafon: 1011,
  mts: 2296,
  avito: 125,
  uzum: 49,
  kaspi: 42,
};

export const FREEHIRE_FEED_MEASUREMENTS: Readonly<
  Record<string, readonly VacancySourceMeasurement[]>
> = Object.fromEntries(
  FEEDS.map((f) => [
    `${FREEHIRE_SOURCE_PREFIX}${f.id}`,
    [
      {
        items: MEASURED_ITEMS[f.id] ?? 0,
        observedAt: '2026-11-10',
        route: 'eu-prod' as const,
        note: 'B641: адаптер перенесён из freehire, список прочитан целиком',
      },
    ],
  ]),
);

export async function fetchFreehireFeed(
  sourceId: string,
  sourceName: string,
  client: FeedClient = createFeedClient(),
): Promise<SourceReading> {
  const feed = freehireFeedFor(sourceId);
  if (!feed) throw new Error(`vacancy_source_adapter_missing: ${sourceId}`);
  const isAts = ATS_IDS.has(feed.id);
  const tripped = isAts ? atsFuseTripped() : undefined;
  // Предохранитель: срез сохраняется, новых вакансий нет (частичное чтение без строк).
  if (tripped) return { vacancies: [], partial: true };
  const observedAt = new Date().toISOString();
  const listing = await feed.list(client, { observedAt, sourceName }, sourceId);
  if (isAts) recordAtsReading(sourceId, listing.vacancies.length, listing.partial);
  return { vacancies: [...listing.vacancies], partial: listing.partial };
}

/* ----------------------------------------------- Полный текст карточки */

function pathMatch(raw: string, host: string, re: RegExp): RegExpMatchArray | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === host ? url.pathname.match(re) : null;
  } catch {
    return null;
  }
}

const html = (value: unknown): string => {
  const raw = text(value);
  return raw.trim() ? htmlToFeedText(raw).trim() : '';
};

const joined = (parts: unknown[]): string => parts.map(html).filter(Boolean).join('\n\n');

function jsonDetail(
  host: string,
  re: RegExp,
  apiUrl: (m: RegExpMatchArray) => string,
  readText: (payload: unknown) => string,
): DetailTextSource {
  return {
    format: 'json',
    detailUrl: (_sourceId, vacancy) => {
      const m = pathMatch(vacancy.url, host, re);
      return m ? apiUrl(m) : undefined;
    },
    readText,
    intervalMs: 3_000,
    intervalJitterMs: 2_000,
    throttlePauseMs: 600_000,
  };
}

/** Текст вакансии VK: блок `itemprop="description"` до панели «Поделиться». */
export function readVkDescription(page: string): string {
  const start = page.search(/<div[^>]*itemprop="description"[^>]*>/);
  if (start < 0) return '';
  const end = page.indexOf('<div class="page-control"', start);
  return htmlToFeedText(page.slice(start, end < 0 ? undefined : end)).trim();
}

const DETAIL: Record<string, DetailTextSource> = {
  'src-fh-getmatch': jsonDetail(
    'getmatch.ru',
    /^\/vacancies\/(\d+)/,
    (m) => `https://getmatch.ru/api/offers/${m[1]}`,
    (p) => html(record(p).description),
  ),
  // VK: в API карточки нет текста, он только на странице вакансии (как в vk.go freehire).
  'src-fh-vk': {
    format: 'html',
    detailUrl: (_sourceId, vacancy) =>
      pathMatch(vacancy.url, 'team.vk.company', /^\/vacancy\/\d+\/$/) ? vacancy.url : undefined,
    readText: (payload) => (typeof payload === 'string' ? readVkDescription(payload) : ''),
    intervalMs: 3_000,
    intervalJitterMs: 2_000,
    throttlePauseMs: 600_000,
  },
  'src-fh-habr-career': {
    format: 'html',
    detailUrl: (_sourceId, vacancy) =>
      pathMatch(vacancy.url, 'career.habr.com', /^\/vacancies\/\d+$/) ? vacancy.url : undefined,
    readText: (payload) => (typeof payload === 'string' ? readJsonLdJobPosting(payload) : ''),
    intervalMs: 3_000,
    intervalJitterMs: 2_000,
    throttlePauseMs: 600_000,
  },
  'src-fh-yandex': jsonDetail(
    'yandex.ru',
    /^\/jobs\/vacancies\/[^/]*-(\d+)\/?$/,
    (m) => `https://yandex.ru/jobs/api/publications/${m[1]}`,
    (p) => {
      const d = record(p);
      return joined([
        d.short_summary,
        d.duties,
        d.key_qualifications,
        d.additional_requirements,
        d.conditions,
      ]);
    },
  ),
  'src-fh-ozon': jsonDetail(
    'career.ozon.ru',
    /^\/vacancy\/(\d+)\/?$/,
    (m) => `https://job-api.ozon.ru/vacancy/${m[1]}`,
    (p) => html(record(p).descr),
  ),
  'src-fh-x5': jsonDetail(
    'rabota.x5.ru',
    /^\/vacancies\/([0-9a-f-]{36})$/,
    (m) => `https://rabota.x5.ru/vacancy/api/v1/public/vacancies/${m[1]}`,
    (p) => {
      const c = record(record(p).content);
      return joined([
        c.description,
        c.main_responsibilities,
        c.professional_skills,
        c.experience,
        c.other_requirements,
        c.working_conditions,
      ]);
    },
  ),
  'src-fh-magnit': jsonDetail(
    'magnit.tech',
    /^\/vacancies\/(\d+)$/,
    (m) => `https://magnit.tech/api/v1/vacancy/${m[1]}`,
    (p) => {
      const d = record(record(p).results);
      return joined([d.description, d.about_product, d.tasks, d.skills, d.extra_skills, d.offer]);
    },
  ),
  'src-fh-lamoda': jsonDetail(
    'job.lamoda.ru',
    /^\/vacancies\/.*?-(\d+)$/,
    (m) => `https://job.lamoda.ru/api/hr/vacancies/${m[1]}`,
    (p) => {
      const a = record(record(record(p).data).attributes);
      return joined([a.introduction, a.duties, a.requirements, a.conditions]) || html(a.common);
    },
  ),
  'src-fh-domclick': jsonDetail(
    'career.domclick.ru',
    /^\/vacancy\/([\w-]+)$/,
    (m) => `https://career.domclick.ru/api/v1/vacancy/detail/${m[1]}/`,
    (p) => {
      const c = record(record(record(p).result).vacancycontent);
      return html(c.branded_description) || html(c.description);
    },
  ),
  'src-fh-dodo': jsonDetail(
    'dodoteam.ru',
    /^\/vacancy\/(\d+)$/,
    (m) => `https://job-site-backend.dodo-ai-platform.io/api/v1/pages/vacancy/${m[1]}`,
    (p) => {
      const blocks = record(record(record(p).data).page).content;
      return Array.isArray(blocks) ? joined(blocks.map((b) => record(record(b).data).text)) : '';
    },
  ),
  'src-fh-rwb': jsonDetail(
    'career.rwb.ru',
    /^\/vacancies\/(\d+)$/,
    (m) => `https://career.rwb.ru/crm-api/api/v1/pub/vacancies/${m[1]}`,
    (p) => {
      const d = record(record(p).data);
      const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(text) : []);
      return joined([
        d.description,
        ...list(d.duties_arr),
        ...list(d.requirements_arr),
        ...list(d.conditions_arr),
      ]);
    },
  ),
  'src-fh-mtslink': jsonDetail(
    'mts-link.ru',
    /^\/vacancies\/(\d+)\/?$/,
    (m) => `https://mts-link.ru/api/huntflow/vacancy/${m[1]}`,
    (p) => {
      const d = record(p);
      return joined([d.body, d.requirements, d.conditions]);
    },
  ),
};

export function freehireDetailTextSource(sourceId: string): DetailTextSource | undefined {
  if (sourceId.startsWith(`${FREEHIRE_SOURCE_PREFIX}oracle-`)) return ORACLE_DETAIL;
  return DETAIL[sourceId];
}
