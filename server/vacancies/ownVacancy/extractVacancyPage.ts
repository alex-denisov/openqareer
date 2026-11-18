import { OWN_VACANCY_PAGE_TEXT_MIN, OWN_VACANCY_TITLE_MAX, type OwnVacancyWorkFormat } from '../../../shared/b640OwnVacancy';
import { decodeFeedEntities, htmlToFeedText } from '../../connectors/feedText';
import { record, text as textOf } from '../jsonVacancyRecord';

/**
 * B676: вакансия из HTML одной страницы без выполнения скриптов и без DOM:
 * JSON-LD `JobPosting` → microdata `schema.org/JobPosting` → OpenGraph и основной текст.
 */
export interface ExtractedVacancyPage {
  readonly title: string | null;
  readonly company: string | null;
  readonly location: string | null;
  readonly workFormat: OwnVacancyWorkFormat | null;
  readonly text: string;
  readonly thin: boolean;
  readonly botWall: boolean;
}

type Fields = Omit<ExtractedVacancyPage, 'thin' | 'botWall'>;

const BOT_WALL = /captcha|не\s+робот|not\s+a\s+robot|verify\s+you\s+are\s+human|are\s+you\s+a\s+robot|cf-challenge|access\s+denied/iu;
const CHROME = /<(nav|header|footer|aside|noscript|template|svg|form)\b[^>]*>[\s\S]*?<\/\1>/giu;

function clean(value: string): string | null {
  const out = decodeFeedEntities(value).replace(/\s+/gu, ' ').trim();
  return out ? out.slice(0, OWN_VACANCY_TITLE_MAX) : null;
}

function isJobPosting(value: unknown): boolean {
  const type = record(value)['@type'];
  return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
}

function jsonLdPostings(html: string): unknown[] {
  const out: unknown[] = [];
  for (const [, body] of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/giu)) {
    try {
      const parsed: unknown = JSON.parse(body ?? '');
      out.push(...[parsed, ...(Array.isArray(parsed) ? parsed : []), ...[record(parsed)['@graph']].flat()].filter(isJobPosting));
    } catch {
      continue;
    }
  }
  return out;
}

function ldLocation(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  const address = record(record(first).address);
  const parts = [textOf(address.addressLocality), textOf(address.addressRegion), textOf(record(address.addressCountry).name) || textOf(address.addressCountry)]
    .filter((part, index, all) => part && all.indexOf(part) === index);
  return parts.length > 0 ? clean(parts.join(', ')) : null;
}

function fromJsonLd(html: string): Fields | null {
  const posting = record(jsonLdPostings(html)[0]);
  const description = textOf(posting.description);
  if (!description.trim()) return null;
  const remote = /telecommute|remote/iu.test(JSON.stringify(posting.jobLocationType ?? ''));
  return {
    title: clean(textOf(posting.title)),
    company: clean(textOf(record(posting.hiringOrganization).name)),
    location: ldLocation(posting.jobLocation),
    workFormat: remote ? 'remote' : null,
    text: htmlToFeedText(description),
  };
}

function itemprop(html: string, name: string): string | null {
  const match = new RegExp(`<([a-z0-9]+)\\b[^>]*\\bitemprop=["']${name}["'][^>]*>([\\s\\S]*?)</\\1>`, 'iu').exec(html);
  return match ? match[2] ?? null : null;
}

function fromMicrodata(html: string): Fields | null {
  const start = html.search(/itemtype=["']https?:\/\/schema\.org\/JobPosting["']/iu);
  if (start < 0) return null;
  const scope = html.slice(start);
  const description = itemprop(scope, 'description');
  if (!description) return null;
  const organization = itemprop(scope, 'hiringOrganization');
  return {
    title: clean(htmlToFeedText(itemprop(scope, 'title') ?? '')),
    company: organization ? clean(htmlToFeedText(itemprop(organization, 'name') ?? organization)) : null,
    location: null,
    workFormat: null,
    text: htmlToFeedText(description),
  };
}

function meta(html: string, property: string): string | null {
  const tag = new RegExp(`<meta\\b[^>]*(?:property|name)=["']${property}["'][^>]*>`, 'iu').exec(html)?.[0];
  const content = tag ? /\bcontent=["']([^"']*)["']/iu.exec(tag)?.[1] : undefined;
  return content ? clean(content) : null;
}

function mainText(html: string): string {
  const body = /<main\b[^>]*>([\s\S]*?)<\/main>/iu.exec(html)?.[1]
    ?? /<article\b[^>]*>([\s\S]*?)<\/article>/iu.exec(html)?.[1]
    ?? /<body\b[^>]*>([\s\S]*?)<\/body>/iu.exec(html)?.[1]
    ?? html;
  return htmlToFeedText(body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, ' ').replace(CHROME, ' '));
}

function fromPage(html: string): Fields {
  const title = meta(html, 'og:title') ?? clean(htmlToFeedText(/<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1] ?? ''));
  return { title, company: null, location: null, workFormat: null, text: mainText(html) };
}

export function extractVacancyPage(html: string): ExtractedVacancyPage {
  const fields = fromJsonLd(html) ?? fromMicrodata(html) ?? fromPage(html);
  const visible = mainText(html);
  const botWall = fields.text.length < OWN_VACANCY_PAGE_TEXT_MIN && BOT_WALL.test(visible);
  return { ...fields, thin: fields.text.length < OWN_VACANCY_PAGE_TEXT_MIN, botWall };
}
