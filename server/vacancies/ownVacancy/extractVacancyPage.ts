import { OWN_VACANCY_PAGE_TEXT_MIN, OWN_VACANCY_TITLE_MAX, type OwnVacancyWorkFormat } from '../../../shared/b640OwnVacancy';
import { decodeFeedEntities } from '../../connectors/feedText';
import { record, text as textOf } from '../jsonVacancyRecord';
import { attrValue, findElement, findElements, findItemprop, htmlToText } from './htmlScan';

/**
 * B676: вакансия из HTML одной страницы без выполнения скриптов и без DOM, линейным проходом:
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
const JSON_LD_MAX = 500_000;

function clean(value: string): string | null {
  const out = decodeFeedEntities(value).replace(/\s+/gu, ' ').trim();
  return out ? out.slice(0, OWN_VACANCY_TITLE_MAX) : null;
}

function isJobPosting(value: unknown): boolean {
  const type = record(value)['@type'];
  return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
}

function jsonLdPosting(html: string): Record<string, unknown> | null {
  const blocks = findElements(html, 'script', (attrs) => /application\/ld\+json/iu.test(attrs));
  for (const { inner } of blocks) {
    if (inner.length > JSON_LD_MAX) continue;
    try {
      const parsed: unknown = JSON.parse(inner);
      const found = [parsed, ...(Array.isArray(parsed) ? parsed : []), ...[record(parsed)['@graph']].flat()].find(isJobPosting);
      if (found) return record(found);
    } catch {
      continue;
    }
  }
  return null;
}

function ldLocation(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  const address = record(record(first).address);
  const country = textOf(record(address.addressCountry).name) || textOf(address.addressCountry);
  const parts = [textOf(address.addressLocality), textOf(address.addressRegion), country]
    .filter((part, index, all) => part && all.indexOf(part) === index);
  return parts.length > 0 ? clean(parts.join(', ')) : null;
}

function fromJsonLd(html: string): Fields | null {
  const posting = jsonLdPosting(html);
  const description = posting ? textOf(posting.description) : '';
  if (!posting || !description.trim()) return null;
  const remote = /telecommute|remote/iu.test(JSON.stringify(posting.jobLocationType ?? ''));
  return {
    title: clean(textOf(posting.title)),
    company: clean(textOf(record(posting.hiringOrganization).name)),
    location: ldLocation(posting.jobLocation),
    workFormat: remote ? 'remote' : null,
    text: htmlToText(description),
  };
}

function fromMicrodata(html: string): Fields | null {
  const start = html.search(/itemtype=["']https?:\/\/schema\.org\/JobPosting["']/iu);
  if (start < 0) return null;
  const scope = html.slice(start);
  const description = findItemprop(scope, 'description');
  if (!description) return null;
  const organization = findItemprop(scope, 'hiringOrganization');
  const company = organization ? findItemprop(organization, 'name') ?? organization : null;
  return {
    title: clean(htmlToText(findItemprop(scope, 'title') ?? '')),
    company: company ? clean(htmlToText(company)) : null,
    location: null,
    workFormat: null,
    text: htmlToText(description),
  };
}

function meta(html: string, property: string): string | null {
  const tag = findElement(html, 'meta', (attrs) => [attrValue(attrs, 'property'), attrValue(attrs, 'name')].includes(property));
  const content = tag ? attrValue(tag.attrs, 'content') : null;
  return content ? clean(content) : null;
}

function mainText(html: string): string {
  const scope = findElement(html, 'main') ?? findElement(html, 'article') ?? findElement(html, 'body');
  return htmlToText(scope?.inner ?? html);
}

function fromPage(html: string, text: string): Fields {
  const title = meta(html, 'og:title') ?? clean(htmlToText(findElement(html, 'title')?.inner ?? ''));
  return { title, company: null, location: null, workFormat: null, text };
}

export function extractVacancyPage(html: string): ExtractedVacancyPage {
  const visible = mainText(html);
  const fields = fromJsonLd(html) ?? fromMicrodata(html) ?? fromPage(html, visible);
  const thin = fields.text.length < OWN_VACANCY_PAGE_TEXT_MIN;
  return { ...fields, thin, botWall: thin && BOT_WALL.test(visible) };
}
