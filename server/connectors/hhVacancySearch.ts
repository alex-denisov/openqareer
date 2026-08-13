import { z } from 'zod';
import type { VacancySample } from '../domain/vacancy';
import {
  parseRetryAfter,
  VacancyConnectorError,
} from './vacancyConnectorError';
import { readBoundedJson } from './readBoundedJson';

const inputSchema = z.object({
  text: z.string().trim().min(2).max(200),
  perPage: z.number().int().min(1).max(20).default(12),
});

const hhResponseSchema = z.object({
  found: z.number().int().nonnegative(),
  items: z
    .array(
      z.object({
      id: z.string().min(1).max(128),
      name: z.string().min(1).max(500),
      alternate_url: z.string().url().refine(isAllowedHhVacancyUrl),
      published_at: z.string().min(1).max(80),
      employer: z.object({ name: z.string().min(1).max(500) }).nullable(),
      area: z.object({ name: z.string().min(1).max(500) }),
      salary: z
        .object({
          from: z.number().nonnegative().nullable(),
          to: z.number().nonnegative().nullable(),
          currency: z.string().min(1).max(12),
          gross: z.boolean(),
        })
        .nullable(),
      }),
    )
    .max(20),
});

export interface HhVacancySample extends VacancySample {
  source: 'hh';
}

interface SearchOptions {
  fetchImpl?: typeof fetch;
  now?: () => string;
  allowPublicFallback?: boolean;
}

export async function searchHhVacancies(
  input: { text: string; perPage?: number },
  options: SearchOptions = {},
): Promise<HhVacancySample> {
  const value = inputSchema.parse(input);
  const params = new URLSearchParams({
    text: value.text,
    search_field: 'name',
    area: '113',
    per_page: String(value.perPage),
    page: '0',
    order_by: 'publication_time',
  });
  const fetchImpl = options.fetchImpl ?? fetch;
  const observedAt = (options.now ?? (() => new Date().toISOString()))();
  let response: Response;
  try {
    response = await fetchImpl(`https://api.hh.ru/vacancies?${params}`, {
      headers: {
        'HH-User-Agent': 'openqareer/1.0 (support@openqareer.com)',
        'User-Agent': 'openqareer/1.0 (support@openqareer.com)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new Error('hh_vacancy_search_unavailable');
  }
  if (response.status === 403) {
    if (options.allowPublicFallback === false) {
      throw new Error('hh_vacancy_search_official_access_required');
    }
    return searchHhPublicPage(value, fetchImpl, observedAt);
  }
  if (response.status === 429) {
    throw new VacancyConnectorError(
      'hh_vacancy_search_rate_limited',
      parseRetryAfter(response.headers.get('Retry-After'), observedAt),
    );
  }
  if (!response.ok) {
    throw new Error('hh_vacancy_search_unavailable');
  }
  const parsed = hhResponseSchema.safeParse(await readBoundedJson(response));
  if (!parsed.success) {
    throw new Error('hh_vacancy_search_invalid');
  }
  return {
    source: 'hh',
    query: value.text,
    found: parsed.data.found,
    fetchedAt: observedAt,
    items: parsed.data.items.map((item) => ({
      id: item.id,
      title: item.name,
      company: item.employer?.name ?? 'Компания не указана',
      location: item.area.name,
      sourceUrl: item.alternate_url,
      publishedAt: item.published_at,
      salary: item.salary,
      workMode: 'unknown',
      requirements: [],
    })),
  };
}

async function searchHhPublicPage(
  input: z.infer<typeof inputSchema>,
  fetchImpl: typeof fetch,
  observedAt: string,
): Promise<HhVacancySample> {
  const params = new URLSearchParams({
    text: input.text,
    search_field: 'name',
    area: '113',
  });
  let response: Response;
  try {
    response = await fetchImpl(`https://hh.ru/search/vacancy?${params}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; openqareer/1.0; +https://openqareer.com)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new Error('hh_vacancy_search_unavailable');
  }
  if (!response.ok) {
    throw new Error('hh_vacancy_search_unavailable');
  }
  const html = await response.text();
  if (
    /<title>[^<]*(captcha|verify you are human|security check)|data-qa="captcha|id="captcha/iu.test(
      html,
    )
  ) {
    throw new Error('hh_vacancy_search_challenge');
  }
  const items: HhVacancySample['items'] = [];
  const itemPattern =
    /<a[^>]*data-qa="serp-item__title"[^>]*href="([^"]+)"[^>]*>[\s\S]*?<span[^>]*data-qa="serp-item__title-text"[^>]*>([\s\S]*?)<\/span>[\s\S]*?data-qa="vacancy-serp__vacancy-employer-text"[^>]*>([\s\S]*?)<\/span>[\s\S]*?data-qa="vacancy-serp__vacancy-address"[^>]*>([\s\S]*?)<\/span>/giu;
  for (const match of html.matchAll(itemPattern)) {
    const sourceUrl = decodeHtml(match[1]);
    const id = /\/vacancy\/(\d+)/u.exec(sourceUrl)?.[1];
    if (!id || !isAllowedHhVacancyUrl(sourceUrl)) continue;
    items.push({
      id,
      title: textFromHtml(match[2]),
      company: textFromHtml(match[3]) || 'Компания не указана',
      location: textFromHtml(match[4]) || 'Локация не указана',
      sourceUrl,
      publishedAt: null,
      salary: null,
      workMode: 'unknown',
      requirements: [],
    });
    if (items.length >= input.perPage) break;
  }
  if (!items.length) {
    throw new Error('hh_vacancy_search_invalid');
  }
  const foundText = /Найден[оа]\s+([\d\s\u00a0]+)\s+ваканс/iu.exec(html)?.[1];
  const found = foundText ? Number(foundText.replace(/\D/gu, '')) : items.length;
  return {
    source: 'hh',
    query: input.text,
    found: Number.isFinite(found) ? found : items.length,
    fetchedAt: observedAt,
    items,
  };
}

function textFromHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/gu, ' '))
    .replace(/\s+/gu, ' ')
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/<!--\s*-->/gu, '')
    .replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&nbsp;|&#160;/gu, '\u00a0');
}

function isAllowedHhVacancyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' &&
      (hostname === 'hh.ru' || hostname.endsWith('.hh.ru')) &&
      /^\/vacancy\/\d+\/?$/u.test(url.pathname)
    );
  } catch {
    return false;
  }
}
