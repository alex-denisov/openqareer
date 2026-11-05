import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { buildJsonVacancy, fromIso } from './jsonVacancyRecord';

export interface CorporateJsonApiEndpoint {
  readonly id: string;
  readonly company: string;
  readonly url: string;
  readonly method?: 'GET' | 'POST';
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly paging?: {
    readonly type: 'offset' | 'page';
    readonly limitParam: string;
    readonly offsetParam: string;
    readonly limit: number;
    readonly maxPages: number;
  };
  readonly extractItems: (json: Record<string, unknown>) => unknown[];
  readonly mapItem: (
    item: Record<string, unknown>,
    endpoint: CorporateJsonApiEndpoint,
  ) => {
    readonly externalId: string;
    readonly title: string;
    readonly url: string;
    readonly location?: string;
    readonly isRemote?: boolean;
    readonly description?: string;
    readonly publishedAt?: string;
  };
}

export const CORPORATE_JSON_ENDPOINTS: readonly CorporateJsonApiEndpoint[] = [
  {
    id: 'epam',
    company: 'EPAM',
    url: 'https://careers.epam.com/api/jobs/v2/search/careers-i18n?sortBy=relevance&websiteLocale=en-us',
    method: 'GET',
    headers: {
      Referer: 'https://careers.epam.com/en/jobs/',
    },
    paging: {
      type: 'offset',
      limitParam: 'size',
      offsetParam: 'from',
      limit: 100,
      maxPages: 10,
    },
    extractItems: (json) => {
      const data = json.data as Record<string, unknown> | undefined;
      return (data?.jobs ?? json.result ?? []) as unknown[];
    },
    mapItem: (job) => {
      const extId = String(job.uid || job.id || '');
      const countries = Array.isArray(job.country)
        ? job.country.map((c: Record<string, unknown>) => String(c?.name || '')).filter(Boolean)
        : [];
      const location = [job.city, ...countries].filter(Boolean).join(', ');
      const seo = job.seo as Record<string, unknown> | undefined;
      const jobUrl = seo?.url
        ? `https://careers.epam.com${String(seo.url)}`
        : `https://careers.epam.com/en/jobs/${extId}`;
      const title = String(job.name || 'EPAM Specialist');
      return {
        externalId: extId,
        title,
        url: jobUrl,
        location: location || undefined,
        isRemote: /remote/i.test(String(job.vacancy_type ?? '')) || /remote/i.test(title),
        description: String(job.description || [title, location].filter(Boolean).join(' — ')),
        publishedAt: String(job.created_at || job.postedDate || ''),
      };
    },
  },
  {
    id: 'playrix',
    company: 'Playrix',
    url: 'https://playrix.com/api/v1/index.php?action=job/getList',
    method: 'POST',
    headers: {
      Referer: 'https://playrix.com/job/open',
    },
    extractItems: (json) => (json.items ?? []) as unknown[],
    mapItem: (job) => {
      const code = String(job.code || job.id || '');
      const title = String(job.name || job.title || '');
      const location = 'Remote';
      return {
        externalId: code,
        title,
        url: `https://playrix.com/job/${code}`,
        location,
        isRemote: true,
        description: String(job.titleMsg || title),
        publishedAt: job.dateUpdate ? String(job.dateUpdate).slice(0, 10) : undefined,
      };
    },
  },
] as const;

function buildPageRequest(
  endpoint: CorporateJsonApiEndpoint,
  page: number,
): { url: string; init: RequestInit } {
  let targetUrl = endpoint.url;
  const paging = endpoint.paging;
  if (paging) {
    const urlObj = new URL(targetUrl);
    const offset = page * paging.limit;
    urlObj.searchParams.set(paging.limitParam, String(paging.limit));
    urlObj.searchParams.set(paging.offsetParam, String(paging.type === 'page' ? page + 1 : offset));
    targetUrl = urlObj.toString();
  }

  const init: RequestInit = {
    method: endpoint.method ?? 'GET',
    headers: {
      accept: 'application/json, text/plain, */*',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ...(endpoint.headers ?? {}),
    },
  };

  if (endpoint.body) {
    init.body = typeof endpoint.body === 'string' ? endpoint.body : JSON.stringify(endpoint.body);
  }

  return { url: targetUrl, init };
}

function mapItemsToVacancies(
  items: unknown[],
  endpoint: CorporateJsonApiEndpoint,
  sourceId: string,
  observedAt: string,
): UnifiedVacancy[] {
  const list: UnifiedVacancy[] = [];
  for (const item of items) {
    const record = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
    const mapped = endpoint.mapItem(record, endpoint);
    if (!mapped.externalId || !mapped.title) continue;

    const vacancy = buildJsonVacancy({
      sourceId,
      context: {
        observedAt,
        sourceName: `${endpoint.company} Careers`,
        sourceUrl: mapped.url,
      },
      externalId: mapped.externalId,
      title: mapped.title,
      company: endpoint.company,
      location: mapped.location,
      isRemote: mapped.isRemote ?? /remote/i.test(mapped.location ?? ''),
      description: mapped.description || mapped.title,
      skills: [],
      url: mapped.url,
      publishedAt: mapped.publishedAt ? fromIso(mapped.publishedAt) : observedAt,
    });

    list.push({ ...vacancy, requiredSkills: [] });
  }
  return list;
}

export async function fetchCorporateJsonApiVacancies(
  endpoint: CorporateJsonApiEndpoint,
  options?: {
    readonly maxPages?: number;
    readonly customFetch?: typeof fetch;
  },
): Promise<UnifiedVacancy[]> {
  const customFetch = options?.customFetch ?? fetch;
  const sourceId = `src-${endpoint.id}`;
  const observedAt = new Date().toISOString();
  const allVacancies: UnifiedVacancy[] = [];

  const maxPages = options?.maxPages ?? endpoint.paging?.maxPages ?? 1;
  const paging = endpoint.paging;

  for (let page = 0; page < maxPages; page++) {
    const { url, init } = buildPageRequest(endpoint, page);
    const response = await customFetch(url, init);
    if (!response.ok) break;

    const data = (await response.json()) as Record<string, unknown>;
    const items = endpoint.extractItems(data);
    if (!Array.isArray(items) || items.length === 0) break;

    const pageVacancies = mapItemsToVacancies(items, endpoint, sourceId, observedAt);
    allVacancies.push(...pageVacancies);

    if (!paging || items.length < paging.limit) break;
  }

  return allVacancies;
}
