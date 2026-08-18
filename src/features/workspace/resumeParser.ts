import type { CefrLevel, ResumeDraft } from '../resume/resumeTypes';
import type { ProfileFact } from './profileIngestion';

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

export interface ParsedResumeCourse {
  name: string;
  institution?: string;
  year?: string;
  certificateUrl?: string;
}

export interface ParsedResumeTest {
  name: string;
  provider?: string;
  score?: string;
  year?: string;
}

export interface ParsedResumeRecommendation {
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

export interface ParsedResumeContact {
  email?: string;
  phone?: string;
  telegram?: string;
  location?: string;
  links: string[];
}

export interface ParsedResumeAdditional {
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

const MONTHS_RU: Record<string, string> = {
  январь: '01',
  января: '01',
  февраль: '02',
  февраля: '02',
  март: '03',
  марта: '03',
  апрель: '04',
  апреля: '04',
  май: '05',
  мая: '05',
  июнь: '06',
  июня: '06',
  июль: '07',
  июля: '07',
  август: '08',
  августа: '08',
  сентябрь: '09',
  сентября: '09',
  октябрь: '10',
  октября: '10',
  ноябрь: '11',
  ноября: '11',
  декабрь: '12',
  декабря: '12',
};

const MONTHS_EN: Record<string, string> = {
  january: '01',
  jan: '01',
  february: '02',
  feb: '02',
  march: '03',
  mar: '03',
  april: '04',
  apr: '04',
  may: '05',
  june: '06',
  jun: '06',
  july: '07',
  jul: '07',
  august: '08',
  aug: '08',
  september: '09',
  sep: '09',
  sept: '09',
  october: '10',
  oct: '10',
  november: '11',
  nov: '11',
  december: '12',
  dec: '12',
};

const CEFR_MAP: Record<string, CefrLevel> = {
  a1: 'A1',
  a2: 'A2',
  b1: 'B1',
  b2: 'B2',
  c1: 'C1',
  c2: 'C2',
  начальный: 'A1',
  базовый: 'A2',
  средний: 'B1',
  выше_среднего: 'B2',
  продвинутый: 'C1',
  свободно: 'C2',
  родной: 'C2',
  native: 'C2',
  fluent: 'C1',
  intermediate: 'B1',
  upper_intermediate: 'B2',
  advanced: 'C1',
};

export function parseResumeContent(rawText: string): ParsedResume {
  const text = rawText.replace(/\r\n/gu, '\n').trim();
  const lines = text.split('\n').map((line) => line.trim());

  const contact = extractContacts(text);
  const fullName = extractFullName(lines);
  const targetRole = extractTargetRole(lines, text);
  const about = extractAbout(text);
  const experience = extractExperience(text);
  const skills = extractSkills(text);
  const education = extractEducation(text);
  const courses = extractCourses(text);
  const tests = extractTests(text);
  const recommendations = extractRecommendations(text);
  const languages = extractLanguages(text);
  const additional = extractAdditional(text);

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
    rawText: text,
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
  } else if (/Москва|Санкт-Петербург|Минск|Алматы|Екатеринбург|Новосибирск|Тбилиси|Ереван|Берлин|London|Berlin/iu.test(text)) {
    const city = text.match(/\b(Москва|Санкт-Петербург|Минск|Алматы|Екатеринбург|Новосибирск|Тбилиси|Ереван|Берлин|London|Berlin)\b/iu);
    if (city?.[1]) location = city[1];
  }

  const links: string[] = [];
  const urlMatches = text.matchAll(/https?:\/\/[^\s)]+/giu);
  for (const match of urlMatches) {
    const url = match[0].replace(/[.,;]+$/u, '');
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

function extractFullName(lines: string[]): string | undefined {
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const line = lines[i];
    if (!line) continue;
    if (/^[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?$/u.test(line)) {
      return line;
    }
    if (/^[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?$/u.test(line)) {
      return line;
    }
    const nameLabelMatch = line.match(/(?:ФИО|Имя|Name):\s*([А-ЯЁA-Z][а-яёa-z]+(?:\s+[А-ЯЁA-Z][а-яёa-z]+)+)/iu);
    if (nameLabelMatch?.[1]) return nameLabelMatch[1].trim();
  }
  return undefined;
}

function extractTargetRole(lines: string[], text: string): string | undefined {
  const roleLabelMatch = text.match(/(?:Желаемая должность|Должность|Target role|Position|Title):\s*([^\n]+)/iu);
  if (roleLabelMatch?.[1]) {
    return roleLabelMatch[1].replace(/\s*·.*$/u, '').replace(/\s*\d+.*$/u, '').trim();
  }
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const line = lines[i];
    if (/^(?:Руководитель|Директор|Lead|Head|Senior|Middle|Product|Engineering|Software|Analyst|Manager|Specialist|Разработчик|Менеджер|Аналитик)/iu.test(line) && line.length < 80) {
      return line;
    }
  }
  return undefined;
}

const SECTION_DELIMITERS = [
  'Опыт работы',
  'Experience',
  'Work Experience',
  'Высшее образование',
  'Образование',
  'Education',
  'Ключевые навыки',
  'Навыки',
  'Skills',
  'Электронные сертификаты',
  'Сертификаты',
  'Курсы',
  'Courses',
  'Повышение квалификации',
  'Тесты, экзамены',
  'Тестирования',
  'Тесты',
  'Tests',
  'Рекомендации',
  'Recommendations',
  'Знание языков',
  'Языки',
  'Languages',
  'О себе',
  'Обо мне',
  'About me',
  'About',
  'График работы',
  'Гражданство',
];

function sectionLookahead(current: string): string {
  const others = SECTION_DELIMITERS.filter((d) => d.toLowerCase() !== current.toLowerCase());
  return `(?=\\n+(?:${others.join('|')}|$))`;
}

function extractAbout(text: string): string | undefined {
  const lookahead = sectionLookahead('О себе');
  const regex = new RegExp(`(?:О себе|Обо мне|Summary|About me|Executive Summary)\\s*\\n+([\\s\\S]+?)${lookahead}`, 'iu');
  const match = text.match(regex);
  if (match?.[1]) {
    const cleaned = match[1].trim();
    if (cleaned.length >= 20) return cleaned;
  }
  return undefined;
}

// eslint-disable-next-line max-lines-per-function
function extractExperience(text: string): ParsedResumeExperience[] {
  const lookahead = sectionLookahead('Опыт работы');
  const regex = new RegExp(`(?:Опыт работы|Experience|Work Experience)\\s*\\n+([\\s\\S]+?)${lookahead}`, 'iu');
  const expMatch = text.match(regex);
  if (!expMatch?.[1]) return [];
  const expText = expMatch[1].trim();

  const blocks = expText.split(/\n{2,}(?=[А-ЯЁA-Z0-9][^\n]{1,80}(?:\n|\s*—|\s*-\s*\d{4}))/u);
  const result: ParsedResumeExperience[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    let periodLine: string | undefined;
    let employer: string | undefined;
    let title: string | undefined;
    const bullets: string[] = [];
    const achievements: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const dateMatch = line.match(/(?:[А-Яа-яA-Za-z]+\s+)?\d{4}\s*(?:—|-|to)\s*(?:по настоящее время|наст\. время|present|current|\d{4}|[А-Яа-яA-Za-z]+\s+\d{4})/iu);
      if (dateMatch && !periodLine) {
        periodLine = dateMatch[0];
        continue;
      }
      if (!employer && line.length < 100 && !line.startsWith('•') && !line.startsWith('-')) {
        employer = line;
        continue;
      }
      if (employer && !title && line.length < 100 && !line.startsWith('•') && !line.startsWith('-')) {
        title = line;
        continue;
      }
      if (line.startsWith('•') || line.startsWith('-') || line.startsWith('*')) {
        const bulletText = line.replace(/^[•\-*]\s*/u, '').trim();
        if (/\d+%|\d+x|вырос|увелич|сократ|запуст|достиг|growth|increas|reduc/iu.test(bulletText)) {
          achievements.push(bulletText);
        } else {
          bullets.push(bulletText);
        }
      } else if (line.length > 20) {
        if (/\d+%|\d+x|вырос|увелич|сократ|запуст|достиг/iu.test(line)) {
          achievements.push(line);
        } else {
          bullets.push(line);
        }
      }
    }

    if (employer || title) {
      const isCurrent = /настоящее|present|current/iu.test(periodLine ?? '');
      result.push({
        title: title ?? employer ?? 'Специалист',
        employer: employer ?? 'Компания',
        startDate: periodLine ? normalizeDate(periodLine.split(/—|-|to/u)[0]?.trim()) : undefined,
        endDate: isCurrent ? undefined : periodLine ? normalizeDate(periodLine.split(/—|-|to/u)[1]?.trim()) : undefined,
        current: isCurrent,
        responsibilities: bullets,
        achievements,
      });
    }
  }

  return result;
}

function extractSkills(text: string): string[] {
  const lookahead = sectionLookahead('Ключевые навыки');
  const regex = new RegExp(`(?:Ключевые навыки|Навыки|Skills|Технические навыки|Стек технологий)\\s*\\n+([\\s\\S]+?)${lookahead}`, 'iu');
  const match = text.match(regex);
  if (!match?.[1]) return [];
  const raw = match[1].trim();
  const items = raw.split(/[\n,;•·]+/u).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 60);
  return [...new Set(items)].slice(0, 50);
}

function extractEducation(text: string): ParsedResumeEducation[] {
  const lookahead = sectionLookahead('Образование');
  const regex = new RegExp(`(?:Высшее образование|Образование|Education)\\s*\\n+([\\s\\S]+?)${lookahead}`, 'iu');
  const match = text.match(regex);
  if (!match?.[1]) return [];
  const raw = match[1].trim();
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const result: ParsedResumeEducation[] = [];

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

    const next = lines[i + 1];
    const isNextYear = next && /^\b(19\d\d|20\d\d)\b$/u.test(next);
    const qualification = next && !isNextYear && !inlineYear ? next : undefined;
    if (qualification) i++;

    result.push({
      institution: inlineYear ? line.replace(/\b(19\d\d|20\d\d)\b/u, '').trim() : line,
      qualification,
      endDate: year,
    });
  }
  return result;
}

function extractCourses(text: string): ParsedResumeCourse[] {
  const lookahead = sectionLookahead('Курсы');
  const regex = new RegExp(`(?:Электронные сертификаты|Сертификаты|Курсы|Повышение квалификации|Courses|Certifications)\\s*\\n+([\\s\\S]+?)${lookahead}`, 'iu');
  const match = text.match(regex);
  if (!match?.[1]) return [];
  const raw = match[1].trim();
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

    result.push({
      name: line.replace(/\b(19\d\d|20\d\d)\b/u, '').replace(/[()]/gu, '').trim(),
      year,
    });
  }
  return result;
}

function extractTests(text: string): ParsedResumeTest[] {
  const lookahead = sectionLookahead('Тесты');
  const regex = new RegExp(`(?:Тесты, экзамены|Тестирования|Тесты|Tests & Exams|Assessments)\\s*\\n+([\\s\\S]+?)${lookahead}`, 'iu');
  const match = text.match(regex);
  if (!match?.[1]) return [];
  const lines = match[1].trim().split('\n').map((l) => l.trim()).filter(Boolean);
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
  const regex = new RegExp(`(?:Рекомендации|References|Recommendations)\\s*\\n+([\\s\\S]+?)${lookahead}`, 'iu');
  const match = text.match(regex);
  if (!match?.[1]) return [];
  const lines = match[1].trim().split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.map((line) => ({
    recommender: line,
  }));
}

function extractLanguages(text: string): ParsedResumeLanguage[] {
  const lookahead = sectionLookahead('Знание языков');
  const regex = new RegExp(`(?:Знание языков|Языки|Languages)\\s*\\n+([\\s\\S]+?)${lookahead}`, 'iu');
  const match = text.match(regex);
  if (!match?.[1]) return [];
  const lines = match[1].trim().split(/[\n,]+/u).map((l) => l.trim()).filter(Boolean);
  const result: ParsedResumeLanguage[] = [];

  for (const line of lines) {
    const parts = line.split(/—|-|–|:/u).map((p) => p.trim());
    const name = parts[0];
    const levelRaw = parts[1]?.toLowerCase();
    let cefr: CefrLevel | undefined;
    if (levelRaw) {
      for (const [key, val] of Object.entries(CEFR_MAP)) {
        if (levelRaw.includes(key)) {
          cefr = val;
          break;
        }
      }
    }
    if (name) {
      result.push({ name, cefr });
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

// eslint-disable-next-line max-lines-per-function
export function parsedResumeToDraft(parsed: ParsedResume): ResumeDraft {
  return {
    candidate: {
      fullName: parsed.fullName,
      photoUrl: parsed.photoUrl,
      about: parsed.about,
      contact: {
        email: parsed.contact.email,
        phone: parsed.contact.phone,
        telegram: parsed.contact.telegram,
        location: parsed.contact.location,
        links: parsed.contact.links,
      },
    },
    targetRole: parsed.targetRole,
    experience: parsed.experience.map((exp, index) => ({
      id: `exp-${index + 1}`,
      chronologyMemoryId: `mem-exp-${index + 1}`,
      title: exp.title,
      employer: exp.employer,
      location: exp.location,
      startDate: exp.startDate,
      endDate: exp.endDate,
      current: exp.current,
      bulletMemoryIds: [
        ...exp.responsibilities.map((_, i) => `mem-bullet-${index + 1}-${i + 1}`),
        ...exp.achievements.map((_, i) => `mem-achieve-${index + 1}-${i + 1}`),
      ].slice(0, 12),
    })),
    skills: parsed.skills.map((skill, index) => ({
      id: `skill-${index + 1}`,
      name: skill,
    })),
    education: parsed.education.map((edu, index) => ({
      id: `edu-${index + 1}`,
      evidenceMemoryId: `mem-edu-${index + 1}`,
      institution: edu.institution,
      qualification: edu.qualification,
      startDate: edu.startDate,
      endDate: edu.endDate,
    })),
    courses: parsed.courses.map((course, index) => ({
      id: `course-${index + 1}`,
      name: course.name,
      institution: course.institution,
      year: course.year,
      certificateUrl: course.certificateUrl,
    })),
    tests: parsed.tests.map((test, index) => ({
      id: `test-${index + 1}`,
      name: test.name,
      provider: test.provider,
      score: test.score,
      year: test.year,
    })),
    recommendations: parsed.recommendations.map((rec, index) => ({
      id: `rec-${index + 1}`,
      recommender: rec.recommender,
      organization: rec.organization,
      position: rec.position,
      text: rec.text,
      contact: rec.contact,
    })),
    languages: parsed.languages.map((lang, index) => ({
      id: `lang-${index + 1}`,
      evidenceMemoryId: `mem-lang-${index + 1}`,
      name: lang.name,
      cefr: lang.cefr,
    })),
    additional: parsed.additional,
  };
}

// eslint-disable-next-line max-lines-per-function
export function parsedResumeToFactDrafts(
  parsed: ParsedResume,
  sourceId: string = 'resume-pdf',
): ProfileFactDraft[] {
  const drafts: ProfileFactDraft[] = [];
  const now = new Date().toISOString();

  function makeFact(
    id: string,
    kind: ProfileFact['kind'],
    statement: string,
    locator: string,
  ): ProfileFactDraft {
    return {
      fact: {
        id,
        kind,
        statement,
        status: 'confirmed',
        confidence: 'source-reported',
        userEdited: false,
        provenance: {
          sourceId,
          platform: sourceId.includes('hh') ? 'hh' : 'other',
          accessPath: 'candidate_export',
          capturedAt: now,
          locator,
          rawSourceState: 'available',
        },
      },
      value: statement,
      decision: 'confirmed',
    };
  }

  if (parsed.targetRole) {
    drafts.push(makeFact('fact-role', 'headline', parsed.targetRole, 'resume:target_role'));
  }
  if (parsed.about) {
    drafts.push(makeFact('fact-about', 'summary', parsed.about, 'resume:about'));
  }
  if (parsed.contact.location) {
    drafts.push(makeFact('fact-loc', 'location', parsed.contact.location, 'resume:location'));
  }

  parsed.experience.forEach((exp, i) => {
    const period = exp.startDate
      ? `${exp.startDate} — ${exp.current ? 'наст. время' : exp.endDate ?? ''}`
      : '';
    drafts.push(
      makeFact(
        `fact-exp-${i + 1}`,
        'position',
        `${exp.title} в ${exp.employer}${period ? ` (${period})` : ''}`,
        `resume:experience:${i + 1}`,
      ),
    );
    exp.achievements.forEach((ach, j) => {
      drafts.push(
        makeFact(
          `fact-ach-${i + 1}-${j + 1}`,
          'summary',
          `Результат в ${exp.employer}: ${ach}`,
          `resume:experience:${i + 1}:achievement:${j + 1}`,
        ),
      );
    });
  });

  parsed.education.forEach((edu, i) => {
    drafts.push(
      makeFact(
        `fact-edu-${i + 1}`,
        'education',
        `${edu.institution}${edu.qualification ? `, ${edu.qualification}` : ''}${edu.endDate ? ` (${edu.endDate})` : ''}`,
        `resume:education:${i + 1}`,
      ),
    );
  });

  parsed.skills.slice(0, 15).forEach((skill, i) => {
    drafts.push(
      makeFact(`fact-skill-${i + 1}`, 'skill', skill, `resume:skill:${i + 1}`),
    );
  });

  return drafts;
}
