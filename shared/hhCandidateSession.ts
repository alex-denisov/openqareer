/**
 * B704: сессия кандидата hh.ru в приложении. Кандидат входит в hh.ru сам, в окне площадки
 * внутри настольного приложения; список резюме и содержимое выбранного читаются в этом окне.
 * Отклик от имени кандидата уходит только после его подтверждения и в пределах дневного лимита.
 */

export const HH_RESUMES_MAX = 20;
export const HH_RESUME_TITLE_MAX_LENGTH = 300;
export const HH_RESUME_TEXT_MAX_LENGTH = 40_000;
/** B678: для сверки хватает начала резюме; так снимок с пятью резюме укладывается в предел тела запроса. */
export const HH_REVIEW_TEXT_MAX_LENGTH = 8_000;
/** B678: сколько резюме сверяется за одно открытие листа — страницы hh.ru читаются по одной. */
export const HH_REVIEW_RESUMES_MAX = 5;

/** Идентификатор резюме hh.ru — из ссылки карточки резюме. */
export const HH_RESUME_ID = /^[A-Za-z0-9]{1,64}$/u;
/** Номер вакансии hh.ru из адреса `hh.ru/vacancy/<номер>`. */
export const HH_VACANCY_ID = /^[1-9][0-9]{0,14}$/u;

export interface HhResumeSummary {
  readonly id: string;
  readonly title: string;
  /** «обновлено 3 ноября», как пишет hh.ru. */
  readonly updatedLabel?: string;
}

/** B678: место работы в резюме hh.ru так, как его показывает страница резюме. */
export interface HhResumePlace {
  readonly employer: string;
  readonly title: string;
  readonly period: string;
  readonly text: string;
}

/** B678: разделы резюме hh.ru, которые платформа предлагает поправить. */
export interface HhResumeSections {
  readonly title: string;
  readonly about: string;
  /** Раздел «О себе» виден на странице (с текстом или явно пустой). Нет признака — не прочитан. */
  readonly aboutRead?: boolean;
  readonly skills: readonly string[];
  readonly places: readonly HhResumePlace[];
}

/** Разделы резюме для сверки целиком: длиннее — не шлём, снимок с пятью резюме должен уместиться в предел тела запроса. */
export const HH_REVIEW_SECTIONS_MAX_LENGTH = 30_000;
export const HH_SECTION_PLACES_MAX = 30;
export const HH_SECTION_TEXT_MAX_LENGTH = 4_000;
export const HH_SECTION_SKILLS_MAX = 100;

/** Содержимое резюме так, как его показывает hh.ru: заголовок и текст страницы. */
export interface HhResumeContent {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  /** B678: разделы выбранного резюме; у прежних снимков их нет. */
  readonly sections?: HhResumeSections;
}

export type HhResumeEditSection = 'title' | 'experience' | 'skills' | 'about';

/** B678: правка раздела резюме hh.ru «было → станет». */
export interface HhResumeEdit {
  readonly id: string;
  readonly section: HhResumeEditSection;
  /** Место работы и период — у правок опыта. */
  readonly place?: string;
  /** Работодатель и должность места, как их показал hh.ru: по ним приложение находит исходное место (срез 4). */
  readonly employer?: string;
  readonly position?: string;
  readonly was: string;
  readonly now: string;
  /** Навыки, которые правка добавляет (у правки навыков): применяются на hh.ru по одному. */
  readonly added?: readonly string[];
  /** B682: чьи варианты у правки («Другой вариант» a01c); у должности вариантов нет. */
  readonly variantOf?: { readonly vacancyId: string; readonly subjectId: string };
}

export interface HhResumeSnapshot {
  readonly resumes: readonly HhResumeSummary[];
  /** Резюме, которым кандидат откликается. */
  readonly selected: HhResumeContent | null;
  /** B678: прочитанное содержимое остальных резюме списка — для сверки с вакансией. */
  readonly contents?: readonly HhResumeContent[];
  readonly readAt: string;
}

export type HhResumeFitStatus = 'fits' | 'gaps' | 'unread';

/** B678: сверка одного резюме hh.ru с требованиями вакансии. */
export interface HhResumeFit {
  readonly resumeId: string;
  readonly title: string;
  /** «подходит» — есть все требования, «не хватает» — есть пропуски, «unread» — содержимое не читали. */
  readonly status: HhResumeFitStatus;
  readonly matched: readonly string[];
  readonly missing: readonly string[];
  /** Сколько правок предложит разбор; нет — разделы резюме не прочитаны. */
  readonly editCount?: number;
}

export interface HhResumeReview {
  readonly requirements: readonly string[];
  readonly resumes: readonly HhResumeFit[];
  /** Резюме, которое лучше подходит вакансии; `null` — ни одно не прочитано. */
  readonly recommendedId: string | null;
}

export const HH_APPLY_OUTCOMES = ['sent', 'questionnaire', 'failed'] as const;
export type HhApplyOutcome = (typeof HH_APPLY_OUTCOMES)[number];

/** B708: сколько после неуспешной попытки приложение читает окно hh.ru; сервер даёт запас на запись. */
export const HH_WINDOW_WATCH_MS = 10 * 60 * 1000;
export const HH_LATE_SENT_MS = 15 * 60 * 1000;

/** B708: исходы, после которых окно hh.ru осталось на вакансии и кандидат мог завершить отклик сам. */
export const HH_WINDOW_LEFT_OPEN_FAILURES = [
  'page_not_ready',
  'popup_missing',
  'no_confirmation',
  'captcha',
  'resume_not_found',
  'resume_unknown',
  'letter_field_missing',
  'letter_not_kept',
  'submit_unavailable',
  'relocation_warning',
  'hh_error',
  'script_error',
  'already_applied',
  'questionnaire_required',
  'not_signed_in',
  'page_load_timeout',
  'eval_timeout',
  'eval_cancelled',
] as const;

/** B641: вопрос анкеты, как его прочитало приложение в окне hh.ru кандидата. */
export interface HhFormQuestion {
  readonly text: string;
  readonly required: boolean;
  readonly kind: 'text' | 'choice';
  readonly options?: readonly string[];
  readonly multiple?: boolean;
}

export interface HhForm {
  /** Страница анкеты на hh.ru. */
  readonly url: string;
  /** Пусто — вопросы не читаются. */
  readonly questions: readonly HhFormQuestion[];
}

const HH_FORM_HOST = /^(?:[a-z0-9-]+\.)*hh\.ru$/u;

/** Адрес анкеты на hh.ru: только страница отклика или вакансии с её номером; прочее — `null`. */
export function hhFormUrl(value: string): string | null {
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
  if (!HH_FORM_HOST.test(url.hostname)) return null;
  const path = url.pathname.replace(/\/$/u, '');
  if (/^\/vacancy\/[1-9]\d{0,14}$/u.test(path)) return `https://${url.hostname}${path}`;
  const vacancy = url.searchParams.get('vacancyId') ?? '';
  return path === '/applicant/vacancy_response' && /^[1-9]\d{0,14}$/u.test(vacancy)
    ? `https://${url.hostname}${path}?vacancyId=${vacancy}`
    : null;
}

export interface HhApplyAttempt {
  readonly attemptId: string;
  /** Сколько откликов через hh.ru ещё можно отправить сегодня, считая этот. */
  readonly remainingToday: number;
}

/** Номер вакансии из её адреса на hh.ru; не hh.ru — `null`. */
export function hhVacancyIdFromUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    if (host !== 'hh.ru' && !host.endsWith('.hh.ru')) return null;
    const match = /^\/vacancy\/([0-9]+)\/?$/u.exec(url.pathname);
    return match && HH_VACANCY_ID.test(match[1]!) ? match[1]! : null;
  } catch {
    return null;
  }
}
