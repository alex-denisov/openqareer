import type { CefrLevel } from '../resume/resumeTypes';
import {
  CEFR_MAP,
  sectionLookahead,
} from './resumeParserConstants';
import type {
  ParsedResumeAdditional,
  ParsedResumeCourse,
  ParsedResumeEducation,
  ParsedResumeLanguage,
  ParsedResumeRecommendation,
  ParsedResumeTest,
} from './resumeParserTypes';

export function extractSkills(text: string): string[] {
  const lookahead = sectionLookahead('Ключевые навыки');
  const regex = new RegExp(
    `(?:Ключевые навыки|Навыки|Top Skills|Skills|Технические навыки|Стек технологий)\\s*\\n+([\\s\\S]+?)${lookahead}`,
    'iu',
  );
  const match = text.match(regex);
  const raw = match?.[1] ? match[1].trim() : text.trim();
  const items = raw
    .split(/[\n,;•·]+/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 60);
  return [...new Set(items)].slice(0, 50);
}

const EDUCATION_LEVELS = new Set([
  'высшее',
  'неоконченное высшее',
  'незаконченное высшее',
  'среднее специальное',
  'среднее',
  'начальное профессиональное',
  'higher education',
]);

const SECTION_HEADINGS = new Set(
  [
    'опыт',
    'опыт работы',
    'навыки',
    'ключевые навыки',
    'о себе',
    'контакты',
    'языки',
    'знание языков',
    'образование',
    'высшее образование',
    'курсы',
    'сертификаты',
    'рекомендации',
    'достижения',
    'проекты',
    'experience',
    'skills',
    'about',
    'summary',
    'education',
    'languages',
    'projects',
  ].map((item) => item.toLowerCase()),
);

// An institution is a name, not a heading and not a sentence about the work
// somebody did. Everything the parser cannot read as a name stays out of the
// document rather than becoming a made-up school (B178).
function readsAsInstitution(value: string): boolean {
  const candidate = value.trim();
  if (candidate.length < 2) {
    return false;
  }
  if (SECTION_HEADINGS.has(candidate.toLowerCase().replace(/[:.]+$/u, ''))) {
    return false;
  }
  if (/[.!?]$/u.test(candidate)) {
    return false;
  }
  return candidate.split(/\s+/u).length <= 12;
}

// A resume that never names a school must not gain one. When the caller hands
// over the whole document instead of an education section, the heading is the
// only evidence that any of this text is about education at all (B178).
function resolveEducationBody(
  text: string,
  requireHeading: boolean,
): string | null {
  const lookahead = sectionLookahead('Образование');
  const regex = new RegExp(
    `(?:Высшее образование|Образование|Education)\\s*\\n+([\\s\\S]+?)${lookahead}`,
    'iu',
  );
  const match = text.match(regex);
  if (match?.[1]) {
    return match[1].trim();
  }
  return requireHeading ? null : text.trim();
}

function lastYearIn(line: string): string | undefined {
  const matches = [...line.matchAll(/\b(19\d\d|20\d\d)\b/gu)];
  return matches.length > 0 ? matches[matches.length - 1][0] : undefined;
}

interface ShapedEducationEntry {
  institution: string;
  qualification?: string;
  endDate?: string;
  consumedNext: boolean;
}

function shapeEducationEntry(input: {
  line: string;
  next: string | undefined;
  inlineEndYear: string | undefined;
  nextEndYear: string | undefined;
  pendingYear: string | undefined;
}): ShapedEducationEntry {
  const { line, next, inlineEndYear, nextEndYear, pendingYear } = input;
  const stripDates = (value: string): string =>
    value.replace(/\s*·?\s*\([^)]*\d{4}[^)]*\)/u, '').trim();

  if (inlineEndYear && !next) {
    return {
      institution: stripDates(line).replace(/\b(19\d\d|20\d\d)\b/u, '').trim(),
      endDate: inlineEndYear,
      consumedNext: false,
    };
  }
  if (next && nextEndYear) {
    // University on this line, degree with dates on the next (LinkedIn style).
    return {
      institution: line,
      qualification: stripDates(next),
      endDate: nextEndYear,
      consumedNext: true,
    };
  }
  if (next) {
    return {
      institution: line,
      qualification: next,
      endDate: pendingYear || inlineEndYear,
      consumedNext: true,
    };
  }
  return {
    institution: line,
    endDate: pendingYear || inlineEndYear,
    consumedNext: false,
  };
}

export function extractEducation(
  text: string,
  options: { requireHeading?: boolean } = {},
): ParsedResumeEducation[] {
  const raw = resolveEducationBody(text, options.requireHeading === true);
  if (raw === null) {
    return [];
  }
  // hh.ru prints the level of education in its own column — `Высшее` is not the
  // name of a school and must not become one, nor the degree of the school
  // above it, so it is dropped before the lines are paired up (B178).
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !EDUCATION_LEVELS.has(l.toLowerCase().replace(/[.:]+$/u, '')));
  const result: ParsedResumeEducation[] = [];

  let pendingYear: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\b(19\d\d|20\d\d)\b$/u.test(line)) {
      pendingYear = line;
      continue;
    }

    const inlineEndYear = lastYearIn(line);
    const next = lines[i + 1];
    const nextEndYear = next ? lastYearIn(next) : undefined;

    const shaped = shapeEducationEntry({
      line,
      next,
      inlineEndYear,
      nextEndYear,
      pendingYear,
    });
    const { institution, qualification, endDate } = shaped;
    if (shaped.consumedNext) {
      i++;
    }
    pendingYear = undefined;

    if (!readsAsInstitution(institution)) {
      continue;
    }

    result.push({
      institution,
      qualification,
      endDate,
    });
  }
  return result;
}

export function extractCourses(text: string): ParsedResumeCourse[] {
  const lookahead = sectionLookahead('Курсы');
  const regex = new RegExp(
    `(?:Электронные сертификаты|Сертификаты|Certifications|Курсы|Повышение квалификации, курсы|Повышение квалификации|Courses)\\s*\\n+([\\s\\S]+?)${lookahead}`,
    'iu',
  );
  const match = text.match(regex);
  const raw = match?.[1] ? match[1].trim() : text.trim();
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const result: ParsedResumeCourse[] = [];

  let pendingYear: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\b(19\d\d|20\d\d)\b$/u.test(line)) {
      pendingYear = line;
      continue;
    }
    const inlineYear = line.match(/\b(19\d\d|20\d\d)\b/u);
    const year = pendingYear || inlineYear?.[1];
    pendingYear = undefined;

    const cleanedName = line.replace(/\b(19\d\d|20\d\d)\b/u, '').replace(/[()]/gu, '').trim();
    if (cleanedName.length >= 2 && !/^(?:сертификаты|certifications|курсы)$/iu.test(cleanedName)) {
      result.push({
        name: cleanedName,
        year,
      });
    }
  }
  return result;
}

export function extractTests(text: string): ParsedResumeTest[] {
  const lookahead = sectionLookahead('Тесты');
  const regex = new RegExp(
    `(?:Тесты, экзамены|Тестирования|Тесты|Tests & Exams|Assessments)\\s*\\n+([\\s\\S]+?)${lookahead}`,
    'iu',
  );
  const match = text.match(regex);
  const raw = match?.[1] ? match[1].trim() : text.trim();
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const result: ParsedResumeTest[] = [];

  let pendingYear: string | undefined;

  for (const line of lines) {
    if (/^\b(19\d\d|20\d\d)\b$/u.test(line)) {
      pendingYear = line;
      continue;
    }
    const inlineYear = line.match(/\b(19\d\d|20\d\d)\b/u);
    const year = pendingYear || inlineYear?.[1];
    pendingYear = undefined;

    result.push({
      name: line.replace(/\b(19\d\d|20\d\d)\b/u, '').trim(),
      year,
    });
  }
  return result;
}

export function extractRecommendations(text: string): ParsedResumeRecommendation[] {
  const lookahead = sectionLookahead('Рекомендации');
  const regex = new RegExp(
    `(?:Рекомендации|References|Recommendations)\\s*\\n+([\\s\\S]+?)${lookahead}`,
    'iu',
  );
  const match = text.match(regex);
  const raw = match?.[1] ? match[1].trim() : text.trim();
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.map((line) => ({
    recommender: line,
  }));
}

 
// eslint-disable-next-line max-lines-per-function
export function extractLanguages(text: string): ParsedResumeLanguage[] {
  const lines = text.split(/\n+/u).map((l) => l.trim()).filter(Boolean);
  const result: ParsedResumeLanguage[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('(') || /^(?:знание языков|языки|languages)$/iu.test(line)) {
      continue;
    }

    const parenMatch = line.match(/^([A-Za-zА-Яа-яЁё]+)\s*\(([^)]+)\)/u);
    let name: string;
    let levelRaw: string | undefined;

    if (parenMatch) {
      name = parenMatch[1];
      levelRaw = parenMatch[2].toLowerCase();
    } else {
      const parts = line.split(/—|-|–|:/u).map((p) => p.trim());
      name = parts[0];
      levelRaw = parts[1]?.toLowerCase();
      if (!levelRaw && i + 1 < lines.length && lines[i + 1].startsWith('(')) {
        levelRaw = lines[i + 1].replace(/[()]/gu, '').toLowerCase();
        i++;
      }
    }

    let cefr: CefrLevel | undefined;
    if (levelRaw) {
      const normalizedLevel = levelRaw.replace(/\s+/gu, '_');
      for (const [key, val] of Object.entries(CEFR_MAP)) {
        if (normalizedLevel.includes(key) || levelRaw.includes(key)) {
          cefr = val;
          break;
        }
      }
    }
    if (name && name.length >= 2 && !/^(?:знание языков|языки|languages)$/iu.test(name)) {
      const isMetadata = [
        'график',
        'формат',
        'гражданство',
        'переезд',
        'релокация',
        'проживание',
        'schedule',
        'citizenship',
        'relocation',
        'format',
        'location',
      ].some((kw) => name.toLowerCase().includes(kw));
      if (!isMetadata) {
        result.push({ name, cefr });
      }
    }
  }
  return result;
}

export function extractAdditional(text: string): ParsedResumeAdditional | undefined {
  const schedMatch = text.match(/(?:График работы|Формат работы|Work format):\s*([^\n]+)/iu);
  const relocMatch = text.match(/(?:Готов к переезду|Релокация|Relocation):\s*([^\n]+)/iu);
  const citMatch = text.match(/(?:Гражданство|Citizenship):\s*([^\n]+)/iu);
  if (schedMatch || relocMatch || citMatch) {
    return {
      workSchedule: schedMatch?.[1]?.trim(),
      relocation: relocMatch?.[1]?.trim(),
      citizenship: citMatch?.[1]?.trim(),
    };
  }
  return undefined;
}
