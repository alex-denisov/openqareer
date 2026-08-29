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
  // hh.ru closed the unauthenticated vacancy search (INC-022). Reading their
  // result page instead would restore access by working around the platform's
  // own restriction, so the refusal is reported as it is (B175).
  if (response.status === 403) {
    throw new Error('hh_vacancy_search_official_access_required');
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
