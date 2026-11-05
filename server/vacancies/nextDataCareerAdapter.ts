import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { buildJsonVacancy, fromIso } from './jsonVacancyRecord';

export interface NextDataCareerEndpoint {
  readonly id: string;
  readonly company: string;
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly extractJobs: (pageProps: Record<string, unknown>) => unknown[];
  readonly mapJob: (
    job: Record<string, unknown>,
    endpoint: NextDataCareerEndpoint,
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

export const NEXT_DATA_CAREER_ENDPOINTS: readonly NextDataCareerEndpoint[] = [
  {
    id: 'preply',
    company: 'Preply',
    url: 'https://preply.com/en/careers',
    extractJobs: (pageProps) => (pageProps?.jobs ?? []) as unknown[],
    mapJob: (job) => {
      const title = String(job.title || '');
      const link = String(job.link || '');
      let externalId = '';
      try {
        const parsedUrl = new URL(link);
        externalId = parsedUrl.searchParams.get('ashby_jid') || '';
      } catch {
        // url fallback
      }
      if (!externalId && link) {
        externalId = link.replace(/[^a-zA-Z0-9_-]/g, '_').slice(-32);
      } else if (!externalId && job.id) {
        externalId = String(job.id);
      }

      const team = String(job.team || job.department || '');
      const location = String(job.location || '');
      const jobUrl = link || `https://preply.com/en/careers/apply?ashby_jid=${externalId}`;

      return {
        externalId,
        title,
        url: jobUrl,
        location: location || undefined,
        isRemote: /remote/i.test(location) || /remote/i.test(title),
        description: [title, team, location].filter(Boolean).join(' — '),
        publishedAt: String(job.publishedAt || ''),
      };
    },
  },
] as const;

export function extractNextDataProps(html: string): Record<string, unknown> | null {
  const match = /<script\b[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!match?.[1]) return null;
  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    const props = parsed?.props as Record<string, unknown> | undefined;
    return (props?.pageProps ?? null) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

function mapNextJobs(
  jobs: unknown[],
  endpoint: NextDataCareerEndpoint,
  sourceId: string,
  observedAt: string,
): UnifiedVacancy[] {
  const vacancies: UnifiedVacancy[] = [];
  for (const item of jobs) {
    const job = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
    const mapped = endpoint.mapJob(job, endpoint);
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

    vacancies.push({
      ...vacancy,
      requiredSkills: [],
    });
  }
  return vacancies;
}

export async function fetchNextDataVacancies(
  endpoint: NextDataCareerEndpoint,
  options?: {
    readonly customFetch?: typeof fetch;
  },
): Promise<UnifiedVacancy[]> {
  const customFetch = options?.customFetch ?? fetch;
  const sourceId = `src-${endpoint.id}`;
  const observedAt = new Date().toISOString();

  const response = await customFetch(endpoint.url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ...(endpoint.headers ?? {}),
    },
  });

  if (!response.ok) return [];

  const html = await response.text();
  const pageProps = extractNextDataProps(html);
  if (!pageProps) return [];

  const jobs = endpoint.extractJobs(pageProps);
  if (!Array.isArray(jobs)) return [];

  return mapNextJobs(jobs, endpoint, sourceId, observedAt);
}
