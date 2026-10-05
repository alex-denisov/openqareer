import { htmlToFeedText } from '../connectors/feedText';

export interface LinkedinPeopleSearchCard {
  /** null — карточка скрыта («LinkedIn Member»). */
  readonly fullName: string | null;
  /** null — ссылки /in/ нет (люди 3+ круга скрыты). */
  readonly linkedinUrl: string | null;
  readonly headline: string;
  readonly location: string | null;
}

const MAX_HTML_CHARS = 3 * 1024 * 1024;
const HIDDEN_NAME = /^linkedin member$/iu;
// Классы обфусцированы: опираемся на структуру «имя → заголовок → город».
const CARD =
  /<p\b[^>]*>((?:(?!<\/p>)[\s\S])*?)<\/p>\s*<div\b[^>]*>\s*<p\b[^>]*>\s*<span>([^<]*)<\/span>\s*<\/p>\s*<\/div>\s*<div\b[^>]*>\s*<p\b[^>]*>\s*<span>([^<]*)<\/span>\s*<\/p>\s*<\/div>/giu;

function plainText(html: string): string {
  return htmlToFeedText(html.replace(/<svg\b[\s\S]*?<\/svg>/giu, ' ')).replace(/\s+/gu, ' ').trim();
}

function profileLink(html: string): string | null {
  const href = /\bhref=["']([^"']*\/in\/[^"']+)["']/iu.exec(html)?.[1];
  if (!href) return null;
  try {
    const url = new URL(href.replace(/&amp;/gu, '&'), 'https://www.linkedin.com');
    if (url.protocol !== 'https:' || !/(^|\.)linkedin\.com$/iu.test(url.hostname)) return null;
    const slug = /^\/in\/([A-Za-z0-9._%-]+)\/?$/u.exec(url.pathname)?.[1];
    return slug ? `https://www.linkedin.com/in/${slug}` : null;
  } catch {
    return null;
  }
}

function visibleName(html: string): string | null {
  const hidden = /<span\b[^>]*aria-hidden=["']true["'][^>]*>([^<]*)<\/span>/iu.exec(html)?.[1];
  const name = plainText(hidden ?? html);
  return name && name.length <= 200 && !HIDDEN_NAME.test(name) ? name : null;
}

/** Карточки поиска людей: должность и город есть всегда, имя и ссылка — только у видимых. */
export function parseLinkedinPeopleSearchPageHtml(html: string): LinkedinPeopleSearchCard[] {
  if (html.length === 0 || html.length > MAX_HTML_CHARS) return [];
  const cards: LinkedinPeopleSearchCard[] = [];
  for (const match of html.matchAll(CARD)) {
    const headline = plainText(match[2] ?? '');
    if (!headline || headline.length > 300) continue;
    const link = profileLink(match[1] ?? '');
    const name = link ? visibleName(match[1] ?? '') : null;
    cards.push({
      fullName: name,
      linkedinUrl: name ? link : null,
      headline,
      location: plainText(match[3] ?? '') || null,
    });
  }
  return cards;
}

/** Страница компании упоминает и «похожие компании»: свой ID — самый частый. */
export function parseLinkedinCompanyIdFromPageHtml(html: string): string | null {
  if (html.length === 0 || html.length > 8 * 1024 * 1024) return null;
  const counts = new Map<string, number>();
  for (const match of html.matchAll(/urn:li:fsd_company:\(?(\d+)/gu)) {
    const id = match[1] as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}
