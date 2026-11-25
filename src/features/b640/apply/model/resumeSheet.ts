import {
  RESUME_ABOUT_MAX,
  RESUME_BULLET_MAX,
  RESUME_BULLETS_MAX,
  RESUME_JOBS_MAX,
  type BuilderJob,
  type BuilderResume,
} from '../../../../../shared/resumeBuilder/model';
import type { ResumeDocument, ResumeExperience } from '../../../resume/resumeTypes';
import { monthYear } from '../../../site/resumeBuilder/resumeFromFile';

type Claim = { readonly value: string } | null | undefined;

/** Пределы схемы файла: сверх них сборщик отклонил бы документ целиком. */
const cut = (value: string | null | undefined, max: number) => (value ?? '').trim().slice(0, max);
const claim = (item: Claim, max: number) => cut(item?.value, max);
const yearOf = (value?: string) => /(19|20)\d{2}/u.exec(value ?? '')?.[0] ?? '';
/** Месяц и год, а если месяц неизвестен — год. */
const dateOf = (item: Claim) => monthYear(item?.value) || yearOf(item?.value);
const linesOf = (text: string | undefined) =>
  (text ?? '')
    .split('\n')
    .map((item) => item.trim().replace(/^[-•–—*]\s+/u, ''))
    .filter(Boolean);

function jobOf(entry: ResumeExperience): BuilderJob {
  const current = entry.current.value;
  const bullets = [
    ...linesOf(entry.description?.value),
    ...entry.bullets.map((bullet) => bullet.value.trim()),
  ];
  return {
    company: claim(entry.employer, 160),
    city: claim(entry.location, 80),
    role: claim(entry.title, 160),
    start: dateOf(entry.startDate),
    end: current ? '' : dateOf(entry.endDate),
    current,
    bullets: [...new Set(bullets)]
      .filter(Boolean)
      .slice(0, RESUME_BULLETS_MAX)
      .map((item) => cut(item, RESUME_BULLET_MAX)),
  };
}

/** Названия технологий латиницей не делают русское резюме английским (B713). */
const ENGLISH_RATIO = 2;

function langOf(document: ResumeDocument, jobs: readonly BuilderJob[]): 'ru' | 'en' {
  const body = [document.about ?? '', ...jobs.flatMap((job) => [job.role, ...job.bullets])].join(
    ' ',
  );
  const latin = body.match(/[a-z]/giu)?.length ?? 0;
  const cyrillic = body.match(/[а-яё]/giu)?.length ?? 0;
  return latin > cyrillic * ENGLISH_RATIO ? 'en' : 'ru';
}

const EXTRA_TITLES = {
  ru: { certificates: 'Сертификаты', courses: 'Курсы', projects: 'Проекты', native: 'родной' },
  en: { certificates: 'Certifications', courses: 'Courses', projects: 'Projects', native: 'native' },
} as const;

type Lang = keyof typeof EXTRA_TITLES;

function languagesOf(document: ResumeDocument, lang: Lang): string {
  return document.languages
    .flatMap((item) => {
      const name = item.name?.value.trim();
      if (!name) return [];
      const level = item.cefr?.value ?? (item.native ? EXTRA_TITLES[lang].native : '');
      return level ? `${name} (${level})` : name;
    })
    .join(', ');
}

function extraOf(document: ResumeDocument, lang: Lang): NonNullable<BuilderResume['extra']> {
  const courses = (document.courses ?? []).map((item) =>
    [item.name, item.provider ?? item.institution, item.year ? String(item.year) : '']
      .filter(Boolean)
      .join(', '),
  );
  const projects = (document.projects ?? []).map((item) =>
    [item.name.value, item.employer?.value, item.description?.value].filter(Boolean).join('. '),
  );
  const certificates = (document.certifications ?? []).map((item) =>
    [item.name, item.issuer, yearOf(item.issuedAt)].filter(Boolean).join(', '),
  );
  return [
    { title: EXTRA_TITLES[lang].certificates, lines: certificates },
    { title: EXTRA_TITLES[lang].courses, lines: courses },
    { title: EXTRA_TITLES[lang].projects, lines: projects },
  ]
    .filter((item) => item.lines.length > 0)
    .map((item) => ({
      title: item.title,
      lines: item.lines.slice(0, 30).map((text) => cut(text, RESUME_BULLET_MAX)),
    }));
}

/** Документ резюме под вакансию в поля файла: лист на экране, PDF и DOCX показывают одно и то же. */
export function sheetFromDocument(document: ResumeDocument): BuilderResume {
  const { contact } = document;
  const jobs = document.experience.slice(0, RESUME_JOBS_MAX).map(jobOf);
  const lang = langOf(document, jobs);
  const skills = (document.skills ?? []).map((skill) => skill.name.trim()).filter(Boolean);
  return {
    lang,
    fullName: cut(contact.fullName, 120),
    title: cut(document.targetRole, 160),
    city: cut(contact.location, 80),
    phone: cut(contact.phone, 40),
    email: cut(contact.email, 120),
    link: cut(contact.links[0]?.replace(/^https?:\/\/(www\.)?/u, '').replace(/\/$/u, ''), 300),
    results: [],
    about: cut(document.about, RESUME_ABOUT_MAX),
    jobs,
    education: document.education.slice(0, 6).map((item) => ({
      school: claim(item.institution, 200),
      degree: claim(item.qualification, 200),
      year: yearOf(item.endDate?.value ?? item.startDate?.value),
    })),
    skills: cut(skills.join(', '), 1_000),
    languages: cut(languagesOf(document, lang), 500),
    extra: extraOf(document, lang),
  };
}
