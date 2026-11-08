import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { buildJsonVacancy, fromIso } from './jsonVacancyRecord';

export interface LinkedinCompanyTarget {
  readonly slug: string;
  readonly company: string;
  readonly organizationId: string;
}

export const LINKEDIN_GROUP_B_TARGETS: readonly LinkedinCompanyTarget[] = [
  { slug: 'ringcentral', company: 'RingCentral', organizationId: '60868' },
  { slug: 'cloudlinux', company: 'CloudLinux', organizationId: '632769' },
  { slug: 'ciklum', company: 'Ciklum', organizationId: '9183' },
  { slug: 'astound-commerce', company: 'Astound Commerce', organizationId: '2403308' },
  { slug: 'indrive', company: 'inDrive', organizationId: '11847304' },
  { slug: 'wallarm', company: 'Wallarm', organizationId: '4871419' },
  { slug: 'datadome', company: 'DataDome', organizationId: '10398947' },
] as const;

/**
 * «Весь мир» в гостевом поиске (B622, прод 09.11): без geoId LinkedIn на f_C
 * отвечает пустой страницей 26 байт или 429, с ним — карточками компании.
 */
export const WORLDWIDE_GEO_ID = '92000000';

const GUEST_HEADERS = {
  accept: 'text/html,application/xhtml+xml',
  'accept-language': 'en-US,en;q=0.9',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
} as const;

function attr(card: string, name: string): string {
  const m = new RegExp(`${name}="([^"]*)"`).exec(card);
  return m ? decodeEntities(m[1]!) : '';
}

function tagText(card: string, className: string): string {
  const m = new RegExp(`class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)<`, 'i').exec(card);
  return m ? decodeEntities(m[1]!.replace(/<[^>]+>/g, '').trim()) : '';
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const LINKEDIN_MARKUP =
  /show-more-less-html__markup[^>]*>([\s\S]*?)(?:<button[^>]*show-more-less-html__button|<\/section>)/;

export async function fetchLinkedinJobDetailText(
  jobId: string,
  customFetch: typeof fetch = fetch,
): Promise<string> {
  const url = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`;
  try {
    const response = await customFetch(url, { headers: GUEST_HEADERS });
    if (!response.ok) return '';
    const html = await response.text();
    const m = html.match(LINKEDIN_MARKUP);
    if (!m?.[1]) return '';
    return decodeEntities(m[1].replace(/<[^>]+>/g, ' ').trim());
  } catch {
    return '';
  }
}

async function parseCardToVacancy(
  card: string,
  target: LinkedinCompanyTarget,
  sourceId: string,
  observedAt: string,
  fetchFullText?: boolean,
  customFetch: typeof fetch = fetch,
): Promise<UnifiedVacancy | null> {
  const id = attr(card, 'data-entity-urn').replace('urn:li:jobPosting:', '');
  if (!/^\d+$/.test(id)) return null;

  const title = tagText(card, 'sr-only') || tagText(card, 'base-search-card__title');
  const company =
    tagText(card, 'hidden-nested-link') ||
    tagText(card, 'base-search-card__subtitle') ||
    target.company;
  const location = tagText(card, 'job-search-card__location');
  const datetime = attr(card, 'datetime');
  const jobUrl = `https://www.linkedin.com/jobs/view/${id}`;

  let description = [title, company, location].filter(Boolean).join(' — ');
  if (fetchFullText) {
    try {
      const detail = await fetchLinkedinJobDetailText(id, customFetch);
      if (detail) description = detail;
    } catch {
      // Keep title/location fallback if detail fetch drops
    }
  }

  const vacancy = buildJsonVacancy({
    sourceId,
    context: {
      observedAt,
      sourceName: `${target.company} (LinkedIn)`,
      sourceUrl: jobUrl,
    },
    externalId: id,
    title: title || `${target.company} Role`,
    company: target.company,
    location: location || undefined,
    isRemote: /remote/i.test(location) || /remote/i.test(title),
    description,
    skills: [],
    url: jobUrl,
    publishedAt: datetime ? fromIso(datetime) : observedAt,
  });

  return {
    ...vacancy,
    requiredSkills: [],
  };
}

export async function fetchLinkedinCompanyVacancies(
  target: LinkedinCompanyTarget,
  options?: {
    readonly maxPages?: number;
    readonly fetchFullText?: boolean;
    readonly customFetch?: typeof fetch;
    /** Id источника в реестре; по умолчанию старая форма `src-linkedin-<slug>`. */
    readonly sourceId?: string;
  },
): Promise<UnifiedVacancy[]> {
  const customFetch = options?.customFetch ?? fetch;
  const maxPages = options?.maxPages ?? 5;
  const observedAt = new Date().toISOString();
  const sourceId = options?.sourceId ?? `src-linkedin-${target.slug}`;
  const allVacancies: UnifiedVacancy[] = [];

  for (let page = 0; page < maxPages; page++) {
    const start = page * 10;
    const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?f_C=${target.organizationId}&geoId=${WORLDWIDE_GEO_ID}&start=${start}`;
    let response: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await customFetch(url, { headers: GUEST_HEADERS });
        if (response.ok || response.status === 429) break;
      } catch (error: unknown) {
        // Пауза бюджета LinkedIn — не сетевой сбой: повторять нельзя (B622).
        if ((error as { statusCode?: number } | null)?.statusCode === 429) throw error;
        // Retry once on transient network error
      }
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 400));
    }
    // 429 — LinkedIn просит паузу: источник падает с заголовком, расписание ждёт (B622).
    if (response?.status === 429) throw linkedinRateLimited(response);
    if (!response || !response.ok) {
      if (page === 0)
        throw new Error(`vacancy_source_unreachable: ${response?.status ?? 'network'}`);
      break;
    }

    const html = await response.text();
    const cards = html.split('<li>').slice(1);
    if (cards.length === 0) break;

    for (const card of cards) {
      const vacancy = await parseCardToVacancy(
        card,
        target,
        sourceId,
        observedAt,
        options?.fetchFullText,
        customFetch,
      );
      if (vacancy) allVacancies.push(vacancy);
    }

    if (cards.length < 10) break;
  }

  return allVacancies;
}

export function linkedinRateLimited(response: Response): Error {
  return Object.assign(new Error('vacancy_source_unreachable: 429'), {
    statusCode: 429,
    headers: response.headers,
  });
}
