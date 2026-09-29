import { htmlToFeedText } from '../connectors/feedText';

export interface LinkedinCompanyRecruiterCandidate {
  readonly fullName: string;
  readonly roleTitle: string;
  readonly linkedinUrl: string;
}

const MAX_HTML_CHARS = 2 * 1024 * 1024;
const RECRUITER_TITLE = /recruit|talent|human resources|people|hiring|acquisition|\bhr\b|набор|рекрут|персонал|кадр|найм|подбор/iu;

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

export function linkedinPageNeedsReauth(input: {
  readonly statusCode: number | undefined;
  readonly url: string;
  readonly html: string;
}): boolean {
  if ([401, 403, 429, 999].includes(input.statusCode ?? 0)) return true;
  if (/\/(?:login|uas\/login|checkpoint|authwall)(?:\/|\?|$)/iu.test(input.url)) return true;
  return /name=["']session_key["']|\/checkpoint\/|\/authwall\/|verify your identity|security verification/iu.test(
    input.html.slice(0, 256 * 1024),
  );
}
