import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { buildJsonVacancy } from './jsonVacancyRecord';

export interface CorporateHtmlEndpoint {
  readonly id: string;
  readonly company: string;
  readonly url: string;
  readonly baseUrl: string;
  readonly headers?: Record<string, string>;
  readonly cardRegex: RegExp;
  readonly parseCard: (
    match: RegExpExecArray,
    endpoint: CorporateHtmlEndpoint,
  ) => {
    readonly externalId: string;
    readonly title: string;
    readonly url: string;
    readonly location?: string;
    readonly isRemote?: boolean;
    readonly description?: string;
  } | null;
}

function cleanHtmlText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export const CORPORATE_HTML_ENDPOINTS: readonly CorporateHtmlEndpoint[] = [
  {
    id: 'kaspersky',
    company: 'Kaspersky',
    url: 'https://careers.kaspersky.com/vacancies',
    baseUrl: 'https://careers.kaspersky.com',
    cardRegex: /<div class="grid grid-cols-1[^>]*>([\s\S]*?)<\/svg>\s*<\/div>\s*<\/div>/gi,
    parseCard: (match, endpoint) => {
      const cardHtml = match[1] ?? '';
      const linkMatch = cardHtml.match(/<a[^>]*href="(\/vacancy\/(\d+))"[^>]*>([\s\S]*?)<\/a>/i);
      if (!linkMatch) return null;

      const relHref = linkMatch[1] ?? '';
      const externalId = linkMatch[2] ?? '';
      const title = cleanHtmlText(linkMatch[3] ?? '');
      if (!title || !externalId) return null;

      const catMatch = cardHtml.match(/data-testid="vacancy-tag-category-[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
      const category = catMatch ? cleanHtmlText(catMatch[1] ?? '') : undefined;

      const cityMatch = cardHtml.match(/data-testid="vacancy-tag-city-[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
      const location = cityMatch ? cleanHtmlText(cityMatch[1] ?? '') : undefined;

      const desc = [title, category, location].filter(Boolean).join(' — ');

      return {
        externalId,
        title,
        url: `${endpoint.baseUrl}${relHref}`,
        location,
        isRemote: /remote/i.test(location ?? '') || /удален/i.test(location ?? ''),
        description: desc,
      };
    },
  },
  {
    id: 'veeam',
    company: 'Veeam',
    url: 'https://careers.veeam.com/vacancies',
    baseUrl: 'https://careers.veeam.com',
    cardRegex: /<a\b([^>]*href="(\/job\/[^"]+)"[^>]*)>([\s\S]*?)<\/a>/gi,
    parseCard: (match, endpoint) => {
      const fullTag = match[1] ?? '';
      const relHref = match[2] ?? '';
      const innerHtml = match[3] ?? '';

      const idMatch = fullTag.match(/data-job-id="([^"]+)"/i);
      const externalId = idMatch ? idMatch[1] : relHref.split('/').filter(Boolean).pop() ?? '';

      const titleMatch = innerHtml.match(/<p class="job-list__title">([\s\S]*?)<\/p>/i);
      const title = cleanHtmlText(titleMatch?.[1] || '');
      if (!title || !externalId) return null;

      const catMatch = innerHtml.match(/<span class="job-list__category">([\s\S]*?)<\/span>/i);
      const category = catMatch ? cleanHtmlText(catMatch[1] ?? '') : undefined;

      const locMatch = innerHtml.match(/<span class="job-list__location">([\s\S]*?)<\/span>/i);
      const location = locMatch ? cleanHtmlText(locMatch[1] ?? '') : undefined;

      const desc = [title, category, location].filter(Boolean).join(' — ');

      return {
        externalId,
        title,
        url: `${endpoint.baseUrl}${relHref}`,
        location,
        isRemote: /remote/i.test(location ?? '') || /remote/i.test(title),
        description: desc,
      };
    },
  },
  {
    id: 'faceapp',
    company: 'FaceApp',
    url: 'https://www.faceapp.com/careers/',
    baseUrl: 'https://www.faceapp.com',
    cardRegex: /<a\b[^>]*href="(\/careers\/[a-z0-9-]+)"[^>]*data-testid="careers-card"[^>]*>([\s\S]*?)<\/a>/gi,
    parseCard: (match, endpoint) => {
      const relHref = match[1] ?? '';
      const cardHtml = match[2] ?? '';
      const titleMatch = cardHtml.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
      const title = titleMatch ? cleanHtmlText(titleMatch[1] ?? '') : '';
      if (!title || !relHref) return null;

      const subMatch = cardHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      const subText = subMatch ? cleanHtmlText(subMatch[1] ?? '') : '';
      const externalId = relHref.replace(/^\/careers\//, '').replace(/[^a-z0-9_-]/g, '_');

      return {
        externalId,
        title,
        url: `${endpoint.baseUrl}${relHref}`,
        location: subText.split('/')[0]?.trim() || 'Limassol (Cyprus)',
        isRemote: /remote/i.test(subText),
        description: `${title} — ${subText}`,
      };
    },
  },
] as const;

function parseHtmlCards(
  html: string,
  endpoint: CorporateHtmlEndpoint,
  sourceId: string,
  observedAt: string,
): UnifiedVacancy[] {
  const vacancies: UnifiedVacancy[] = [];
  const seenIds = new Set<string>();
  const regex = new RegExp(endpoint.cardRegex.source, endpoint.cardRegex.flags);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const card = endpoint.parseCard(match, endpoint);
    if (!card || !card.externalId || !card.title || seenIds.has(card.externalId)) continue;
    seenIds.add(card.externalId);

    const vacancy = buildJsonVacancy({
      sourceId,
      context: {
        observedAt,
        sourceName: `${endpoint.company} Careers`,
        sourceUrl: card.url,
      },
      externalId: card.externalId,
      title: card.title,
      company: endpoint.company,
      location: card.location,
      isRemote: card.isRemote ?? /remote/i.test(card.location ?? ''),
      description: card.description || card.title,
      skills: [],
      url: card.url,
      publishedAt: observedAt,
    });

    vacancies.push({
      ...vacancy,
      requiredSkills: [],
    });
  }
  return vacancies;
}

export async function fetchCorporateHtmlVacancies(
  endpoint: CorporateHtmlEndpoint,
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
  return parseHtmlCards(html, endpoint, sourceId, observedAt);
}
