import { gunzipSync } from 'node:zlib';
import type { UnifiedVacancy } from '../../domain/unifiedVacancy';
import { buildJsonVacancy, fromIso, type JsonAdapterContext } from '../jsonVacancyRecord';
import type { FeedClient } from './feedClient';
import type { FeedListing, FreehireFeed } from './feedKit';
import { readJsonLdPostings, type JsonLdPosting } from './jsonLdPosting';

/**
 * Вакансии сайта по его sitemap и разметке JobPosting (B641, вторая очередь).
 * Перенос `sitemapldjson.go` и `sitemapboard.go` проекта
 * github.com/strelov1/freehire (MIT, © 2026 freehire contributors).
 *
 * Sitemap называет страницы вакансий, страница даёт факты. Страница читается
 * один раз: прочитанные вакансии живут в памяти процесса, следующий опрос лишь
 * сверяет их с sitemap. Новых страниц за опрос — не больше `maxNewPerSync`, в
 * случайном порядке (у freehire так нечитаемая страница не занимает одно и то
 * же место каждый раз). Пока не прочитано всё, чтение частичное и срез только
 * дополняется; когда прочитано всё — срез заменяется и ушедшие из sitemap
 * вакансии снимаются.
 */
export interface SitemapBoard {
  readonly id: string;
  readonly name: string;
  readonly company: string;
  readonly market: string;
  readonly sitemapUrl: string;
  /** Шаблон адреса вакансии; первая группа — её идентификатор. */
  readonly vacancyPattern: RegExp;
  readonly maxNewPerSync?: number;
  readonly pageDelayMs?: number;
  /**
   * Список вакансий — HTML-страница со ссылками, а не sitemap (Jobvite): адреса
   * берутся из `href` по тому же шаблону.
   */
  readonly listing?: 'sitemap' | 'html';
  /** Адрес страницы с разметкой, если это не сама ссылка (iCIMS: `?in_iframe=1`). */
  readonly postingUrl?: (url: string, id: string) => string;
  /** Работодатель — сама доска: `hiringOrganization` страницы не читается (freehire jobvite). */
  readonly boardOwnsCompany?: boolean;
  /** Разбор страницы, если на ней нет JobPosting (часть досок Jobvite). */
  readonly fallbackPosting?: (html: string) => JsonLdPosting | undefined;
}

const MAX_DOCS = 200;
const MAX_DEPTH = 3;
const DEFAULT_MAX_NEW = 150;
const DEFAULT_DELAY_MS = 1_000;
const MAX_SITEMAP_BYTES = 32 << 20;

interface Hit {
  readonly url: string;
  readonly id: string;
}

const LOC_RE = /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi;

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

/** `<loc>` документа и признак индекса (`<sitemapindex>`). */
export function readSitemap(body: string): { locs: string[]; isIndex: boolean } {
  const isIndex = /<sitemapindex[\s>]/i.test(body);
  const locs = [...body.matchAll(LOC_RE)].map((m) => decodeXmlEntities(m[1] ?? '').trim());
  return { locs: locs.filter(Boolean), isIndex };
}

async function sitemapText(client: FeedClient, url: string): Promise<string> {
  if (!/\.gz(\?|$)/.test(url)) return client.getText(url);
  // Сжатый sitemap приходит телом gzip, а не транспортным сжатием.
  const bytes = Buffer.from(await client.getBytes(url));
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes.toString('utf8');
  return gunzipSync(bytes, { maxOutputLength: MAX_SITEMAP_BYTES }).toString('utf8');
}

function sameSite(url: string, root: URL): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      (u.hostname === root.hostname ||
        u.hostname.endsWith(`.${root.hostname.replace(/^www\./, '')}`))
    );
  } catch {
    return false;
  }
}

/** Обход индекса sitemap: адреса вакансий по шаблону, без повторов идентификатора. */
const HREF_RE = /href=["']([^"'#]+)["']/gi;

async function listHtmlHits(client: FeedClient, board: SitemapBoard): Promise<Hit[]> {
  const root = new URL(board.sitemapUrl);
  const html = await client.getText(board.sitemapUrl);
  const seen = new Set<string>();
  const hits: Hit[] = [];
  for (const match of html.matchAll(HREF_RE)) {
    let url: string;
    try {
      url = new URL(decodeXmlEntities(match[1] ?? ''), root).toString();
    } catch {
      continue;
    }
    const id = sameSite(url, root) ? url.match(board.vacancyPattern)?.[1] : undefined;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    hits.push({ url, id });
  }
  return hits;
}

export async function listSitemapHits(client: FeedClient, board: SitemapBoard): Promise<Hit[]> {
  if (board.listing === 'html') return listHtmlHits(client, board);
  const root = new URL(board.sitemapUrl);
  const seenDocs = new Set<string>();
  const seenIds = new Set<string>();
  const hits: Hit[] = [];
  const walk = async (url: string, depth: number): Promise<void> => {
    if (seenDocs.has(url) || seenDocs.size >= MAX_DOCS) return;
    seenDocs.add(url);
    const { locs, isIndex } = readSitemap(await sitemapText(client, url));
    for (const loc of locs) {
      if (!sameSite(loc, root)) continue;
      if (isIndex) {
        if (depth < MAX_DEPTH) await walk(loc, depth + 1);
        continue;
      }
      const id = loc.match(board.vacancyPattern)?.[1];
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      hits.push({ url: loc, id });
    }
  };
  await walk(board.sitemapUrl, 0);
  return hits;
}

/** Прочитанные страницы: источник → идентификатор → вакансия. */
const hydrated = new Map<string, Map<string, UnifiedVacancy>>();

/** Страницы без JobPosting: перечитывать их каждый опрос — пустой расход запросов. */
const withoutPosting = new Map<string, Set<string>>();

export function resetSitemapCache(): void {
  hydrated.clear();
  withoutPosting.clear();
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

async function hydrate(
  client: FeedClient,
  board: SitemapBoard,
  hit: Hit,
  context: JsonAdapterContext,
  sourceId: string,
): Promise<UnifiedVacancy | undefined> {
  const pageUrl = board.postingUrl ? board.postingUrl(hit.url, hit.id) : hit.url;
  const html = await client.getText(pageUrl);
  const posting = readJsonLdPostings(html)[0] ?? board.fallbackPosting?.(html);
  if (!posting?.title) return undefined;
  return buildJsonVacancy({
    sourceId,
    context: { ...context, sourceUrl: hit.url },
    externalId: hit.id,
    title: posting.title,
    company: board.boardOwnsCompany ? board.company : posting.company || board.company,
    location: posting.location || undefined,
    isRemote: posting.remote || /удал|remote/i.test(posting.location),
    description: posting.description,
    skills: [],
    url: hit.url,
    // Страница без даты висит на сайте сейчас — дата момента чтения (см. russianCompanyFeeds).
    publishedAt: posting.datePosted ? fromIso(posting.datePosted) : context.observedAt,
  });
}

export async function listSitemapBoard(
  client: FeedClient,
  board: SitemapBoard,
  context: JsonAdapterContext,
  sourceId: string,
  random: () => number = Math.random,
): Promise<FeedListing> {
  const hits = await listSitemapHits(client, board);
  if (hits.length === 0)
    throw new Error(`vacancy_source_payload_unreadable: sitemap has no vacancies`);
  const known = hydrated.get(sourceId) ?? new Map<string, UnifiedVacancy>();
  const live = new Set(hits.map((h) => h.id));
  const cache = new Map([...known].filter(([id]) => live.has(id)));
  const empty = new Set([...(withoutPosting.get(sourceId) ?? [])].filter((id) => live.has(id)));
  const fresh = shuffled(
    hits.filter((h) => !cache.has(h.id) && !empty.has(h.id)),
    random,
  );
  const budget = fresh.slice(0, board.maxNewPerSync ?? DEFAULT_MAX_NEW);
  let unread = fresh.length - budget.length;
  for (const [index, hit] of budget.entries()) {
    if (index > 0) await client.pause(board.pageDelayMs ?? DEFAULT_DELAY_MS);
    try {
      const vacancy = await hydrate(client, board, hit, context, sourceId);
      if (vacancy) cache.set(hit.id, vacancy);
      else empty.add(hit.id);
    } catch {
      unread += 1; // страница не прочиталась сейчас — прочтётся в следующий опрос
    }
  }
  hydrated.set(sourceId, cache);
  withoutPosting.set(sourceId, empty);
  return { vacancies: [...cache.values()], partial: unread > 0 };
}

export function sitemapFeed(board: SitemapBoard): FreehireFeed {
  return {
    id: board.id,
    name: board.name,
    company: board.company,
    market: board.market,
    homeUrl: board.sitemapUrl,
    pageDelayMs: board.pageDelayMs ?? DEFAULT_DELAY_MS,
    list: (client, context, sourceId) => listSitemapBoard(client, board, context, sourceId),
  };
}

/** Сайты, у которых sitemap называет вакансии, а страница несёт JobPosting (замер 10.11). */
export const SITEMAP_BOARDS: readonly SitemapBoard[] = [
  {
    id: 'avito',
    name: 'Авито — карьера',
    company: 'Авито',
    market: 'Россия',
    sitemapUrl: 'https://career.avito.com/sitemap.xml',
    vacancyPattern: /\/vacancies\/[^/]+\/(\d+)\/?$/,
  },
  {
    id: 'uzum',
    name: 'Uzum — карьера',
    company: 'Uzum',
    market: 'Узбекистан',
    sitemapUrl: 'https://people.uzum.com/sitemap.xml',
    vacancyPattern: /\/career\/ru\/vacancies\/(\d+)\/?$/,
  },
  {
    id: 'kaspi',
    name: 'Kaspi.kz — карьера',
    company: 'Kaspi.kz',
    market: 'Казахстан',
    sitemapUrl: 'https://job.kaspi.kz/sitemap/vacancies.xml',
    vacancyPattern: /\/vacancy\/([\w-]+)\/?$/,
  },
];

export const SITEMAP_FEEDS: readonly FreehireFeed[] = SITEMAP_BOARDS.map(sitemapFeed);
