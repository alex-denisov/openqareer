import { z } from 'zod';
import type { VacancySample } from '../domain/vacancy';
import { readBoundedJson } from './readBoundedJson';
import {
  parseRetryAfter,
  VacancyConnectorError,
} from './vacancyConnectorError';

const inputSchema = z.object({
  text: z.string().trim().min(2).max(200),
  perPage: z.number().int().min(1).max(20).default(12),
});

const responseSchema = z.object({
  'job-count': z.number().int().nonnegative(),
  jobs: z
    .array(
      z.object({
        id: z.number().int().nonnegative(),
        url: z.string().url().refine(isAllowedJobUrl),
        title: z.string().min(1).max(500),
        company_name: z.string().min(1).max(500),
        category: z.string().min(1).max(100),
        job_type: z.string().max(100).nullable().optional(),
        publication_date: z.string().min(1).max(100),
        candidate_required_location: z.string().min(1).max(500),
      }),
    )
    .max(50),
});

interface SearchOptions {
  fetchImpl?: typeof fetch;
  now?: () => string;
  cache?: RemotiveSourceCache;
}

interface RemotiveCorpus {
  fetchedAt: string;
  items: VacancySample['items'];
}

export interface RemotiveSourceCache {
  entry?: {
    expiresAt: number;
    corpus: Promise<RemotiveCorpus>;
  };
}

const productionCache = createRemotiveSourceCache();

export function createRemotiveSourceCache(): RemotiveSourceCache {
  return {};
}

export async function searchRemotiveVacancies(
  input: { text: string; perPage?: number },
  options: SearchOptions = {},
): Promise<VacancySample> {
  const value = inputSchema.parse(input);
  const observedAt = (options.now ?? (() => new Date().toISOString()))();
  const corpus = await loadCorpus(
    options.fetchImpl ?? fetch,
    observedAt,
    options.cache ?? (options.fetchImpl ? undefined : productionCache),
  );
  const queryTerms = value.text.toLocaleLowerCase('en').split(/\s+/u);
  const items = corpus.items
    .filter((item) => {
      const searchable = [
        item.title,
        item.company,
        item.location,
        ...item.requirements,
      ]
        .join(' ')
        .toLocaleLowerCase('en');
      return queryTerms.every((term) => searchable.includes(term));
    })
    .slice(0, value.perPage);

  return {
    source: 'remotive',
    query: value.text,
    found: items.length,
    fetchedAt: corpus.fetchedAt,
    items,
  };
}

async function loadCorpus(
  fetchImpl: typeof fetch,
  observedAt: string,
  cache?: RemotiveSourceCache,
): Promise<RemotiveCorpus> {
  const observedMs = new Date(observedAt).getTime();
  if (cache?.entry && cache.entry.expiresAt > observedMs) {
    return cache.entry.corpus;
  }
  const corpus = fetchCorpus(fetchImpl, observedAt);
  if (cache) {
    cache.entry = {
      expiresAt: observedMs + 6 * 60 * 60 * 1_000,
      corpus,
    };
  }
  try {
    return await corpus;
  } catch (error) {
    if (cache?.entry?.corpus === corpus) {
      cache.entry.expiresAt = observedMs + 15 * 60 * 1_000;
    }
    throw error;
  }
}

async function fetchCorpus(
  fetchImpl: typeof fetch,
  observedAt: string,
): Promise<RemotiveCorpus> {
  const response = await fetchImpl(
    'https://remotive.com/api/remote-jobs?limit=50',
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
      'remotive_vacancy_search_rate_limited',
      parseRetryAfter(response.headers.get('Retry-After'), observedAt),
    );
  }
  if (!response.ok) throw new Error('remotive_vacancy_search_unavailable');
  const parsed = responseSchema.safeParse(await readBoundedJson(response));
  if (!parsed.success) throw new Error('remotive_vacancy_search_invalid');

  return {
    fetchedAt: observedAt,
    items: parsed.data.jobs.map((item) => ({
      id: String(item.id),
      title: item.title,
      company: item.company_name,
      location: item.candidate_required_location,
      sourceUrl: item.url,
      publishedAt: normalizedDate(item.publication_date),
      salary: null,
      workMode: 'remote' as const,
      requirements: [item.category, item.job_type]
        .filter((value): value is string => Boolean(value))
        .slice(0, 2),
    })),
  };
}

function normalizedDate(value: string): string | null {
  const explicitOffset = /(?:Z|[+-]\d{2}:?\d{2})$/u.test(value)
    ? value
    : `${value}Z`;
  const date = new Date(explicitOffset);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isAllowedJobUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'remotive.com' || url.hostname === 'www.remotive.com')
    );
  } catch {
    return false;
  }
}
