import { z } from 'zod';

/**
 * B567: the public resume builder's document. It lives in the visitor's
 * browser until sign-up, then travels once into the profile (source
 * «конструктор») and, signed in, to the PDF/DOCX export.
 */
export const RESUME_TEMPLATES = ['strict', 'modern', 'compact'] as const;
export type ResumeTemplate = (typeof RESUME_TEMPLATES)[number];

export const RESUME_TEMPLATE_LABELS: Record<ResumeTemplate, string> = {
  strict: 'Строгий',
  modern: 'Современный',
  compact: 'Компактный',
};

/** Month and year, «03.2021». */
export const MONTH_YEAR = /^(0[1-9]|1[0-2])\.(19|20)\d{2}$/u;

/** Пределы пункта места работы: описание из профиля не обрезается на полуслове. */
export const RESUME_BULLET_MAX = 2_000;
export const RESUME_BULLETS_MAX = 30;
export const RESUME_ABOUT_MAX = 4_000;
export const RESUME_JOBS_MAX = 30;

const line = (max: number) => z.string().trim().max(max);

export const builderJobSchema = z
  .object({
    company: line(160),
    city: line(80),
    role: line(160),
    start: line(7),
    end: line(7),
    current: z.boolean(),
    bullets: z.array(line(RESUME_BULLET_MAX)).max(RESUME_BULLETS_MAX),
  })
  .strict();

export const builderEducationSchema = z
  .object({
    school: line(200),
    degree: line(200),
    year: line(4),
  })
  .strict();

export const builderResumeSchema = z
  .object({
    fullName: line(120),
    title: line(160),
    city: line(80),
    phone: line(40),
    email: line(120),
    results: z.array(line(400)).max(8),
    jobs: z.array(builderJobSchema).max(RESUME_JOBS_MAX),
    education: z.array(builderEducationSchema).max(6),
    skills: line(1_000),
    /** Язык заголовков файла; без него русский. */
    lang: z.enum(['ru', 'en']).optional(),
    /** Поля профиля; в форме конструктора их нет, поэтому они необязательны. */
    link: line(300).optional(),
    about: line(RESUME_ABOUT_MAX).optional(),
    languages: line(500).optional(),
    /** Другие разделы профиля: курсы, проекты. */
    extra: z
      .array(
        z.object({ title: line(80), lines: z.array(line(RESUME_BULLET_MAX)).max(30) }).strict(),
      )
      .max(4)
      .optional(),
  })
  .strict();

export type BuilderJob = z.infer<typeof builderJobSchema>;
export type BuilderEducation = z.infer<typeof builderEducationSchema>;
export type BuilderResume = z.infer<typeof builderResumeSchema>;

export const EMPTY_JOB: BuilderJob = {
  company: '',
  city: '',
  role: '',
  start: '',
  end: '',
  current: false,
  bullets: [''],
};

export const EMPTY_EDUCATION: BuilderEducation = { school: '', degree: '', year: '' };

export const EMPTY_BUILDER_RESUME: BuilderResume = {
  fullName: '',
  title: '',
  city: '',
  phone: '',
  email: '',
  results: [''],
  jobs: [EMPTY_JOB],
  education: [EMPTY_EDUCATION],
  skills: '',
};

/** The sample shown before the visitor types anything, as in the mockup. */
export const SAMPLE_BUILDER_RESUME: BuilderResume = {
  fullName: 'Анна Соколова',
  title: 'Главный бухгалтер',
  city: 'Москва',
  phone: '+7 (900) 000-00-00',
  email: 'anna@example.com',
  results: [
    'Сократила закрытие месяца с 10 до 6 рабочих дней',
    'Провела 3 налоговые проверки без доначислений',
  ],
  jobs: [
    {
      company: 'ООО «Северный терминал»',
      city: 'Москва',
      role: 'Главный бухгалтер',
      start: '03.2021',
      end: '',
      current: true,
      bullets: [
        'Руковожу отделом из 6 человек, учёт по РСБУ и МСФО',
        'Перевела учёт 4 юрлиц на 1С:ERP за 7 месяцев',
        'Снизила штрафы и пени на 1,2 млн ₽ в год',
      ],
    },
    {
      company: 'АО «Инвестстрой»',
      city: 'Москва',
      role: 'Заместитель главного бухгалтера',
      start: '09.2017',
      end: '02.2021',
      current: false,
      bullets: ['Вела НДС и налог на прибыль группы из 3 компаний'],
    },
  ],
  education: [
    {
      school: 'Финансовый университет при Правительстве РФ',
      degree: 'Бакалавр, бухгалтерский учёт, анализ и аудит',
      year: '2017',
    },
  ],
  skills:
    '1С:ERP, 1С:Бухгалтерия 8.3, РСБУ, МСФО, налоговый учёт, консолидация, Excel (Power Query)',
};

const filled = (value: string) => value.trim().length > 0;

/** Drops blank rows the form keeps for typing; the export and the profile see only content. */
export function compactBuilderResume(resume: BuilderResume): BuilderResume {
  return {
    ...resume,
    results: resume.results.filter(filled),
    jobs: resume.jobs
      .map((job) => ({ ...job, bullets: job.bullets.filter(filled) }))
      .filter((job) => filled(job.company) || filled(job.role) || job.bullets.length > 0),
    education: resume.education.filter((item) => filled(item.school) || filled(item.degree)),
  };
}

export function isBlankBuilderResume(resume: BuilderResume): boolean {
  const compact = compactBuilderResume(resume);
  return (
    !filled(compact.fullName) &&
    !filled(compact.title) &&
    compact.results.length === 0 &&
    compact.jobs.length === 0 &&
    compact.education.length === 0 &&
    !filled(compact.skills) &&
    !filled(compact.about ?? '') &&
    tailSections(compact).length === 0
  );
}

export function jobPeriod(
  job: Pick<BuilderJob, 'start' | 'end' | 'current'>,
  lang: BuilderResume['lang'] = 'ru',
): string {
  const end = job.current ? (lang === 'en' ? 'Present' : 'сейчас') : job.end;
  if (!job.start && !end) return '';
  return `${job.start || '…'} — ${end || '…'}`;
}

export function contactParts(
  resume: Pick<BuilderResume, 'city' | 'phone' | 'email' | 'link'>,
): string[] {
  return [resume.city, resume.phone, resume.email, resume.link ?? ''].filter(filled);
}

export function contactLine(
  resume: Pick<BuilderResume, 'city' | 'phone' | 'email' | 'link'>,
): string {
  return contactParts(resume).join(' · ');
}

const HEADINGS = {
  ru: {
    about: 'О себе',
    results: 'Главные результаты',
    jobs: 'Опыт работы',
    education: 'Образование',
    skills: 'Навыки',
    languages: 'Языки',
    file: 'Резюме',
  },
  en: {
    about: 'Summary',
    results: 'Key results',
    jobs: 'Work experience',
    education: 'Education',
    skills: 'Skills',
    languages: 'Languages',
    file: 'Resume',
  },
} as const;

/** Заголовки разделов на языке текста резюме (B713). */
export function resumeHeadings(resume: Pick<BuilderResume, 'lang'>) {
  return HEADINGS[resume.lang ?? 'ru'];
}

export interface ResumeTailSection {
  readonly title: string;
  readonly lines: readonly string[];
}

/** Разделы после образования; порядок один у листа, PDF и DOCX. */
export function tailSections(resume: BuilderResume): ResumeTailSection[] {
  const titles = resumeHeadings(resume);
  const rows = [
    { title: titles.skills, lines: [resume.skills.trim()] },
    { title: titles.languages, lines: [resume.languages?.trim() ?? ''] },
    ...(resume.extra ?? []),
  ];
  return rows
    .map((row) => ({ title: row.title, lines: row.lines.filter(filled) }))
    .filter((row) => row.lines.length > 0);
}

export function skillList(skills: string): string[] {
  return skills
    .split(/[,;\n]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}
