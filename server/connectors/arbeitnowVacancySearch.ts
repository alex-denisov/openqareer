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

const responseSchema = z.object({
  data: z
    .array(
      z.object({
        slug: z.string().min(1).max(500),
        company_name: z.string().min(1).max(500),
        title: z.string().min(1).max(500),
        remote: z.boolean(),
        url: z.string().url().refine(isAllowedJobUrl),
        tags: z.array(z.string().min(1).max(100)).max(50),
        job_types: z.array(z.string().min(1).max(100)).max(20),
        location: z.string().min(1).max(500),
        created_at: z.number().int().min(946_684_800).max(4_102_444_800),
      }),
    )
    .max(200),
  links: z.object({ next: z.string().url().nullable() }),
});

interface SearchOptions {
  fetchImpl?: typeof fetch;
  now?: () => string;
  maxPages?: number;
}

type ArbeitnowPage = z.infer<typeof responseSchema>;
type ArbeitnowItem = ArbeitnowPage['data'][number];

export async function searchArbeitnowVacancies(
  input: { text: string; perPage?: number },
  options: SearchOptions = {},
): Promise<VacancySample> {
  const value = inputSchema.parse(input);
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxPages = Math.max(1, Math.min(3, Math.trunc(options.maxPages ?? 2)));
  const observedAt = (options.now ?? (() => new Date().toISOString()))();
  const queryTerms = value.text.toLocaleLowerCase('en').split(/\s+/u);
  const matches: VacancySample['items'] = [];

  for (let page = 1; page <= maxPages && matches.length < value.perPage; page += 1) {
    const sourcePage = await fetchArbeitnowPage(page, fetchImpl, observedAt);
    matches.push(
      ...matchingVacancies(
        sourcePage.data,
        queryTerms,
        value.perPage - matches.length,
      ),
    );
    if (!sourcePage.links.next) break;
  }

  return {
    source: 'arbeitnow',
    query: value.text,
    found: matches.length,
    fetchedAt: observedAt,
    items: matches,
  };
}

async function fetchArbeitnowPage(
  page: number,
  fetchImpl: typeof fetch,
  observedAt: string,
): Promise<ArbeitnowPage> {
  const response = await fetchImpl(
    `https://www.arbeitnow.com/api/job-board-api?page=${page}`,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'openqareer/1.0 (support@openqareer.com)',
      },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (response.status === 429) {
    throw new VacancyConnectorError(
      'arbeitnow_vacancy_search_rate_limited',
      parseRetryAfter(response.headers.get('Retry-After'), observedAt),
    );
  }
  if (!response.ok) throw new Error('arbeitnow_vacancy_search_unavailable');
  const parsed = responseSchema.safeParse(await readBoundedJson(response));
  if (!parsed.success) throw new Error('arbeitnow_vacancy_search_invalid');
  return parsed.data;
}

function matchingVacancies(
  items: ArbeitnowItem[],
  queryTerms: string[],
  limit: number,
): VacancySample['items'] {
  return items
    .filter((item) => {
      const searchable = [
        item.title,
        item.company_name,
        item.location,
        ...item.tags,
        ...item.job_types,
      ]
        .join(' ')
        .toLocaleLowerCase('en');
      return queryTerms.every((term) => searchable.includes(term));
    })
    .slice(0, limit)
    .map(normalizeVacancy);
}

function normalizeVacancy(item: ArbeitnowItem): VacancySample['items'][number] {
  return {
    id: item.slug,
    title: item.title,
    company: item.company_name,
    location: item.location,
    sourceUrl: item.url,
    publishedAt: new Date(item.created_at * 1_000).toISOString(),
    salary: null,
    workMode: item.remote ? 'remote' : 'unknown',
    requirements: item.tags,
  };
}

function isAllowedJobUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
