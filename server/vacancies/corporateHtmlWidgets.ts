import { htmlToFeedText } from '../connectors/feedText';

/**
 * Общие помощники разбора корпоративных страниц и разбор виджетов Comeet и
 * Tilda; вынесены из genericCorporateSiteAdapter.ts (лимит 800 строк, B643).
 */

export function cleanText(text: string): string {
  if (!text) return '';
  return htmlToFeedText(text).replace(/\s+/gu, ' ').trim();
}

export function cleanDescription(text: string): string {
  if (!text) return '';
  return htmlToFeedText(text).trim();
}

export function resolveUrl(relativeOrAbsolute: string, baseUrl: string): string {
  try {
    return new URL(relativeOrAbsolute, baseUrl).toString();
  } catch {
    return relativeOrAbsolute;
  }
}

export const IGNORE_TITLE_REGEX =
  /^(apply|apply now|read more|view job|view vacancy|details|see more|learn more|click here|all jobs|back to jobs|job details|careers|jobs|vacancies|our vacancies|open positions|explore jobs|join us|work with us|filter|search|submit|next|previous)$/i;

export interface ExtractedRawJob {
  readonly externalId: string;
  readonly title: string;
  readonly url: string;
  readonly location?: string;
  readonly isRemote?: boolean;
  readonly description?: string;
  readonly publishedAt?: string;
}

export function extractComeetJobs(html: string, baseUrl: string): ExtractedRawJob[] {
  if (!html.includes('comeet-position-name')) return [];
  const jobs: ExtractedRawJob[] = [];
  const seenUrls = new Set<string>();
  const items = Array.from(
    html.matchAll(/<li[^>]*class="[^"]*all-loc[^"]*"[^>]*>([\s\S]*?)<\/li>/gi),
  );
  for (const item of items) {
    const raw = item[1];
    const titleMatch = raw.match(/class="comeet-position-name">([\s\S]*?)<\/div>/);
    const linkMatch = raw.match(/href=["']([^"']+)["']/);
    const locMatch = raw.match(/class="location_name">([\s\S]*?)<\/div>/);
    if (!titleMatch || !linkMatch) continue;
    const title = cleanText(titleMatch[1]);
    if (!title || IGNORE_TITLE_REGEX.test(title)) continue;
    const rawUrl = linkMatch[1].replace(/^\/\//, 'https://');
    const fullUrl = resolveUrl(rawUrl, baseUrl);
    if (seenUrls.has(fullUrl)) continue;
    seenUrls.add(fullUrl);
    const loc = locMatch ? cleanText(locMatch[1]) : undefined;
    jobs.push({
      externalId: fullUrl.replace(/[^a-zA-Z0-9_-]/g, '_').slice(-40),
      title,
      url: fullUrl,
      location: loc,
      isRemote: /remote/i.test(title) || /remote/i.test(loc ?? ''),
      description: title,
    });
  }
  return jobs;
}

function extractTildaDescription(html: string, anchor: string, fallback: string): string {
  if (!anchor.startsWith('#rec')) return fallback;
  const recId = anchor.slice(1);
  const startIdx = html.indexOf(`id="${recId}"`);
  if (startIdx === -1) return fallback;
  const tagEnd = html.indexOf('>', startIdx);
  if (tagEnd === -1) return fallback;
  const chunk = html.slice(tagEnd + 1, tagEnd + 4000);
  const nextRec = chunk.indexOf('class="r t-rec', 50);
  const recHtml = nextRec !== -1 ? chunk.slice(0, nextRec) : chunk;
  const clean = cleanDescription(recHtml);
  return clean.length > fallback.length ? clean : fallback;
}

export function extractTildaCardJobs(html: string, baseUrl: string): ExtractedRawJob[] {
  if (!html.includes('t-card__title')) return [];
  const jobs: ExtractedRawJob[] = [];
  const seenUrls = new Set<string>();
  const matches = Array.from(
    html.matchAll(/<div class="[^"]*t-card__title[^"]*"[^>]*>([\s\S]*?)<\/div>/gi),
  );
  for (const m of matches) {
    const raw = m[1];
    const title = cleanText(raw);
    if (!title || title.length < 3 || IGNORE_TITLE_REGEX.test(title)) continue;
    const linkMatch = raw.match(/href=["']([^"']+)["']/);
    const anchor = linkMatch ? linkMatch[1] : `#${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const fullUrl = resolveUrl(anchor, baseUrl);
    if (seenUrls.has(fullUrl)) continue;
    seenUrls.add(fullUrl);
    const desc = extractTildaDescription(html, anchor, title);
    jobs.push({
      externalId: fullUrl.replace(/[^a-zA-Z0-9_-]/g, '_').slice(-40),
      title,
      url: fullUrl,
      isRemote: /remote/i.test(title) || /remote/i.test(desc),
      description: desc,
    });
  }
  return jobs;
}
