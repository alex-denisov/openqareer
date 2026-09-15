import type { UnifiedVacancy, VacancyProvenance, VacancySalary } from '../domain/unifiedVacancy';

const EEO_PATTERNS: readonly RegExp[] = [
  /equal\s+opportunity\s+employer/i,
  /equal\s+employment\s+opportunity/i,
  /\beeo\b/i,
  /affirmative\s+action\s+employer/i,
  /without\s+regard\s+to\s+(?:race|color|religion|sex|sexual\s+orientation|gender|national\s+origin|disability|age|veteran)/i,
  /discriminate\s+against\s+any\s+(?:employee|applicant)/i,
  /we\s+do\s+not\s+discriminate/i,
  /qualified\s+applicants\s+will\s+receive\s+consideration/i,
  /reasonable\s+accommodations?\s+for\s+individuals/i,
  /reasonable\s+accommodations?\s+(?:are\s+available|for\s+applicants)/i,
  /proud\s+to\s+be\s+an\s+equal\s+opportunity/i,
  /celebrate\s+diversity\s+and\s+are\s+committed\s+to\s+creating\s+an\s+inclusive/i,
  /\be-verify\b/i,
];

export function isEeoText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return EEO_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function stripEeoBoilerplate(text: string): string {
  if (!text) return '';
  const chunks = text.split(/\n\s*\n/u);
  const kept = chunks.filter((chunk) => !isEeoText(chunk));
  return kept.join('\n\n').trim();
}

interface CurrencyFormat {
  readonly prefix: string;
  readonly suffix: string;
}

function resolveCurrencyFormat(currency?: string): CurrencyFormat {
  const trimmed = currency?.trim();
  if (!trimmed || trimmed.toUpperCase() === 'USD' || trimmed === '$') {
    return { prefix: '$', suffix: '' };
  }
  if (trimmed.toUpperCase() === 'EUR' || trimmed === '€') {
    return { prefix: '€', suffix: '' };
  }
  if (trimmed.toUpperCase() === 'GBP' || trimmed === '£') {
    return { prefix: '£', suffix: '' };
  }
  if (trimmed.toUpperCase() === 'RUB' || trimmed.toUpperCase() === 'RUR' || trimmed === '₽') {
    return { prefix: '', suffix: ' ₽' };
  }
  return { prefix: '', suffix: ` ${trimmed}` };
}

function formatSalary(salary?: VacancySalary): string | undefined {
  if (!salary) return undefined;
  const { prefix, suffix } = resolveCurrencyFormat(salary.currency);

  if (salary.from !== undefined && salary.to !== undefined) {
    const fromStr = `${prefix}${salary.from.toLocaleString('en-US')}`;
    const toStr = `${prefix}${salary.to.toLocaleString('en-US')}${suffix}`;
    return `${fromStr} – ${toStr}`;
  }
  if (salary.from !== undefined) {
    return `от ${prefix}${salary.from.toLocaleString('en-US')}${suffix}`;
  }
  if (salary.to !== undefined) {
    return `до ${prefix}${salary.to.toLocaleString('en-US')}${suffix}`;
  }
  return undefined;
}

function formatDaysAgo(diffDays: number): string {
  if (diffDays <= 0) return 'сегодня';
  if (diffDays === 1) return 'вчера';
  const mod10 = diffDays % 10;
  const mod100 = diffDays % 100;
  if (mod10 === 1 && mod100 !== 11) return `${diffDays} день назад`;
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return `${diffDays} дня назад`;
  return `${diffDays} дней назад`;
}

function formatPublishedAt(publishedAt: string): string {
  const parsed = Date.parse(publishedAt);
  if (Number.isNaN(parsed) || parsed === 0) return 'не указано';
  const diffMs = Date.now() - parsed;
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return formatDaysAgo(diffDays);
}

function formatProvenanceSource(provenance?: VacancyProvenance): string {
  return (
    provenance?.sourceName?.trim() ||
    provenance?.sourceId?.trim() ||
    provenance?.sourceType?.trim() ||
    'Прямой сайт компании / ATS'
  );
}

function formatSubHeroLine(vacancy: UnifiedVacancy): string {
  const parts: string[] = [`**${vacancy.company.trim()}**`];
  if (vacancy.location?.trim()) {
    parts.push(vacancy.location.trim());
  }
  if (vacancy.isRemote === true) {
    parts.push('`Remote`');
  } else if (vacancy.isRemote === false) {
    parts.push('`On-site`');
  }
  if (vacancy.employmentType?.trim()) {
    parts.push(`\`${vacancy.employmentType.trim()}\``);
  }
  return parts.join(' · ');
}

function formatHeroBlock(vacancy: UnifiedVacancy): string {
  const lines: string[] = [`# ${vacancy.title.trim()}`, formatSubHeroLine(vacancy)];

  if (vacancy.experienceLevel?.trim()) {
    lines.push(`💼 **Уровень роли:** \`${vacancy.experienceLevel.trim()}\``);
  }

  const salaryLabel = formatSalary(vacancy.salary);
  if (salaryLabel) {
    lines.push(`💰 **Компенсация:** \`${salaryLabel}\``);
  }

  const published = formatPublishedAt(vacancy.publishedAt);
  const source = formatProvenanceSource(vacancy.provenance);
  lines.push(`🕒 **Статус:** *Опубликовано: ${published}* · *Источник: ${source}*`);

  return lines.join('\n');
}

function formatTopSkillsBlock(skills?: readonly string[]): string | undefined {
  if (!skills || skills.length === 0) return undefined;
  const badges = skills
    .map((s) => s.trim().replace(/^\[|\]$/gu, ''))
    .filter((s) => s.length > 0)
    .map((s) => `\`[${s}]\``);
  if (badges.length === 0) return undefined;

  return `### Top Skills & Match\n🎯 **Ключевой стек роли:**\n${badges.join(' ')}`;
}

function extractBulletItems(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) =>
      line
        .replace(/^[-*•+]\s+/u, '')
        .replace(/^\d+\.\s+/u, '')
        .trim(),
    )
    .filter((line) => line.length > 0 && !isEeoText(line));
}

interface ParsedSections {
  readonly aboutRole?: string;
  readonly responsibilities: readonly string[];
  readonly basicQualifications: readonly string[];
  readonly preferredQualifications: readonly string[];
  readonly aboutCompany?: string;
}

const SECTION_PATTERNS = {
  aboutRole:
    /^(?:#+\s*|\*\*)(?:about\s+(?:the\s+)?(?:role|job|position)|role\s+overview|position\s+overview|job\s+summary|summary|overview|о\s+роли|о\s+вакансии)(?:\*\*|\b)/iu,
  responsibilities:
    /^(?:#+\s*|\*\*)(?:what\s+you(?:'ll|\s+will)\s+do|responsibilities|key\s+responsibilities|duties|what\s+you'll\s+be\s+doing|your\s+mission|обязанности|чем\s+предстоит\s+заниматься|задачи)(?:\*\*|\b)/iu,
  qualifications:
    /^(?:#+\s*|\*\*)(?:basic\s+qualifications|minimum\s+qualifications|qualifications|requirements|what\s+you\s+bring|what\s+we(?:'re|\s+are)\s+looking\s+for|who\s+you\s+are|must\s+have|требования|необходимые\s+навыки|что\s+мы\s+ждем)(?:\*\*|\b)/iu,
  niceToHave:
    /^(?:#+\s*|\*\*)(?:preferred\s+qualifications|preferred\s+requirements|nice\s+to\s+have|nice-to-have|bonus\s+points|pluses?|будет\s+плюсом|желательно)(?:\*\*|\b)/iu,
  aboutCompany:
    /^(?:#+\s*|\*\*)(?:about\s+(?:us|the\s+company|[a-z0-9_ -]+)|who\s+we\s+are|our\s+company|о\s+компании|о\s+нас)(?:\*\*|\b)/iu,
  eeo: /^(?:#+\s*|\*\*)(?:equal\s+opportunity|equal\s+employment|eeo|diversity)(?:\*\*|\b)/iu,
};

function parseRawSections(rawText: string): ParsedSections {
  const sections = rawText.split(/(?=^#{1,4}\s+|^\*\*[A-ZА-Я][^*]+\*\*)/gmu);
  let aboutRole = '';
  const responsibilities: string[] = [];
  const basicQualifications: string[] = [];
  const preferredQualifications: string[] = [];
  let aboutCompany = '';

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed || isEeoText(trimmed)) continue;
    const [headerLine, ...bodyLines] = trimmed.split('\n');
    const header = headerLine.trim();
    const body = bodyLines.join('\n').trim();

    if (SECTION_PATTERNS.eeo.test(header)) continue;
    if (SECTION_PATTERNS.responsibilities.test(header)) {
      responsibilities.push(...extractBulletItems(body));
    } else if (SECTION_PATTERNS.qualifications.test(header)) {
      basicQualifications.push(...extractBulletItems(body));
    } else if (SECTION_PATTERNS.niceToHave.test(header)) {
      preferredQualifications.push(...extractBulletItems(body));
    } else if (SECTION_PATTERNS.aboutCompany.test(header)) {
      aboutCompany = stripEeoBoilerplate(body);
    } else if (SECTION_PATTERNS.aboutRole.test(header)) {
      aboutRole = stripEeoBoilerplate(body);
    } else if (!aboutRole) {
      aboutRole = stripEeoBoilerplate(trimmed);
    }
  }

  return {
    aboutRole: aboutRole || undefined,
    responsibilities,
    basicQualifications,
    preferredQualifications,
    aboutCompany: aboutCompany || undefined,
  };
}

function resolveSections(vacancy: UnifiedVacancy): ParsedSections {
  const rawDesc = vacancy.fullDescription?.trim() || vacancy.description.trim();
  const parsed = parseRawSections(rawDesc);

  const responsibilities =
    vacancy.responsibilities && vacancy.responsibilities.length > 0
      ? vacancy.responsibilities
      : parsed.responsibilities;

  const basicQualifications =
    vacancy.qualifications && vacancy.qualifications.length > 0
      ? vacancy.qualifications
      : parsed.basicQualifications;

  const preferredQualifications =
    vacancy.niceToHave && vacancy.niceToHave.length > 0
      ? vacancy.niceToHave
      : parsed.preferredQualifications;

  const aboutCompany = vacancy.aboutCompany?.trim()
    ? stripEeoBoilerplate(vacancy.aboutCompany.trim())
    : parsed.aboutCompany;

  const aboutRole = parsed.aboutRole || stripEeoBoilerplate(vacancy.description.trim());

  return {
    aboutRole: aboutRole || undefined,
    responsibilities,
    basicQualifications,
    preferredQualifications,
    aboutCompany: aboutCompany || undefined,
  };
}

function renderStructuredSections(vacancy: UnifiedVacancy): string[] {
  const sections = resolveSections(vacancy);
  const blocks: string[] = [];

  if (sections.aboutRole) {
    blocks.push(`### About the Role\n${sections.aboutRole}`);
  }

  if (sections.responsibilities.length > 0) {
    const list = sections.responsibilities.map((r) => `- ${r}`).join('\n');
    blocks.push(`### What You'll Do\n${list}`);
  }

  if (sections.basicQualifications.length > 0) {
    const list = sections.basicQualifications.map((q) => `- ${q}`).join('\n');
    blocks.push(`### Basic Qualifications\n${list}`);
  }

  if (sections.preferredQualifications.length > 0) {
    const list = sections.preferredQualifications.map((p) => `- ${p}`).join('\n');
    blocks.push(`### Preferred Qualifications\n${list}`);
  }

  const companyHeading = `About ${vacancy.company.trim() || 'Company'}`;
  if (sections.aboutCompany) {
    blocks.push(`### ${companyHeading}\n${sections.aboutCompany}`);
  }

  return blocks;
}

function renderLinkedInV1(vacancy: UnifiedVacancy): string {
  const parts: string[] = [formatHeroBlock(vacancy)];

  const topSkills = formatTopSkillsBlock(vacancy.requiredSkills);
  if (topSkills) {
    parts.push('---', topSkills);
  }

  const structuredSections = renderStructuredSections(vacancy);
  if (structuredSections.length > 0) {
    parts.push('---', structuredSections.join('\n\n'));
  }

  return parts.join('\n\n');
}

export function renderUnifiedVacancyView(
  vacancy: UnifiedVacancy,
  templateVersion: string = 'linkedin-v1',
): string {
  if (templateVersion === 'linkedin-v1') {
    return renderLinkedInV1(vacancy);
  }
  throw new Error(`Unsupported vacancy template version: ${templateVersion}`);
}
