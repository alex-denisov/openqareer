import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { htmlToFeedText } from '../connectors/feedText';

export interface LinkedinParserContext {
  readonly observedAt: string;
}

export interface LinkedinDetailContext extends LinkedinParserContext {
  readonly jobId: string;
  readonly url: string;
}

const CLEAN_LINKEDIN_URL = (url: string): string => {
  const match = url.match(/https?:\/\/(?:www\.)?linkedin\.com\/jobs\/view\/(\d+)/i);
  if (match && match[1]) {
    return `https://www.linkedin.com/jobs/view/${match[1]}`;
  }
  return url.split('?')[0] ?? url;
};

interface CardFields {
  readonly title: string;
  readonly company: string;
  readonly url: string;
  readonly location?: string;
  readonly dateText?: string;
}

function extractCardFields(cardContent: string): CardFields {
  const titleMatch =
    cardContent.match(/<h3[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/i) ??
    cardContent.match(/<span[^>]*class="sr-only"[^>]*>([\s\S]*?)<\/span>/i);
  const title = titleMatch ? htmlToFeedText(titleMatch[1] ?? '') : '';

  const companyMatch =
    cardContent.match(
      /<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
    ) ??
    cardContent.match(
      /<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>([\s\S]*?)<\/h4>/i,
    );
  const company = companyMatch ? htmlToFeedText(companyMatch[1] ?? '') : '';

  const linkMatch = cardContent.match(
    /<a[^>]*class="[^"]*base-card__full-link[^"]*"[^>]*href="([^"]+)"/i,
  );
  const rawUrl = linkMatch ? linkMatch[1]?.trim() : undefined;
  const url = rawUrl ? CLEAN_LINKEDIN_URL(rawUrl) : '';

  const locationMatch = cardContent.match(
    /<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
  );
  const location = locationMatch ? htmlToFeedText(locationMatch[1] ?? '') : undefined;

  const dateMatch = cardContent.match(/<time[^>]*datetime="([^"]+)"/i);
  const dateText = dateMatch?.[1];

  return { title, company, url, location, dateText };
}

/**
 * Parses raw HTML search result cards into canonical UnifiedVacancy models.
 */
export function parseLinkedinJobCards(
  html: string,
  context: LinkedinParserContext,
): UnifiedVacancy[] {
  const results: UnifiedVacancy[] = [];
  const cardRegex = /<li[^>]*data-occludable-job-id="([^"]+)"[\s\S]*?<\/li>/gi;
  let cardMatch: RegExpExecArray | null;

  while ((cardMatch = cardRegex.exec(html)) !== null) {
    const cardContent = cardMatch[0];
    const externalId = cardMatch[1]?.trim() ?? '';
    const { title, company, url, location, dateText } = extractCardFields(cardContent);

    if (!title || !company || !url) continue;

    const publishedAt = dateText ? new Date(dateText).toISOString() : context.observedAt;
    const isRemote = Boolean(
      location &&
        (location.toLowerCase().includes('remote') ||
          location.toLowerCase().includes('удален')),
    );
    const id = `src-linkedin-pool:${externalId || url}`;

    results.push({
      id,
      fingerprint: id,
      title,
      company,
      location,
      isRemote,
      description: '',
      requiredSkills: [],
      url,
      provenance: {
        sourceType: 'browser_session',
        sourceId: 'src-linkedin-pool',
        sourceUrl: url,
        externalId,
        observedAt: context.observedAt,
      },
      publishedAt,
      status: 'active',
    });
  }

  return results;
}

/**
 * Parses full LinkedIn job detail page.
 */
export function parseLinkedinJobHtml(
  html: string,
  context: LinkedinDetailContext,
): UnifiedVacancy | undefined {
  const titleMatch = html.match(
    /<h1[^>]*class="[^"]*topcard__title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i,
  );
  const title = titleMatch ? htmlToFeedText(titleMatch[1] ?? '') : '';

  const companyMatch = html.match(
    /<a[^>]*class="[^"]*topcard__org-name-link[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
  );
  const company = companyMatch ? htmlToFeedText(companyMatch[1] ?? '') : '';

  const locationMatch = html.match(
    /<span[^>]*class="[^"]*topcard__flavor--bullet[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
  );
  const location = locationMatch ? htmlToFeedText(locationMatch[1] ?? '') : undefined;

  const descMatch = html.match(
    /<div[^>]*class="[^"]*show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  );
  const description = descMatch ? htmlToFeedText(descMatch[1] ?? '') : '';

  if (!title || !company) {
    return undefined;
  }

  const id = `src-linkedin-pool:${context.jobId}`;
  const isRemote = Boolean(
    location &&
      (location.toLowerCase().includes('remote') ||
        location.toLowerCase().includes('удален')),
  );

  return {
    id,
    fingerprint: id,
    title,
    company,
    location,
    isRemote,
    description,
    requiredSkills: [],
    url: context.url,
    provenance: {
      sourceType: 'browser_session',
      sourceId: 'src-linkedin-pool',
      sourceUrl: context.url,
      externalId: context.jobId,
      observedAt: context.observedAt,
    },
    publishedAt: context.observedAt,
    status: 'active',
  };
}
