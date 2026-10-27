import { compactBuilderResume, MONTH_YEAR, type BuilderResume } from './model';
import { builderResumeText } from './text';

/**
 * B567: the ATS check of the builder, without a model. Structure, dates and
 * format are read from the document itself; keywords need a vacancy, so
 * without one that check stays «нужна вакансия» and does not count.
 */
export type AtsCheckStatus = 'ok' | 'fix' | 'needs_vacancy';

export interface AtsCheck {
  readonly id: 'structure' | 'keywords' | 'dates' | 'format';
  readonly title: string;
  readonly status: AtsCheckStatus;
  readonly detail: string;
}

export interface KeywordMatch {
  readonly present: readonly string[];
  readonly missing: readonly string[];
}

export interface BuilderAtsResult {
  readonly checks: readonly AtsCheck[];
  readonly passed: number;
  readonly total: number;
}

function structureCheck(resume: BuilderResume): AtsCheck {
  const missing = [
    !resume.fullName.trim() || !resume.title.trim() ? 'заголовок' : '',
    resume.jobs.length === 0 ? 'опыт' : '',
    resume.education.length === 0 ? 'образование' : '',
    !resume.skills.trim() ? 'навыки' : '',
  ].filter(Boolean);
  return {
    id: 'structure',
    title: 'Структура',
    status: missing.length ? 'fix' : 'ok',
    detail: missing.length
      ? `Не хватает разделов: ${missing.join(', ')}.`
      : 'Разделы читаются системой: заголовок, опыт, образование, навыки.',
  };
}

function datesCheck(resume: BuilderResume): AtsCheck {
  const broken = resume.jobs.filter(
    (job) => !MONTH_YEAR.test(job.start) || (!job.current && !MONTH_YEAR.test(job.end)),
  );
  const ok = resume.jobs.length > 0 && broken.length === 0;
  const names = broken.map((job) => job.company || job.role || 'место работы').slice(0, 3);
  return {
    id: 'dates',
    title: 'Даты',
    status: ok ? 'ok' : 'fix',
    detail: ok
      ? 'У каждого места работы есть месяц и год начала и окончания.'
      : resume.jobs.length === 0
        ? 'Добавьте опыт с месяцем и годом начала и окончания.'
        : `Нет месяца и года (ММ.ГГГГ): ${names.join(', ')}.`,
  };
}

/** Every template is one column of text with no tables or pictures. */
const FORMAT_CHECK: AtsCheck = {
  id: 'format',
  title: 'Формат',
  status: 'ok',
  detail: 'Одна колонка, без таблиц и картинок с текстом.',
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/ё/gu, 'е').replace(/\s+/gu, ' ').trim();
}

/** Which vacancy keywords the resume text already carries, case- and «ё»-insensitive. */
export function matchKeywords(resume: BuilderResume, keywords: readonly string[]): KeywordMatch {
  const text = normalize(builderResumeText(resume));
  const present: string[] = [];
  const missing: string[] = [];
  for (const keyword of keywords) {
    (text.includes(normalize(keyword)) ? present : missing).push(keyword);
  }
  return { present, missing };
}

function keywordsCheck(resume: BuilderResume, keywords?: readonly string[]): AtsCheck {
  if (!keywords) {
    return {
      id: 'keywords',
      title: 'Ключевые слова',
      status: 'needs_vacancy',
      detail:
        'Вставьте ссылку или текст вакансии — покажем, каких слов из требований нет в резюме.',
    };
  }
  const { present, missing } = matchKeywords(resume, keywords);
  return {
    id: 'keywords',
    title: 'Ключевые слова',
    status: missing.length === 0 ? 'ok' : 'fix',
    detail:
      missing.length === 0
        ? `Все ${present.length} слов из требований есть в резюме.`
        : `Есть ${present.length} из ${keywords.length}. Нет: ${missing.slice(0, 8).join(', ')}.`,
  };
}

export function assessBuilderResume(
  input: BuilderResume,
  keywords?: readonly string[],
): BuilderAtsResult {
  const resume = compactBuilderResume(input);
  const checks = [
    structureCheck(resume),
    keywordsCheck(resume, keywords && keywords.length ? keywords : undefined),
    datesCheck(resume),
    FORMAT_CHECK,
  ];
  return {
    checks,
    passed: checks.filter((check) => check.status === 'ok').length,
    total: checks.length,
  };
}
