import { htmlToFeedText } from '../connectors/feedText';

export interface LinkedinCompanyRecruiterCandidate {
  readonly fullName: string;
  readonly roleTitle: string;
  readonly linkedinUrl: string;
}

const MAX_HTML_CHARS = 2 * 1024 * 1024;
export const RECRUITER_TITLE = /recruit|talent|human resources|people|hiring|acquisition|\bhr\b|набор|рекрут|персонал|кадр|найм|подбор/iu;

function textFromFirstMatch(html: string, pattern: RegExp): string {
  const match = pattern.exec(html);
  return match?.[1] ? htmlToFeedText(match[1]).replace(/\s+/gu, ' ').trim() : '';
}

function profileUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, 'https://www.linkedin.com');
    if (
      url.protocol !== 'https:' ||
      !['linkedin.com', 'www.linkedin.com'].includes(url.hostname.toLowerCase()) ||
      !/^\/in\/[A-Za-z0-9._%-]+\/?$/u.test(url.pathname)
    ) {
      return undefined;
    }
    return `https://www.linkedin.com${url.pathname.replace(/\/$/u, '')}`;
  } catch {
    return undefined;
  }
}

function* recruiterCards(html: string): Generator<string> {
  const items = /<li\b[^>]*class=["'][^"']*(?:reusable-search__result-container|entity-result__item)[^"']*["'][^>]*>/giu;
  let match: RegExpExecArray | null;
  while ((match = items.exec(html)) !== null) {
    const cardEnd = matchingListItemEnd(html, match.index);
    if (cardEnd < 0) return;
    yield html.slice(match.index, cardEnd);
    items.lastIndex = cardEnd;
  }
}

function matchingListItemEnd(html: string, start: number): number {
  const tags = /<\/?li\b[^>]*>/giu;
  tags.lastIndex = start;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tags.exec(html)) !== null) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return tags.lastIndex;
  }
  return -1;
}

function profileAnchor(card: string): { readonly html: string; readonly url: string } | undefined {
  const anchors = /<a\b([^>]*)>([\s\S]*?)<\/a>/giu;
  let match: RegExpExecArray | null;
  while ((match = anchors.exec(card)) !== null) {
    const href = /\bhref=["']([^"']+)["']/iu.exec(match[1] ?? '')?.[1];
    const url = profileUrl(href);
    if (url) return { html: match[2] ?? '', url };
  }
  return undefined;
}

function parseCard(card: string): LinkedinCompanyRecruiterCandidate | undefined {
  const anchor = profileAnchor(card);
  if (!anchor) return undefined;
  const visibleName = textFromFirstMatch(
    anchor.html,
    /<span\b[^>]*aria-hidden=["']true["'][^>]*>([\s\S]*?)<\/span>/iu,
  );
  const fullName = visibleName || htmlToFeedText(anchor.html).replace(/\s+/gu, ' ').trim();
  const roleTitle = textFromFirstMatch(
    card,
    /<(?:div|span)\b[^>]*class=["'][^"']*entity-result__primary-subtitle[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|span)>/iu,
  );
  if (
    fullName.length === 0 ||
    fullName.length > 200 ||
    roleTitle.length === 0 ||
    roleTitle.length > 200 ||
    !RECRUITER_TITLE.test(roleTitle)
  ) {
    return undefined;
  }
  return { fullName, roleTitle, linkedinUrl: anchor.url };
}

/** Извлекает минимальный набор полей из зафиксированной страницы людей компании. */
export function parseLinkedinCompanyPeoplePageHtml(
  html: string,
): LinkedinCompanyRecruiterCandidate[] {
  if (html.length === 0 || html.length > MAX_HTML_CHARS) return [];
  const profiles = new Map<string, LinkedinCompanyRecruiterCandidate>();
  for (const card of recruiterCards(html)) {
    const candidate = parseCard(card);
    if (candidate) profiles.set(candidate.linkedinUrl, candidate);
  }
  return [...profiles.values()];
}

/** Находит только точное совпадение названия компании и same-site URL. */
export function parseLinkedinCompanySearchPageHtml(
  html: string,
  companyName: string,
): string | undefined {
  if (html.length === 0 || html.length > MAX_HTML_CHARS) return undefined;
  const expected = normalizeCompanyName(companyName);
  const anchors = /<a\b([^>]*)>([\s\S]*?)<\/a>/giu;
  let match: RegExpExecArray | null;
  while ((match = anchors.exec(html)) !== null) {
    const href = /\bhref=["']([^"']+)["']/iu.exec(match[1] ?? '')?.[1];
    if (!href || !/\/company\//iu.test(href)) continue;
    if (normalizeCompanyName(htmlToFeedText(match[2] ?? '')) !== expected) continue;
    const safeUrl = companyUrl(href);
    if (safeUrl) return safeUrl;
  }
  return undefined;
}

function normalizeCompanyName(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
}

function companyUrl(value: string): string | undefined {
  try {
    const url = new URL(value, 'https://www.linkedin.com');
    if (
      url.protocol !== 'https:' ||
      !['linkedin.com', 'www.linkedin.com'].includes(url.hostname.toLowerCase()) ||
      !/^\/company\/[A-Za-z0-9._%-]+\/?$/u.test(url.pathname)
    ) {
      return undefined;
    }
    return `https://www.linkedin.com${url.pathname.replace(/\/$/u, '')}`;
  } catch {
    return undefined;
  }
}

export type LinkedinPageSafetyStopReason =
  | 'challenge_required'
  | 'expired'
  | 'login_required'
  | 'platform_restricted'
  | 'unexpected_page';

export function classifyLinkedinPageSafetySignal(input: {
  readonly statusCode: number | undefined;
  readonly url: string;
  readonly html: string;
}): LinkedinPageSafetyStopReason | null {
  if (input.statusCode === 401) return 'expired';
  if ([403, 429, 999].includes(input.statusCode ?? 0)) return 'platform_restricted';
  if (input.statusCode !== undefined && (input.statusCode < 200 || input.statusCode >= 300)) {
    return 'unexpected_page';
  }

  let pageUrl: URL;
  try {
    pageUrl = new URL(input.url);
  } catch {
    return 'unexpected_page';
  }
  const host = pageUrl.hostname.toLowerCase();
  const linkedinHost =
    host === 'linkedin.com' ||
    host.endsWith('.linkedin.com') ||
    host === 'linkedin.cn' ||
    host.endsWith('.linkedin.cn');
  if (pageUrl.protocol !== 'https:' || pageUrl.port !== '' || !linkedinHost) return 'unexpected_page';

  if (/\/(?:login|uas\/login)(?:\/|\?|$)/iu.test(pageUrl.pathname)) return 'login_required';
  if (/\/(?:checkpoint|challenge|authwall)(?:\/|\?|$)/iu.test(pageUrl.pathname)) return 'challenge_required';

  const sample = input.html.slice(0, 256 * 1024);
  if (/name=["']session_key["']/iu.test(sample)) return 'login_required';
  if (/<form\b[^>]*action=["'][^"']*\/(?:checkpoint|authwall)\//iu.test(sample)) {
    return 'challenge_required';
  }
  const safetyRegion = /<(?:div|main|section|form|iframe)\b(?=[^>]*(?:role=["']alert["']|(?:id|class|data-test-id)=["'][^"']*(?:challenge|checkpoint|authwall|security|verification|captcha|limit|restriction|error)[^"']*["']))[^>]*>[\s\S]{0,4000}?<\/(?:div|main|section|form|iframe)>/giu;
  const safetyMarkup = [...sample.matchAll(safetyRegion)].map(([markup]) => markup).join(' ');
  const safetyText = htmlToFeedText(safetyMarkup).replace(/\s+/gu, ' ').toLowerCase();
  if (/verify your identity|security verification|captcha|checkpoint|challenge/iu.test(safetyText)) {
    return 'challenge_required';
  }
  if (/unusual activity|temporarily restricted|rate limit|too many requests|access denied|account restricted|temporarily blocked/iu.test(safetyText)) {
    return 'platform_restricted';
  }
  if (/something went wrong|page not found|not available|unable to load this page/iu.test(safetyText)) {
    return 'unexpected_page';
  }
  return null;
}

export function linkedinPageNeedsReauth(input: {
  readonly statusCode: number | undefined;
  readonly url: string;
  readonly html: string;
}): boolean {
  return classifyLinkedinPageSafetySignal(input) !== null;
}
