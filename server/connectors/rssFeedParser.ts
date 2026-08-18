import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { calculateVacancyFingerprint } from '../vacancies/vacancyFingerprint';
import { extractSkillsFromText, parseSalaryText } from './telegramChannelParser';

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

  const cleanTitle = decodeXmlEntities(title);
  const cleanDesc = decodeXmlEntities(description.replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1'));
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
    id: `rss-${meta.sourceId}-${encodeURIComponent(guid).slice(0, 32)}`,
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

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseDateSafe(raw: string): string {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
