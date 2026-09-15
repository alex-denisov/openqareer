import type { UnifiedVacancy, VacancySalary } from '../domain/unifiedVacancy';
import { htmlToFeedText } from '../connectors/feedText';
import { parseSalaryText } from '../connectors/telegramChannelParser';

export interface LinkedinParserContext {
  readonly observedAt: string;
}

interface ParsedActor {
  readonly name: string;
  readonly description: string;
  readonly profileUrl: string;
}

interface RawPostData {
  readonly urn: string;
  readonly actor: ParsedActor;
  readonly text: string;
}

const CANDIDATE_STOP_TAGS = [
  '#opentowork',
  '#jobseeker',
  '#lookingforjob',
  'open to work',
  'open for work',
  'actively looking',
  'seeking new opportunities',
];

const HIRING_INTENT_PATTERNS = [
  /#hiring\b/i,
  /#vacancy\b/i,
  /#вакансия\b/i,
  /\bwe(?:'re| are) hiring\b/i,
  /\bi(?:'m| am) hiring\b/i,
  /\bis hiring\b/i,
  /\blooking for (?:a|an)\b/i,
  /\bоткрыта вакансия\b/i,
  /\bищем\b/i,
  /\bв поиске\b/i,
  /\bjoin our team\b/i,
];

const KNOWN_SKILLS = [
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
  'Rust',
  'C++',
  'PostgreSQL',
  'MySQL',
  'MongoDB',
  'Redis',
  'Kafka',
  'Docker',
  'Kubernetes',
  'AWS',
  'GCP',
  'Azure',
  'GraphQL',
  'QA',
  'DevOps',
  'ML',
  'AI',
];

const ROLE_PATTERNS: readonly RegExp[] = [
  /\b(?:QA\s+Automation\s+Engineer|Automation\s+QA|Product\s+Manager|Tech\s+Lead|Team\s+Lead|Engineering\s+Manager)\b/gi,
  /\b(?:Senior|Junior|Middle|Lead|Staff|Principal|Head of)?\s*(?:QA\s+Automation|Automation\s+QA|Backend|Frontend|Full[- ]?Stack|Infrastructure|DevOps|QA|Security|Platform|Data|Machine Learning|ML|AI|Product|Project|Engineering)?\s*(?:Engineer|Developer|Architect|Manager|Lead|Specialist|Analyst)\b/gi,
  /(?:разработчик|программист|инженер|тестировщик|архитектор|лид|руководитель|аналитик)\s*(?:по\s+автоматизации|нагрузочному)?/giu,
];

function cleanProfileUrl(rawUrl: string): string {
  return rawUrl.split('?')[0]?.trim() ?? '';
}

function extractActor(block: string): ParsedActor {
  const nameMatch = block.match(/<span[^>]*class="[^"]*update-components-actor__name[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
  const descMatch = block.match(/<span[^>]*class="[^"]*update-components-actor__description[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
  const linkMatch = block.match(/<a[^>]*class="[^"]*update-components-actor__meta-link[^"]*"[^>]*href="([^"]+)"/i);

  const name = nameMatch ? htmlToFeedText(nameMatch[1] ?? '') : '';
  const description = descMatch ? htmlToFeedText(descMatch[1] ?? '') : '';
  const rawUrl = linkMatch ? linkMatch[1] ?? '' : '';

  return {
    name,
    description,
    profileUrl: cleanProfileUrl(rawUrl),
  };
}

function extractRawPostText(block: string): string {
  const textContainer =
    block.match(/<div[^>]*class="[^"]*update-components-text[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ??
    block.match(/<span[^>]*class="[^"]*break-words[^"]*"[^>]*>([\s\S]*?)<\/span>/i);

  if (!textContainer) return '';
  return htmlToFeedText(textContainer[1] ?? '');
}

function isCandidateOrDiscussion(text: string, actorDesc: string): boolean {
  const lower = `${text} ${actorDesc}`.toLowerCase();
  for (const tag of CANDIDATE_STOP_TAGS) {
    if (lower.includes(tag)) return true;
  }
  const hasHiringIntent = HIRING_INTENT_PATTERNS.some((pattern) => pattern.test(text));
  return !hasHiringIntent;
}

function extractRoleTitle(text: string): string {
  for (const pattern of ROLE_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match && match[0].trim().length >= 3) {
      return match[0].trim();
    }
  }

  // Fallback: search for "Looking for <role>" or "открыта вакансия <роль>"
  const seekMatch =
    text.match(/(?:looking for|hiring|ищем|вакансия)\s+(?:a|an|the)?\s*([A-Za-zА-Яа-яЁё0-9/.\s+#-]{3,40}?)(?:\s+(?:to join|at|in|в|\(|$|\.))/iu);
  if (seekMatch && seekMatch[1]) {
    return seekMatch[1].trim();
  }

  return '';
}

function extractCompany(text: string, actor: ParsedActor): string {
  // Pattern 1: "В FinTech Pro открыта вакансия"
  const ruAtMatch = text.match(/в\s+([A-Za-zА-ЯЁ][A-Za-zА-Яа-яЁё0-9\s&]{2,30}?)\s+открыта\s+вакансия/iu);
  if (ruAtMatch && ruAtMatch[1]) return ruAtMatch[1].trim();

  // Pattern 2: "team at CloudScale"
  const enAtMatch = text.match(/(?:team|join\s+us)\s+at\s+([A-Z][A-Za-z0-9\s&]{2,30}?)(?:\.|\s+|$|,)/u);
  if (enAtMatch && enAtMatch[1]) return enAtMatch[1].trim();

  // Pattern 3: Actor description "Head of Engineering at CloudScale" or "в FinTech Pro"
  const actorCompanyMatch = actor.description.match(/(?:at|в|@)\s+([A-Za-zА-ЯЁ][A-Za-zА-Яа-яЁё0-9\s&]{2,30})/iu);
  if (actorCompanyMatch && actorCompanyMatch[1]) {
    return actorCompanyMatch[1].trim();
  }

  return actor.name || 'LinkedIn Employer';
}

function extractContactInfo(text: string, actor: ParsedActor): string {
  const contacts: string[] = [];

  const emails = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  if (emails) {
    contacts.push(...emails);
  }

  const tgMatches = text.match(/(?:@|t\.me\/)[a-zA-Z0-9_]{3,}/g);
  if (tgMatches) {
    contacts.push(...tgMatches);
  }

  if (actor.profileUrl) {
    contacts.push(actor.profileUrl);
  }

  return [...new Set(contacts)].join(' | ');
}

function extractSkills(text: string): string[] {
  const found = new Set<string>();
  for (const skill of KNOWN_SKILLS) {
    const escaped = skill.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(?:^|[^a-zA-Z0-9_])${escaped}(?:$|[^a-zA-Z0-9_])`, 'i');
    if (regex.test(text)) {
      found.add(skill);
    }
  }
  return [...found];
}

function buildVacancyFromPost(
  post: RawPostData,
  context: LinkedinParserContext,
): UnifiedVacancy | null {
  if (isCandidateOrDiscussion(post.text, post.actor.description)) {
    return null;
  }

  const title = extractRoleTitle(post.text);
  if (!title) {
    return null;
  }

  const company = extractCompany(post.text, post.actor);
  const salary: VacancySalary | undefined = parseSalaryText(post.text);
  const lowerText = post.text.toLowerCase();
  const isRemote = lowerText.includes('remote') || lowerText.includes('удален') || lowerText.includes('удалён');
  const requiredSkills = extractSkills(post.text);
  const contactInfo = extractContactInfo(post.text, post.actor);

  const cleanUrn = post.urn.trim();
  const url = `https://www.linkedin.com/feed/update/${cleanUrn}/`;
  const id = `src-linkedin-posts:${cleanUrn}`;

  return {
    id,
    fingerprint: id,
    title,
    company,
    location: isRemote ? 'Remote' : undefined,
    isRemote,
    salary,
    description: post.text,
    requiredSkills,
    url,
    contactInfo,
    postType: 'vacancy',
    provenance: {
      sourceType: 'browser_session',
      sourceId: 'src-linkedin-posts',
      sourceName: 'LinkedIn #hiring feed',
      sourceUrl: url,
      externalId: cleanUrn,
      observedAt: context.observedAt,
    },
    publishedAt: context.observedAt,
    status: 'active',
  };
}

export function parseLinkedinPostCards(
  html: string,
  context: LinkedinParserContext,
): UnifiedVacancy[] {
  const results: UnifiedVacancy[] = [];
  const postRegex = /<div[^>]*data-urn="([^"]+)"[\s\S]*?(?=<div[^>]*data-urn="urn:li:activity:|$)/gi;

  let match: RegExpExecArray | null;
  while ((match = postRegex.exec(html)) !== null) {
    const block = match[0];
    const urn = match[1]?.trim() ?? '';
    if (!urn.startsWith('urn:li:activity:')) continue;

    const actor = extractActor(block);
    const text = extractRawPostText(block);

    if (!text) continue;

    const vacancy = buildVacancyFromPost({ urn, actor, text }, context);
    if (vacancy) {
      results.push(vacancy);
    }
  }

  return results;
}
