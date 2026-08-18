import type { UnifiedVacancy, VacancySalary } from '../domain/unifiedVacancy';
import { calculateVacancyFingerprint } from '../vacancies/vacancyFingerprint';

const KNOWN_TECH_KEYWORDS = [
  'React',
  'TypeScript',
  'JavaScript',
  'Node.js',
  'Python',
  'Go',
  'Golang',
  'Java',
  'Kotlin',
  'Swift',
  'C++',
  'Rust',
  'PostgreSQL',
  'MySQL',
  'MongoDB',
  'Redis',
  'Kafka',
  'RabbitMQ',
  'Docker',
  'Kubernetes',
  'AWS',
  'GCP',
  'Azure',
  'GraphQL',
  'REST',
  'FastAPI',
  'Django',
  'Spring',
  'Next.js',
  'Vue',
  'Angular',
  'QA',
  'DevOps',
  'ML',
  'AI',
  'Product Manager',
  'Project Manager',
  'Team Lead',
  'Tech Lead',
  'Engineering Manager',
  'Head of Engineering',
  'CTO',
];

export function parseSalaryText(text: string): VacancySalary | undefined {
  const usdMatch = text.match(/\$\s*(\d[\d\s,.]*)\s*(?:[-—доto]+\s*\$?\s*(\d[\d\s,.]*))?/i);
  if (usdMatch) {
    const from = parseNumber(usdMatch[1]);
    const to = usdMatch[2] ? parseNumber(usdMatch[2]) : undefined;
    if (from || to) return { from, to, currency: 'USD' };
  }

  const eurMatch = text.match(/€\s*(\d[\d\s,.]*)\s*(?:[-—доto]+\s*€?\s*(\d[\d\s,.]*))?/i);
  if (eurMatch) {
    const from = parseNumber(eurMatch[1]);
    const to = eurMatch[2] ? parseNumber(eurMatch[2]) : undefined;
    if (from || to) return { from, to, currency: 'EUR' };
  }

  const rurMatch = text.match(
    /(?:от|from)?\s*(\d[\d\s,.]*k?к?)\s*(?:[-—доto]+\s*(\d[\d\s,.]*k?к?))?\s*(?:руб|rur|rub|₽)/i,
  );
  if (rurMatch) {
    const from = parseNumberWithK(rurMatch[1]);
    const to = rurMatch[2] ? parseNumberWithK(rurMatch[2]) : undefined;
    if (from || to) return { from, to, currency: 'RUR', gross: !text.includes('на руки') };
  }

  return undefined;
}

function parseNumber(raw: string): number | undefined {
  const clean = raw.replace(/[^\d]/g, '');
  const num = parseInt(clean, 10);
  return Number.isNaN(num) ? undefined : num;
}

function parseNumberWithK(raw: string): number | undefined {
  if (!raw) return undefined;
  const isK = /[kк]/i.test(raw);
  const clean = raw.replace(/[^\d]/g, '');
  const num = parseInt(clean, 10);
  if (Number.isNaN(num)) return undefined;
  return isK && num < 1000 ? num * 1000 : num;
}

export function extractSkillsFromText(text: string): string[] {
  const found = new Set<string>();
  for (const keyword of KNOWN_TECH_KEYWORDS) {
    const regex = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i');
    if (regex.test(text)) {
      found.add(keyword);
    }
  }
  return Array.from(found);
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractJobTitleAndCompany(text: string, cleanText: string) {
  const rawLines = text
    .split(/<br\s*\/?>|\n/)
    .map((l) => l.replace(/<[^>]+>/g, '').trim())
    .filter(Boolean);

  let title = rawLines[0] ?? 'Разработчик';
  title = title
    .replace(/^#вакансия\s*/i, '')
    .replace(/^вакансия:\s*/i, '')
    .replace(/^ищем\s+/i, '')
    .split(/[.\n]/)[0]
    .trim();

  let company = 'IT Company';
  const companyMatch = cleanText.match(
    /(?:компания|company|работодатель):\s*([A-Za-z0-9\u0400-\u04FF\s\-_.]{2,50}?)(?=\s*(?:локация|location|зарплата|salary|формат|стек|требования|[.\n]|$))/i,
  );
  if (companyMatch) {
    company = companyMatch[1].trim();
  }

  return { title, company };
}

export function parseTelegramJobPost(
  text: string,
  meta: {
    postId: string;
    channelName: string;
    postUrl: string;
    publishedAt: string;
    observedAt: string;
  },
): UnifiedVacancy | null {
  const cleanText = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleanText.length < 30) return null;

  const { title, company } = extractJobTitleAndCompany(text, cleanText);
  const isRemote = /удален|remote|удалён|anywhere/i.test(cleanText);
  const salary = parseSalaryText(cleanText);
  const requiredSkills = extractSkillsFromText(cleanText);

  const fingerprint = calculateVacancyFingerprint({
    title,
    company,
    description: cleanText,
    salaryFrom: salary?.from,
    salaryTo: salary?.to,
    currency: salary?.currency,
  });

  return {
    id: `tg-${meta.channelName}-${meta.postId}`,
    fingerprint,
    title,
    company,
    isRemote,
    salary,
    description: cleanText,
    requiredSkills,
    url: meta.postUrl,
    provenance: {
      sourceType: 'telegram',
      sourceId: `tg-${meta.channelName}`,
      sourceUrl: meta.postUrl,
      channelName: meta.channelName,
      observedAt: meta.observedAt,
    },
    publishedAt: meta.publishedAt,
    status: 'active',
  };
}

export function parseTelegramChannelHtml(
  html: string,
  meta: { channelName: string; observedAt: string },
): UnifiedVacancy[] {
  const vacancies: UnifiedVacancy[] = [];
  const messagePattern =
    /<div[^>]*class="[^"]*tgme_widget_message\b[^"]*"[^>]*data-post="([^"]+)"[\s\S]*?<div[^>]*class="[^"]*tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>[\s\S]*?<time[^>]*datetime="([^"]+)"/gi;

  for (const match of html.matchAll(messagePattern)) {
    const postRef = match[1];
    const contentHtml = match[2];
    const datetime = match[3];
    const postId = postRef.split('/')[1] ?? postRef;
    const postUrl = `https://t.me/${postRef}`;

    const parsed = parseTelegramJobPost(contentHtml, {
      postId,
      channelName: meta.channelName,
      postUrl,
      publishedAt: datetime,
      observedAt: meta.observedAt,
    });

    if (parsed) vacancies.push(parsed);
  }

  return vacancies;
}
