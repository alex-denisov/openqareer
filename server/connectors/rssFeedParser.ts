import { createHash } from 'node:crypto';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { calculateVacancyFingerprint } from '../vacancies/vacancyFingerprint';
import { extractSkillsFromText, parseSalaryText } from './telegramChannelParser';
import { decodeFeedEntities, htmlToFeedText, unwrapCdata } from './feedText';

/**
 * Как эта лента называет работодателя.
 *
 * Формы объявляются площадкой, а не угадываются: «Data Analyst at Scale» —
 * должность целиком, и резать её по « at » только потому, что предлог там
 * встретился, значит выдумать работодателя «Scale».
 *
 *   title-colon-prefix — «Reddit: Director, Privacy Legal» (We Work Remotely)
 *   title-at-suffix    — «Staff Systems Engineer, IT at GitLab» (NoDesk)
 */
export type RssEmployerShape = 'title-colon-prefix' | 'title-at-suffix';

interface RssFeedMeta {
  sourceId: string;
  sourceUrl: string;
  /**
   * Работодатель всей ленты. Ставится только для собственной ленты компании:
   * у агрегатора работодатель свой в каждой записи, и подстановка сюда имени
   * площадки печатала «Himalayas» там, где кандидат ждёт нанимателя.
   */
  companyName?: string;
  employerShape?: RssEmployerShape;
  observedAt: string;
}

/**
 * Тег с именем компании внутри записи — с любым префиксом пространства имён
 * (`himalayasJobs:companyName`) и без него.
 */
const ITEM_COMPANY_TAGS = ['companyName', 'company'] as const;

/** Автор записи — работодатель, если это не адрес почты (Хабр Карьера). */
function authorEmployer(itemXml: string): string | null {
  const author = extractXmlTag(itemXml, '(?:[a-z0-9]+:)?author');
  if (!author) return null;
  const value = decodeFeedEntities(unwrapCdata(author)).trim();
  return value && !value.includes('@') ? value : null;
}

function itemCompanyTag(itemXml: string): string | null {
  for (const tag of ITEM_COMPANY_TAGS) {
    const raw = extractXmlTag(itemXml, `(?:[a-z0-9]+:)?${tag}`);
    if (!raw) continue;
    const value = decodeFeedEntities(unwrapCdata(raw)).trim();
    if (value) return value;
  }
  return null;
}

/**
 * Работодатель и должность из записи. Пустой работодатель — законный исход:
 * `employerLabel` скажет «Работодатель не указан», и это честнее выдуманного
 * имени, по которому вакансию не найти.
 */
function splitEmployer(
  title: string,
  itemXml: string,
  meta: RssFeedMeta,
): { title: string; company: string } {
  const named = itemCompanyTag(itemXml) ?? authorEmployer(itemXml);
  if (named) return { title, company: named };

  if (meta.employerShape === 'title-colon-prefix') {
    const match = /^([^:]{2,60}):\s+(.{3,})$/u.exec(title);
    if (match) return { title: match[2].trim(), company: match[1].trim() };
  }
  if (meta.employerShape === 'title-at-suffix') {
    const match = /^(.{3,})\s+at\s+([^\s].{0,59})$/u.exec(title);
    if (match) return { title: match[1].trim(), company: match[2].trim() };
  }

  return { title, company: meta.companyName ?? '' };
}

function parseRssItem(itemXml: string, meta: RssFeedMeta): UnifiedVacancy | null {
  const title = extractXmlTag(itemXml, 'title');
  const link = extractXmlTag(itemXml, 'link') || meta.sourceUrl;
  const guid = extractXmlTag(itemXml, 'guid') || link;
  const pubDate = extractXmlTag(itemXml, 'pubDate') || meta.observedAt;
  const description = extractXmlTag(itemXml, 'description');

  if (!title || !description) return null;

  // A feed wraps whichever fields it likes in CDATA. Stripping it only from
  // the description printed `<![CDATA[…]]>` inside the title of every card the
  // candidate saw (found on the B164 prod walk).
  const cleanTitle = decodeFeedEntities(unwrapCdata(title));
  // Feeds like We Work Remotely escape a whole HTML body into the description,
  // so decoding alone would hand the candidate markup (B164 prod walk).
  const cleanDesc = htmlToFeedText(decodeFeedEntities(unwrapCdata(description)));
  const employer = splitEmployer(decodeFeedEntities(unwrapCdata(title)), itemXml, meta);
  const company = employer.company;
  const isRemote = /remote|удален|anywhere/i.test(cleanDesc) || /remote/i.test(cleanTitle);
  const salary = parseSalaryText(cleanDesc);
  const requiredSkills = extractSkillsFromText(`${cleanTitle} ${cleanDesc}`);

  const fingerprint = calculateVacancyFingerprint({
    title: employer.title,
    company,
    description: cleanDesc,
    salaryFrom: salary?.from,
    salaryTo: salary?.to,
    currency: salary?.currency,
  });

  return {
    // A digest, not a prefix. Truncating the escaped guid to 32 characters
    // collapsed every item of a feed whose links share a longer prefix —
    // `https%3A%2F%2Fweworkremotely.com%2F` alone is 35 — so one sync that kept
    // 79 vacancies left exactly one in the pool (found on the B164 prod walk).
    id: `rss-${meta.sourceId}-${createHash('sha256').update(guid, 'utf8').digest('hex').slice(0, 32)}`,
    fingerprint,
    title: employer.title,
    company,
    isRemote,
    salary,
    description: cleanDesc,
    requiredSkills,
    url: link,
    provenance: {
      sourceType: 'rss',
      sourceId: meta.sourceId,
      sourceUrl: meta.sourceUrl,
      externalId: guid,
      observedAt: meta.observedAt,
    },
    publishedAt: parseDateSafe(pubDate),
    status: 'active',
  };
}

export function parseRssJobFeed(xml: string, meta: RssFeedMeta): UnifiedVacancy[] {
  const vacancies: UnifiedVacancy[] = [];
  const itemPattern = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;

  for (const match of xml.matchAll(itemPattern)) {
    const parsed = parseRssItem(match[1], meta);
    if (parsed) vacancies.push(parsed);
  }

  return vacancies;
}

/** `tag` может быть шаблоном пространства имён, поэтому в закрывающем теге тоже. */
function extractXmlTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? match[1].trim() : null;
}

function parseDateSafe(raw: string): string {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
