import { createHash } from 'node:crypto';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { calculateVacancyFingerprint } from '../vacancies/vacancyFingerprint';
import { extractSkillsFromText, parseSalaryText } from './telegramChannelParser';
import { decodeFeedEntities, htmlToFeedText, unwrapCdata } from './feedText';

interface RssFeedMeta {
  sourceId: string;
  sourceUrl: string;
  companyName?: string;
  observedAt: string;
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
  const company = meta.companyName ?? 'Tech Company';
  const isRemote = /remote|удален|anywhere/i.test(cleanDesc) || /remote/i.test(cleanTitle);
  const salary = parseSalaryText(cleanDesc);
  const requiredSkills = extractSkillsFromText(`${cleanTitle} ${cleanDesc}`);

  const fingerprint = calculateVacancyFingerprint({
    title: cleanTitle,
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
    title: cleanTitle,
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

function extractXmlTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? match[1].trim() : null;
}

function parseDateSafe(raw: string): string {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
