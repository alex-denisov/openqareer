import type { CefrLevel } from '../resume/resumeTypes';
import type { ProfileFact } from './profileIngestion';
import {
  CEFR_MAP,
  MONTHS_EN,
  MONTHS_RU,
  SECTION_DELIMITERS,
  sectionLookahead,
} from './resumeParserConstants';
import { normalizeResumeSourceText } from './resumeSourceText';

export interface ParsedResumeExperience {
  title: string;
  employer: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  current: boolean;
  responsibilities: string[];
  achievements: string[];
}

export interface ParsedResumeEducation {
  institution: string;
  qualification?: string;
  startDate?: string;
  endDate?: string;
}

interface ParsedResumeCourse {
  name: string;
  institution?: string;
  year?: string;
  certificateUrl?: string;
}

interface ParsedResumeTest {
  name: string;
  provider?: string;
  score?: string;
  year?: string;
}

interface ParsedResumeRecommendation {
  recommender?: string;
  organization?: string;
  position?: string;
  text?: string;
  contact?: string;
}

export interface ParsedResumeLanguage {
  name: string;
  cefr?: CefrLevel;
}

interface ParsedResumeContact {
  email?: string;
  phone?: string;
  telegram?: string;
  location?: string;
  links: string[];
}

interface ParsedResumeAdditional {
  citizenship?: string;
  workSchedule?: string;
  relocation?: string;
  driversLicense?: string;
}

export interface ParsedResume {
  fullName?: string;
  targetRole?: string;
  photoUrl?: string;
  about?: string;
  contact: ParsedResumeContact;
  experience: ParsedResumeExperience[];
  skills: string[];
  education: ParsedResumeEducation[];
  courses: ParsedResumeCourse[];
  tests: ParsedResumeTest[];
  recommendations: ParsedResumeRecommendation[];
  languages: ParsedResumeLanguage[];
  additional?: ParsedResumeAdditional;
  rawText: string;
}

export interface ProfileFactDraft {
  fact: ProfileFact;
  value: string;
  decision: 'pending' | 'confirmed' | 'corrected' | 'rejected';
}

function parseDocumentSections(text: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = text.split('\n');
  let currentHeader = '__preamble__';
  let currentLines: string[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      currentLines.push('');
      continue;
    }
    const matchedHeader = SECTION_DELIMITERS.find((h) => {
      const hLow = h.toLowerCase();
      const tLow = trimmed.toLowerCase();
      return (
        tLow === hLow ||
        (tLow.startsWith(hLow) && /[\s:—–\d,(]/.test(tLow[hLow.length] || ''))
      );
    });
    if (matchedHeader) {
      if (currentLines.length > 0) {
        const existing = sections.get(currentHeader.toLowerCase()) ?? '';
        sections.set(
          currentHeader.toLowerCase(),
          existing ? `${existing}\n${currentLines.join('\n').trim()}` : currentLines.join('\n').trim(),
        );
      }
      currentHeader = matchedHeader;
      const isStandalone = trimmed.toLowerCase() === matchedHeader.toLowerCase();
      currentLines = isStandalone ? [] : [rawLine];
    } else {
      currentLines.push(rawLine);
    }
  }

  if (currentLines.length > 0) {
    const existing = sections.get(currentHeader.toLowerCase()) ?? '';
    sections.set(
      currentHeader.toLowerCase(),
      existing ? `${existing}\n${currentLines.join('\n').trim()}` : currentLines.join('\n').trim(),
    );
  }

  return sections;
}

// eslint-disable-next-line max-lines-per-function
export function parseResumeContent(rawText: string): ParsedResume {
  // The extractor hands over Markdown; every heuristic below assumes flat text.
  const cleanText = normalizeResumeSourceText(rawText)
    .replace(/Page \d+ of \d+/giu, '')
    .replace(/Страница \d+ из \d+/giu, '')
    .trim();
  const lines = cleanText.split('\n').map((line) => line.trim()).filter(Boolean);
  const sections = parseDocumentSections(cleanText);

  const preamble = sections.get('__preamble__') ?? '';
  const preambleLines = preamble.split('\n').map((l) => l.trim()).filter(Boolean);

  const contact = extractContacts(cleanText);
  const fullName = extractFullName(preambleLines.length > 0 ? preambleLines : lines, cleanText);
  const targetRole = extractTargetRole(preambleLines.length > 0 ? preambleLines : lines, cleanText, fullName);

  const aboutRaw =
    sections.get('summary') ||
    sections.get('executive summary') ||
    sections.get('о себе') ||
    sections.get('обо мне') ||
    sections.get('about me') ||
    sections.get('about');
  const about = aboutRaw ? aboutRaw.trim() : extractAbout(cleanText);

  const expRaw =
    sections.get('experience') ||
    sections.get('опыт работы') ||
    sections.get('work experience') ||
    sections.get('professional experience');
  const experience = extractExperience(expRaw ?? (sections.size <= 2 ? cleanText : ''));

  const skillsRaw = [
    sections.get('top skills'),
    sections.get('skills'),
    sections.get('ключевые навыки'),
    sections.get('навыки'),
    sections.get('технические навыки'),
    sections.get('стек технологий'),
  ]
    .filter(Boolean)
    .join('\n');
  const skills = extractSkills(skillsRaw || (sections.size <= 2 ? cleanText : ''));

  const eduRaw =
    sections.get('education') ||
    sections.get('высшее образование') ||
    sections.get('образование');
  const education = extractEducation(eduRaw ?? (sections.size <= 2 ? cleanText : ''));

  const coursesRaw = [
    sections.get('certifications'),
    sections.get('сертификаты'),
    sections.get('электронные сертификаты'),
    sections.get('courses'),
    sections.get('курсы'),
    sections.get('повышение квалификации, курсы'),
    sections.get('повышение квалификации'),
  ]
    .filter(Boolean)
    .join('\n');
  const courses = extractCourses(coursesRaw ?? '');

  const testsRaw =
    sections.get('tests') ||
    sections.get('tests & exams') ||
    sections.get('тесты') ||
    sections.get('тесты, экзамены') ||
    sections.get('тестирования') ||
    sections.get('assessments');
  const tests = extractTests(testsRaw ?? '');

  const recsRaw =
    sections.get('recommendations') ||
    sections.get('references') ||
    sections.get('рекомендации');
  const recommendations = extractRecommendations(recsRaw ?? '');

  const langRaw =
    sections.get('languages') ||
    sections.get('знание языков') ||
    sections.get('языки');
  const languages = extractLanguages(langRaw ?? '');

  const additional = extractAdditional(cleanText);

  return {
    fullName,
    targetRole,
    about,
    contact,
    experience,
    skills,
    education,
    courses,
    tests,
    recommendations,
    languages,
    additional,
    rawText: cleanText,
  };
}

function extractContacts(text: string): ParsedResumeContact {
  const emailMatch = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u);
  const phoneMatch = text.match(/(?:\+7|\+?8|\+?\d{1,3})[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/u);
  const tgMatch = text.match(/(?:telegram|телеграм|tg):\s*@?([a-zA-Z0-9_]{4,32})|t\.me\/([a-zA-Z0-9_]{4,32})|(?:\s|^)@([a-zA-Z0-9_]{4,32})\b(?!\.[a-z])/iu);
  const tgUser = tgMatch?.[1] || tgMatch?.[2] || tgMatch?.[3];
  
  let location: string | undefined;
  const locMatch = text.match(/(?:Проживает|Город|Локация|Location|City):\s*([^\n,]+(?:,\s*[^\n]+)?)/iu);
  if (locMatch?.[1]) {
    location = locMatch[1].trim();
  } else if (/Москва|Санкт-Петербург|Минск|Алматы|Екатеринбург|Новосибирск|Тбилиси|Ереван|Берлин|London|Berlin|Dubai|Cyprus|Amsterdam/iu.test(text)) {
    const city = text.match(/\b(Москва|Санкт-Петербург|Минск|Алматы|Екатеринбург|Новосибирск|Тбилиси|Ереван|Берлин|London|Berlin|Dubai|Cyprus|Amsterdam)\b/iu);
    if (city?.[1]) location = city[1];
  }

  const links: string[] = [];
  const urlMatches = text.matchAll(/(?:https?:\/\/|www\.)[^\s)]+/giu);
  for (const match of urlMatches) {
    let url = match[0].replace(/[.,;)]+$/u, '');
    if (!url.startsWith('http')) url = `https://${url}`;
    if (!links.includes(url) && !url.includes('hh.ru/resume') && !url.includes('google.com')) {
      links.push(url);
    }
  }

  return {
    email: emailMatch?.[0],
    phone: phoneMatch?.[0],
    telegram: tgUser ? `@${tgUser.replace(/^@/u, '')}` : undefined,
    location,
    links: links.slice(0, 10),
  };
}

// eslint-disable-next-line max-lines-per-function
function extractFullName(lines: string[], text: string): string | undefined {
  // Check for explicit label first
  const nameLabelMatch = text.match(/(?:ФИО|Имя|Name):\s*([А-ЯЁA-Z][а-яёa-z]+(?:\s+[А-ЯЁA-Z][а-яёa-z]+)+)/iu);
  if (nameLabelMatch?.[1]) return nameLabelMatch[1].trim();

  // Common non-name words (skills, roles, categories)
  const nonNameWords = new Set([
    'management',
    'engineering',
    'architecture',
    'development',
    'marketing',
    'design',
    'operations',
    'solutions',
    'systems',
    'services',
    'software',
    'analytics',
    'analysis',
    'testing',
    'security',
    'product',
    'project',
    'technology',
    'consulting',
    'intelligence',
    'science',
    'learning',
    'leadership',
    'strategy',
    'transformation',
    'infrastructure',
    'platform',
    'database',
    'network',
    'professional',
    'working',
    'native',
    'bilingual',
    'certified',
    'certification',
    'certifications',
    'specialist',
    'specialization',
    'contact',
    'skills',
    'languages',
    'summary',
    'experience',
    'education',
  ]);

  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    if (
      lower.includes('linkedin.com') ||
      lower.includes('@') ||
      lower.includes('http') ||
      lower.includes('+7') ||
      lower.startsWith('+') ||
      lower.includes('∙') ||
      lower.includes('page ')
    ) {
      continue;
    }
    const words = line.split(/\s+/u);
    if (words.length >= 2 && words.length <= 4) {
      const hasNonNameWord = words.some((w) => nonNameWords.has(w.toLowerCase()));
      if (hasNonNameWord) continue;

      if (/^[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?$/u.test(line)) {
        return line;
      }
      if (/^[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?$/u.test(line)) {
        return line;
      }
    }
  }
  return undefined;
}

function extractTargetRole(lines: string[], text: string, fullName?: string): string | undefined {
  const roleLabelMatch = text.match(
    /(?:Желаемая должность и зарплата|Желаемая должность|Должность|Target role|Position|Title):\s*([^\n]+)|(?:Желаемая должность и зарплата|Желаемая должность)\s*\n+([^\n]+)/iu,
  );
  if (roleLabelMatch?.[1] || roleLabelMatch?.[2]) {
    const matched = (roleLabelMatch[1] || roleLabelMatch[2])
      .replace(/\s*·.*$/u, '')
      .replace(/\s*\d+.*$/u, '')
      .trim();
    if (matched.length > 2) return matched;
  }

  // If fullName is known, search the lines right after fullName
  if (fullName) {
    const nameIndex = lines.findIndex((l) => l.trim() === fullName.trim());
    if (nameIndex !== -1 && nameIndex + 1 < lines.length) {
      for (let k = nameIndex + 1; k < Math.min(lines.length, nameIndex + 4); k++) {
        const nextLine = lines[k].trim();
        const lower = nextLine.toLowerCase();
        if (
          !SECTION_DELIMITERS.some((d) => d.toLowerCase() === lower) &&
          !lower.includes('linkedin.com') &&
          !lower.includes('@') &&
          !lower.includes('∙') &&
          !lower.startsWith('+') &&
          !/^(?:мужчина|женщина|man|woman)/iu.test(nextLine) &&
          nextLine.length > 3 &&
          nextLine.length < 150
        ) {
          return nextLine;
        }
      }
    }
  }

  // Look for headline line right after name or before summary
  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    const line = lines[i];
    if (line.includes('|') && line.length < 120 && !line.includes('@') && !line.includes('linkedin.com')) {
      return line.trim();
    }
    if (
      /^(?:Руководитель|Директор|Lead|Head|VP|Chief|Senior|Middle|Product|Engineering|Software|Analyst|Manager|Specialist|Разработчик|Менеджер|Аналитик)/iu.test(
        line,
      ) &&
      line.length < 100
    ) {
      return line;
    }
  }
  return undefined;
}

function extractAbout(text: string): string | undefined {
  const lookahead = sectionLookahead('О себе');
  const regex = new RegExp(`(?:О себе|Обо мне|Summary|About me|About|Executive Summary)\\s*\\n+([\\s\\S]+?)${lookahead}`, 'iu');
  const match = text.match(regex);
  if (match?.[1]) {
    const cleaned = match[1].trim();
    if (cleaned.length >= 20) return cleaned;
  }
  return undefined;
}

const SINGLE_DATE_REGEX = /(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|[А-Яа-яЁё]+)\s+)?\d{4}\s*(?:—|-|to|–)\s*(?:по настоящее время|наст\. время|настоящее время|present|current|\d{4}|(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|[А-Яа-яЁё]+)\s+)?\d{4})/iu;
const HH_START_DATE_REGEX = /^(?:(?:[А-Яа-яЁёA-Za-z]+)\s+)?(?:19\d\d|20\d\d)\s*(?:—|-|–)\s*(.+)$/u;

function cleanPeriodDates(period: string): { start?: string; end?: string; current: boolean } {
  const cleaned = period.replace(/\s*\([^)]*\)/gu, '').replace(/\s*·.*$/gu, '').trim();
  const isCurrent = /настоящее|наст\.|present|current/iu.test(cleaned);
  const parts = cleaned.split(/\s*(?:—|-|to|–)\s*/u);
  const start = parts[0] ? normalizeDate(parts[0].trim()) : undefined;
  const end = isCurrent ? undefined : parts[1] ? normalizeDate(parts[1].trim()) : undefined;
  return { start, end, current: isCurrent };
}

interface DetectedDateEntry {
  lineIdx: number;
  startDate?: string;
  endDate?: string;
  current: boolean;
  employer?: string;
  inlineTitle?: string;
  skipLines: number;
}

// eslint-disable-next-line max-lines-per-function
function extractExperience(text: string): ParsedResumeExperience[] {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const results: ParsedResumeExperience[] = [];

  const dateEntries: DetectedDateEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (SINGLE_DATE_REGEX.test(line)) {
      const match = line.match(SINGLE_DATE_REGEX)![0];
      const dates = cleanPeriodDates(match);
      const inlineTitle = line.replace(SINGLE_DATE_REGEX, '').replace(/\([^)]*\)/gu, '').trim();
      dateEntries.push({
        lineIdx: i,
        startDate: dates.start,
        endDate: dates.end,
        current: dates.current,
        inlineTitle: inlineTitle.length > 2 ? inlineTitle : undefined,
        skipLines: 0,
      });
      continue;
    }

    const hhMatch = line.match(HH_START_DATE_REGEX);
    if (hhMatch && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      const endMatch = nextLine.match(/^(?:по настоящее время|наст\.\s*время|настоящее\s*время|present|current|(?:(?:[А-Яа-яЁёA-Za-z]+)\s+)?(?:19\d\d|20\d\d))/iu);
      if (endMatch) {
        const isCurrent = /настоящее|наст\.|present|current/iu.test(endMatch[0]);
        const startRaw = line.split(/\s*(?:—|-|–)\s*/u)[0];
        dateEntries.push({
          lineIdx: i,
          startDate: normalizeDate(startRaw),
          endDate: isCurrent ? undefined : normalizeDate(endMatch[0]),
          current: isCurrent,
          employer: hhMatch[1].trim(),
          skipLines: 1,
        });
      }
    }
  }

  if (dateEntries.length === 0) return [];

  for (let d = 0; d < dateEntries.length; d++) {
    const entry = dateEntries[d];
    const nextEntryIdx = d + 1 < dateEntries.length ? dateEntries[d + 1].lineIdx : lines.length;
    const prevEntryIdx = d > 0 ? dateEntries[d - 1].lineIdx : -1;

    let employer = entry.employer;
    let title = entry.inlineTitle;
    let bodyStartIdx = entry.lineIdx + 1 + entry.skipLines;

    if (!employer || !title) {
      const headerLines: string[] = [];
      for (let k = entry.lineIdx - 1; k > prevEntryIdx; k--) {
        const l = lines[k];
        if (
          l.startsWith('•') ||
          l.startsWith('-') ||
          l.startsWith('*') ||
          l.startsWith('●') ||
          l.length > 90 ||
          l.endsWith('.') ||
          l.includes(';')
        ) {
          break;
        }
        if (/^(?:page \d+|\d+\s+yrs?|\d+\s+mos?|full-time|part-time|contract)/iu.test(l) && l.length < 30) {
          continue;
        }
        headerLines.unshift(l);
        if (headerLines.length >= 2) {
          break;
        }
      }

      if (headerLines.length >= 2) {
        if (!employer) employer = headerLines[0];
        if (!title) title = headerLines[1];
      } else if (headerLines.length === 1) {
        if (!employer) employer = headerLines[0];
      }
    }

    if (!employer || !title) {
      const candidates: string[] = [];
      for (let k = bodyStartIdx; k < Math.min(nextEntryIdx, bodyStartIdx + 4); k++) {
        const l = lines[k];
        if (l.startsWith('•') || l.startsWith('-') || l.startsWith('*') || l.startsWith('●')) break;
        if (/^\d+\s+(?:год|года|лет|месяц|месяца|месяцев)/iu.test(l)) continue;
        if (/^(?:Информационные технологии|Телекоммуникации|Финансовый сектор)/iu.test(l)) continue;
        candidates.push(l);
        if (candidates.length >= 2) break;
      }

      if (candidates.length >= 2) {
        const c0 = candidates[0];
        const c1 = candidates[1];
        const c1IsTitle =
          /директор|руководитель|менеджер|продакт|продукт|разработчик|инженер|аналитик|лид|дизайнер|head|lead|director|manager|developer|engineer|specialist|officer|vp|founder|consultant/iu.test(
            c1,
          );
        const c0IsTitle =
          /директор|руководитель|менеджер|продакт|продукт|разработчик|инженер|аналитик|лид|дизайнер|head|lead|director|manager|developer|engineer|specialist|officer|vp|founder|consultant/iu.test(
            c0,
          );

        if (!employer && !title) {
          if (c0IsTitle && !c1IsTitle) {
            title = c0;
            employer = c1;
          } else {
            employer = c0;
            title = c1;
          }
          bodyStartIdx = lines.indexOf(c1, bodyStartIdx) + 1;
        } else if (!title) {
          title = c0IsTitle ? c0 : c1;
          bodyStartIdx = lines.indexOf(title, bodyStartIdx) + 1;
        } else if (!employer) {
          employer = !c0IsTitle ? c0 : c1;
          bodyStartIdx = lines.indexOf(employer, bodyStartIdx) + 1;
        }
      } else if (candidates.length === 1) {
        const c0 = candidates[0];
        const c0IsTitle =
          /директор|руководитель|менеджер|продакт|продукт|разработчик|инженер|аналитик|лид|дизайнер|head|lead|director|manager|developer|engineer|specialist|officer|vp|founder|consultant/iu.test(
            c0,
          );
        if (!title && c0IsTitle) {
          title = c0;
        } else if (!employer) {
          employer = c0;
        } else if (!title) {
          title = c0;
        }
        bodyStartIdx = lines.indexOf(c0, bodyStartIdx) + 1;
      }
    }

    let location: string | undefined;
    const bullets: string[] = [];
    const achievements: string[] = [];

    let nextHeaderLinesCount = 0;
    if (d + 1 < dateEntries.length) {
      for (let k = nextEntryIdx - 1; k >= bodyStartIdx; k--) {
        const l = lines[k];
        if (l.startsWith('•') || l.startsWith('-') || l.startsWith('*') || l.startsWith('●') || l.length > 100) {
          break;
        }
        nextHeaderLinesCount++;
        if (nextHeaderLinesCount >= 2) break;
      }
    }
    const bodyEnd = nextEntryIdx - nextHeaderLinesCount;

    for (let j = bodyStartIdx; j < bodyEnd; j++) {
      const line = lines[j];
      if (/^(?:page \d+|\d+\s+yrs?|\d+\s+mos?|full-time|part-time|contract)/iu.test(line) && line.length < 30) {
        continue;
      }
      if (!location && !line.startsWith('•') && !line.startsWith('-') && !line.startsWith('●') && line.length < 50 && /^[A-Za-zА-Яа-яЁё\s,.-]+$/u.test(line)) {
        location = line;
        continue;
      }
      if (line.startsWith('•') || line.startsWith('-') || line.startsWith('*') || line.startsWith('●')) {
        const bulletText = line.replace(/^[•\-*●]\s*/u, '').trim();
        if (/\d+%|\d+x|вырос|увелич|сократ|запуст|достиг|growth|increas|reduc|built|launched|scaled/iu.test(bulletText)) {
          achievements.push(bulletText);
        } else {
          bullets.push(bulletText);
        }
      } else if (line.length > 20) {
        if (/\d+%|\d+x|вырос|увелич|сократ|запуст|достиг|growth|increas|reduc|built|launched|scaled/iu.test(line)) {
          achievements.push(line);
        } else {
          bullets.push(line);
        }
      }
    }

    results.push({
      title: title ?? 'Специалист',
      employer: employer ?? 'Компания',
      location,
      startDate: entry.startDate,
      endDate: entry.endDate,
      current: entry.current,
      responsibilities: bullets,
      achievements,
    });
  }

  return results;
}

function extractSkills(text: string): string[] {
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

function extractEducation(text: string): ParsedResumeEducation[] {
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

function extractCourses(text: string): ParsedResumeCourse[] {
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

function extractTests(text: string): ParsedResumeTest[] {
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

function extractRecommendations(text: string): ParsedResumeRecommendation[] {
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
function extractLanguages(text: string): ParsedResumeLanguage[] {
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

function extractAdditional(text: string): ParsedResumeAdditional | undefined {
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

function normalizeDate(raw: string): string {
  if (!raw) return '';
  const cleanStr = raw.toLowerCase().trim();
  const yearMatch = cleanStr.match(/\b(19\d\d|20\d\d)\b/u);
  const year = yearMatch?.[1];
  if (!year) return raw;

  for (const [month, num] of Object.entries(MONTHS_RU)) {
    if (cleanStr.includes(month)) return `${year}-${num}`;
  }
  for (const [month, num] of Object.entries(MONTHS_EN)) {
    if (cleanStr.includes(month)) return `${year}-${num}`;
  }
  return year;
}

export { parsedResumeToDraft, parsedResumeToFactDrafts } from './resumeDraftMapper';
