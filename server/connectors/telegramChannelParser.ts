import type { UnifiedVacancy, VacancySalary } from '../domain/unifiedVacancy';
import { calculateVacancyFingerprint } from '../vacancies/vacancyFingerprint';
import { decodeFeedEntities } from './feedText';
import { extractTelegramJobHeader } from './telegramJobHeader';

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

function hasResumeSignals(clean: string): boolean {
  if (/#резюме|#cv|#ищу_работу|#ищуработу|#кандидат/iu.test(clean.slice(0, 150))) return true;
  const resumePatterns = [
    /#резюме/iu, /#cv\b/i, /#ищу_работу/iu, /#ищуработу/iu, /#кандидат/iu,
    /ищу работу/iu, /ищу проект/iu, /ищу команду/iu, /рассматриваю предложения/iu,
    /готов к предложениям/iu, /обо мне:/iu, /обо мне\s/iu, /о себе:/iu,
    /мой стек:/iu, /мои навыки:/iu, /ищу позицию/iu, /ищу удаленку/iu,
    /открыт к предложениям/iu, /желаемая зарплата/iu, /желаемая должность/iu,
  ];
  return resumePatterns.some((rx) => rx.test(clean));
}

function hasHiringSignals(clean: string): boolean {
  const hiringPatterns = [
    /#вакансия/iu, /#job\b/i, /мы ищем/iu, /ищем в команду/iu, /в поисках/iu,
    /открыта позиция/iu, /открыта вакансия/iu, /требуется/iu, /нанимаем/iu,
    /предлагаем работу/iu, /о компании:/iu, /наш стек:/iu, /чем предстоит заниматься/iu,
    /что мы предлагаем/iu, /мы предлагаем/iu, /требования:/iu, /обязанности:/iu,
  ];
  return hiringPatterns.some((rx) => rx.test(clean));
}

function hasPromoSignals(clean: string): boolean {
  if (/#реклама|#партнерский|#дайджест/iu.test(clean.slice(0, 150))) return true;
  const promoPatterns = [
    /#реклама/iu, /#партнерский/iu, /записывайтесь на курс/iu,
    /бесплатный вебинар/iu, /скидка \d+%/iu, /промокод/iu,
  ];
  return promoPatterns.some((rx) => rx.test(clean));
}

function isCandidateResumeOrNonVacancy(text: string): boolean {
  const clean = text.toLowerCase();
  if (hasPromoSignals(clean)) return true;
  const hasResume = hasResumeSignals(clean);
  const hasHiring = hasHiringSignals(clean);
  return hasResume && !hasHiring;
}

function extractJobTitleAndCompany(text: string) {
  const rawLines = text
    .split(/<br\s*\/?>|\n/)
    .map((l) => decodeFeedEntities(l.replace(/<[^>]+>/g, '').trim()))
    .filter(Boolean);

  return extractTelegramJobHeader(rawLines);
}

function extractExperienceLevel(text: string): string | undefined {
  if (/\b(?:intern|стажер|стажёр)\b/i.test(text)) return 'Junior / Intern';
  if (/\b(?:junior|джуниор|джун)\b/i.test(text)) return 'Junior';
  if (/\b(?:lead|team lead|tech lead|тимлид|техлид)\b/i.test(text)) return 'Lead';
  if (/\b(?:head of|director|vp of|c-level|cto|cpo|executive)\b/i.test(text)) return 'Executive';
  if (/\b(?:principal|staff|architect|архитектор)\b/i.test(text)) return 'Principal / Staff';
  if (/\b(?:senior|сеньор|сениор|сеньёр)\b/i.test(text)) return 'Senior';
  if (/\b(?:middle|мидл|миддл)\b/i.test(text)) return 'Middle';
  return undefined;
}

function extractEmploymentType(text: string): string | undefined {
  if (/\bpart-time|парт-тайм|частичная занятость|проектная\b/i.test(text)) return 'Part-time / Project';
  if (/\bcontract|контракт|b2b|гпх|ип|самозанят\b/i.test(text)) return 'Contract / B2B';
  if (/\binternship|стажировка\b/i.test(text)) return 'Internship';
  return 'Full-time';
}

function extractContactInfo(text: string): string | undefined {
  const tgMatch = text.match(/(?:контакты|отклик|связь|apply|contact|hr|telegram|tg):\s*(@[a-zA-Z0-9_]{4,32}|\S+@\S+\.\S+|https:\/\/t\.me\/\S+)/i);
  if (tgMatch) return tgMatch[1];
  const directUsername = text.match(/@[a-zA-Z0-9_]{5,32}/);
  if (directUsername) return directUsername[0];
  const directEmail = text.match(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/);
  if (directEmail) return directEmail[0];
  return undefined;
}

function extractListUnderHeading(text: string, headings: string[]): string[] {
  const results: string[] = [];
  const lines = text.split(/<br\s*\/?>|\n/);
  let capturing = false;

  for (const rawLine of lines) {
    const clean = rawLine.replace(/<[^>]+>/g, '').trim();
    if (!clean) continue;

    const isHeader = headings.some((h) => clean.toLowerCase().includes(h.toLowerCase()));
    if (isHeader) {
      capturing = true;
      continue;
    }

    if (
      capturing &&
      /(?:требования|обязанности|условия|будет плюсом|стек|контакты|локация|зарплата):/i.test(clean)
    ) {
      capturing = false;
      continue;
    }

    if (capturing) {
      const item = clean.replace(/^[-•*–—]\s*/, '').trim();
      if (item.length > 3 && item.length < 250) {
        results.push(item);
      }
    }
  }

  return results.slice(0, 8);
}

function extractStructuredJobSections(text: string) {
  const responsibilities = extractListUnderHeading(text, [
    'обязанности', 'задачи', 'чем предстоит заниматься', 'что предстоит делать', 'responsibilities',
  ]);
  const qualifications = extractListUnderHeading(text, [
    'требования', 'ожидания', 'что нужно знать', 'requirements', 'qualifications', 'стек',
  ]);
  const niceToHave = extractListUnderHeading(text, [
    'будет плюсом', 'плюсом будет', 'будет преимуществом', 'nice to have', 'желательно',
  ]);
  const benefits = extractListUnderHeading(text, [
    'условия', 'мы предлагаем', 'бенефиты', 'что мы предлагаем', 'benefits', 'offering',
  ]);

  return {
    responsibilities: responsibilities.length > 0 ? responsibilities : undefined,
    qualifications: qualifications.length > 0 ? qualifications : undefined,
    niceToHave: niceToHave.length > 0 ? niceToHave : undefined,
    benefits: benefits.length > 0 ? benefits : undefined,
  };
}

export function parseTelegramJobPost(
  text: string,
  meta: {
    postId: string;
    channelName: string;
    /**
     * The id the registry knows this source by. Writing `tg-<channel>` here
     * instead meant the pool counted these vacancies under no source at all,
     * and a later sync could never evict them (found on the B164 prod walk).
     */
    sourceId: string;
    postUrl: string;
    publishedAt: string;
    observedAt: string;
  },
): UnifiedVacancy | null {
  // The channel's HTML escapes its own characters; leaving them encoded put
  // `&nbsp;` and `&amp;` straight into the card the candidate reads (B164).
  const cleanText = decodeFeedEntities(
    text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  );
  if (cleanText.length < 30 || isCandidateResumeOrNonVacancy(text)) return null;

  const { title, company } = extractJobTitleAndCompany(text);
  const salary = parseSalaryText(cleanText);
  const sections = extractStructuredJobSections(text);

  const fingerprint = calculateVacancyFingerprint({
    title, company, description: cleanText,
    salaryFrom: salary?.from, salaryTo: salary?.to, currency: salary?.currency,
  });

  return {
    id: `tg-${meta.channelName}-${meta.postId}`,
    fingerprint,
    title,
    company,
    isRemote: /удален|remote|удалён|anywhere/i.test(cleanText),
    salary,
    description: cleanText,
    requiredSkills: extractSkillsFromText(cleanText),
    experienceLevel: extractExperienceLevel(cleanText),
    employmentType: extractEmploymentType(cleanText),
    ...sections,
    contactInfo: extractContactInfo(text),
    fullDescription: decodeFeedEntities(text.replace(/<[^>]+>/g, '\n').trim()),
    postType: 'vacancy',
    url: meta.postUrl,
    provenance: {
      sourceType: 'telegram',
      sourceId: meta.sourceId,
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
  meta: { channelName: string; sourceId: string; observedAt: string },
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
      sourceId: meta.sourceId,
      postUrl,
      publishedAt: datetime,
      observedAt: meta.observedAt,
    });

    if (parsed) vacancies.push(parsed);
  }

  return vacancies;
}
