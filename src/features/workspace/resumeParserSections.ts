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

export function extractEducation(text: string): ParsedResumeEducation[] {
  const lookahead = sectionLookahead('Образование');
  const regex = new RegExp(
    `(?:Высшее образование|Образование|Education)\\s*\\n+([\\s\\S]+?)${lookahead}`,
    'iu',
  );
  const match = text.match(regex);
  const raw = match?.[1] ? match[1].trim() : text.trim();
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const result: ParsedResumeEducation[] = [];

  let pendingYear: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\b(19\d\d|20\d\d)\b$/u.test(line)) {
      pendingYear = line;
      continue;
    }
    const inlineYearMatches = [...line.matchAll(/\b(19\d\d|20\d\d)\b/gu)];
    const inlineEndYear = inlineYearMatches.length > 0 ? inlineYearMatches[inlineYearMatches.length - 1][0] : undefined;

    const next = lines[i + 1];
    const nextYearMatches = next ? [...next.matchAll(/\b(19\d\d|20\d\d)\b/gu)] : [];
    const nextEndYear = nextYearMatches.length > 0 ? nextYearMatches[nextYearMatches.length - 1][0] : undefined;

    let institution = line;
    let qualification: string | undefined;
    let endDate: string | undefined;

    if (inlineEndYear && !next) {
      endDate = inlineEndYear;
      institution = line.replace(/\s*·?\s*\([^)]*\d{4}[^)]*\)/u, '').replace(/\b(19\d\d|20\d\d)\b/u, '').trim();
    } else if (next && nextEndYear) {
      // University on line i, Degree with dates on line i+1 (LinkedIn style)
      institution = line;
      qualification = next.replace(/\s*·?\s*\([^)]*\d{4}[^)]*\)/u, '').trim();
      endDate = nextEndYear;
      i++;
    } else if (next && !nextEndYear) {
      institution = line;
      qualification = next;
      endDate = pendingYear || inlineEndYear;
      i++;
    } else {
      endDate = pendingYear || inlineEndYear;
    }
    pendingYear = undefined;

    result.push({
      institution: institution || 'Учебное заведение',
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
